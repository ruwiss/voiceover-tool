mod audio;
mod cache;
mod dsp;
mod export;
mod settings;
mod shortcuts;
mod timeline;

use audio::{AudioSettings, InputDeviceInfo, NoiseCalibrationResult, RecordingPreviewStatus, RecordingState, RecordingSummary};
use cache::{CacheStatus, CacheSummary};
use export::{ExportRequest, ExportResult};
use settings::PersistedSettings;
use shortcuts::ShortcutBinding;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use timeline::{Clip, TimelineProject, TimelineUpdate};

struct AppState {
    project: Mutex<TimelineProject>,
    undo_stack: Mutex<Vec<TimelineProject>>,
    redo_stack: Mutex<Vec<TimelineProject>>,
    recording: Mutex<RecordingState>,
    audio_settings: Mutex<AudioSettings>,
    shortcuts: Mutex<Vec<ShortcutBinding>>,
    config_dir: Mutex<Option<PathBuf>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(TimelineProject::default()),
            undo_stack: Mutex::new(Vec::new()),
            redo_stack: Mutex::new(Vec::new()),
            recording: Mutex::new(RecordingState::default()),
            audio_settings: Mutex::new(AudioSettings::default()),
            shortcuts: Mutex::new(shortcuts::defaults()),
            config_dir: Mutex::new(None),
        }
    }
}

#[tauri::command]
fn get_project(state: tauri::State<AppState>) -> Result<TimelineProject, String> {
    state.project.lock().map(|project| project.clone()).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_timeline(update: TimelineUpdate, state: tauri::State<AppState>) -> Result<TimelineProject, String> {
    let mut project = state.project.lock().map_err(|error| error.to_string())?;
    let should_track_history = timeline::is_history_update(&update);
    if should_track_history {
        push_undo(&state, &project)?;
    }
    timeline::apply_update(&mut project, update).map_err(|error| error.to_string())?;
    if should_track_history {
        clear_redo(&state)?;
    }
    Ok(project.clone())
}

#[tauri::command]
fn undo_timeline(state: tauri::State<AppState>) -> Result<TimelineProject, String> {
    let mut project = state.project.lock().map_err(|error| error.to_string())?;
    let mut undo_stack = state.undo_stack.lock().map_err(|error| error.to_string())?;
    let previous = undo_stack.pop().ok_or_else(|| "Geri alınacak işlem yok".to_string())?;
    drop(undo_stack);

    state.redo_stack.lock().map_err(|error| error.to_string())?.push(project.clone());
    *project = previous;
    Ok(project.clone())
}

#[tauri::command]
fn redo_timeline(state: tauri::State<AppState>) -> Result<TimelineProject, String> {
    let mut project = state.project.lock().map_err(|error| error.to_string())?;
    let mut redo_stack = state.redo_stack.lock().map_err(|error| error.to_string())?;
    let next = redo_stack.pop().ok_or_else(|| "Yinelenecek işlem yok".to_string())?;
    drop(redo_stack);

    state.undo_stack.lock().map_err(|error| error.to_string())?.push(project.clone());
    *project = next;
    Ok(project.clone())
}

#[tauri::command]
fn start_recording(app: tauri::AppHandle, position_ms: u64, lane: u32, state: tauri::State<AppState>) -> Result<RecordingSummary, String> {
    let mut recording = state.recording.lock().map_err(|error| error.to_string())?;
    let settings = state.audio_settings.lock().map_err(|error| error.to_string())?.clone();
    audio::start(app.path().app_cache_dir().map_err(|error| error.to_string())?, position_ms, lane, settings, &mut recording)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_recording(state: tauri::State<AppState>) -> Result<Clip, String> {
    let mut recording = state.recording.lock().map_err(|error| error.to_string())?;
    let clip = audio::stop(&mut recording).map_err(|error| error.to_string())?;
    let mut project = state.project.lock().map_err(|error| error.to_string())?;
    push_undo(&state, &project)?;
    project.clips.push(clip.clone());
    project.revision += 1;
    clear_redo(&state)?;
    Ok(clip)
}

#[tauri::command]
fn restart_recording(app: tauri::AppHandle, position_ms: u64, lane: u32, state: tauri::State<AppState>) -> Result<RecordingSummary, String> {
    let mut recording = state.recording.lock().map_err(|error| error.to_string())?;
    let settings = state.audio_settings.lock().map_err(|error| error.to_string())?.clone();
    audio::restart(app.path().app_cache_dir().map_err(|error| error.to_string())?, position_ms, lane, settings, &mut recording)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recording_preview(state: tauri::State<AppState>) -> Result<Option<RecordingPreviewStatus>, String> {
    let recording = state.recording.lock().map_err(|error| error.to_string())?;
    Ok(audio::preview(&recording))
}

#[tauri::command]
fn list_input_devices() -> Result<Vec<InputDeviceInfo>, String> {
    audio::input_devices().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_audio_settings(state: tauri::State<AppState>) -> Result<AudioSettings, String> {
    state.audio_settings.lock().map(|settings| settings.clone()).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_audio_settings(settings: AudioSettings, state: tauri::State<AppState>) -> Result<AudioSettings, String> {
    let next = {
        let mut current = state.audio_settings.lock().map_err(|error| error.to_string())?;
        *current = settings;
        current.clone()
    };
    persist_settings(&state)?;
    Ok(next)
}

#[tauri::command]
fn reset_audio_settings(state: tauri::State<AppState>) -> Result<AudioSettings, String> {
    let defaults = AudioSettings::default();
    let next = {
        let mut current = state.audio_settings.lock().map_err(|error| error.to_string())?;
        *current = defaults;
        current.clone()
    };
    persist_settings(&state)?;
    Ok(next)
}

#[tauri::command]
fn calibrate_rnnoise(state: tauri::State<AppState>) -> Result<NoiseCalibrationResult, String> {
    let current_settings = state.audio_settings.lock().map_err(|error| error.to_string())?.clone();
    let result = audio::calibrate_noise(current_settings.input_device_name.as_deref(), 3_000)
        .map_err(|error| error.to_string())?;
    {
        let mut settings = state.audio_settings.lock().map_err(|error| error.to_string())?;
        settings.rnnoise_enabled = true;
        settings.rnnoise_strength = result.recommended_strength;
    }
    persist_settings(&state)?;
    Ok(result)
}

#[tauri::command]
fn prepare_export(app: tauri::AppHandle, request: ExportRequest, state: tauri::State<AppState>) -> Result<ExportResult, String> {
    let project = state.project.lock().map_err(|error| error.to_string())?;
    export::prepare(app.path().app_cache_dir().map_err(|error| error.to_string())?, &project, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_cache(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<CacheSummary, String> {
    let summary = cache::clear(app.path().app_cache_dir().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let mut project = state.project.lock().map_err(|error| error.to_string())?;
    push_undo(&state, &project)?;
    project.clips.clear();
    project.selection.clear();
    project.revision += 1;
    clear_redo(&state)?;
    Ok(summary)
}

#[tauri::command]
fn cache_status(app: tauri::AppHandle) -> Result<CacheStatus, String> {
    cache::status(app.path().app_cache_dir().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn default_shortcuts() -> Vec<ShortcutBinding> {
    shortcuts::defaults()
}

#[tauri::command]
fn get_shortcuts(state: tauri::State<AppState>) -> Result<Vec<ShortcutBinding>, String> {
    state.shortcuts.lock().map(|shortcuts| shortcuts.clone()).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_shortcut(binding: ShortcutBinding, state: tauri::State<AppState>) -> Result<Vec<ShortcutBinding>, String> {
    let next = {
        let mut shortcuts = state.shortcuts.lock().map_err(|error| error.to_string())?;
        if let Some(current) = shortcuts.iter_mut().find(|shortcut| shortcut.action == binding.action) {
            current.keys = binding.keys;
        }
        shortcuts.clone()
    };
    persist_settings(&state)?;
    Ok(next)
}

#[tauri::command]
fn reset_shortcuts(state: tauri::State<AppState>) -> Result<Vec<ShortcutBinding>, String> {
    let next = {
        let mut shortcuts = state.shortcuts.lock().map_err(|error| error.to_string())?;
        *shortcuts = shortcuts::defaults();
        shortcuts.clone()
    };
    persist_settings(&state)?;
    Ok(next)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .manage(AppState::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let persisted = settings::load(&config_dir);
            let state = app.state::<AppState>();
            *state.config_dir.lock().map_err(|error| anyhow::anyhow!(error.to_string()))? = Some(config_dir);
            *state.audio_settings.lock().map_err(|error| anyhow::anyhow!(error.to_string()))? = persisted.audio;
            *state.shortcuts.lock().map_err(|error| anyhow::anyhow!(error.to_string()))? = persisted.shortcuts;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_project,
            update_timeline,
            undo_timeline,
            redo_timeline,
            start_recording,
            stop_recording,
            restart_recording,
            recording_preview,
            list_input_devices,
            get_audio_settings,
            update_audio_settings,
            reset_audio_settings,
            calibrate_rnnoise,
            prepare_export,
            cache_status,
            clear_cache,
            default_shortcuts,
            get_shortcuts,
            update_shortcut,
            reset_shortcuts
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılamadı");
}

fn push_undo(state: &tauri::State<AppState>, project: &TimelineProject) -> Result<(), String> {
    let mut undo_stack = state.undo_stack.lock().map_err(|error| error.to_string())?;
    undo_stack.push(project.clone());
    if undo_stack.len() > 100 {
        undo_stack.remove(0);
    }
    Ok(())
}

fn clear_redo(state: &tauri::State<AppState>) -> Result<(), String> {
    state.redo_stack.lock().map_err(|error| error.to_string())?.clear();
    Ok(())
}

fn persist_settings(state: &tauri::State<AppState>) -> Result<(), String> {
    let config_dir = state.config_dir.lock().map_err(|error| error.to_string())?.clone();
    let Some(config_dir) = config_dir else {
        return Ok(());
    };
    let persisted = PersistedSettings {
        shortcut_schema_version: settings::shortcut_schema_version(),
        audio: state.audio_settings.lock().map_err(|error| error.to_string())?.clone(),
        shortcuts: state.shortcuts.lock().map_err(|error| error.to_string())?.clone(),
    };
    settings::save(&config_dir, &persisted).map_err(|error| error.to_string())
}
