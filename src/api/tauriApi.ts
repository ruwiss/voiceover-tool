import { invoke } from "@tauri-apps/api/core";
import type { AudioSettings, Clip, ExportResult, InputDeviceInfo, RecordingPreview, ShortcutBinding, TimelineProject, TimelineUpdate } from "../types/domain";

export const tauriApi = {
  getProject: () => invoke<TimelineProject>("get_project"),
  updateTimeline: (update: TimelineUpdate) => invoke<TimelineProject>("update_timeline", { update }),
  undoTimeline: () => invoke<TimelineProject>("undo_timeline"),
  redoTimeline: () => invoke<TimelineProject>("redo_timeline"),
  startRecording: (position_ms: number, lane: number) => invoke("start_recording", { positionMs: position_ms, lane }),
  stopRecording: () => invoke<Clip>("stop_recording"),
  restartRecording: (position_ms: number, lane: number) => invoke("restart_recording", { positionMs: position_ms, lane }),
  recordingPreview: () => invoke<RecordingPreview | null>("recording_preview"),
  listInputDevices: () => invoke<InputDeviceInfo[]>("list_input_devices"),
  getAudioSettings: () => invoke<AudioSettings>("get_audio_settings"),
  updateAudioSettings: (settings: AudioSettings) => invoke<AudioSettings>("update_audio_settings", { settings }),
  resetAudioSettings: () => invoke<AudioSettings>("reset_audio_settings"),
  calibrateRnnoise: () => invoke<{ duration_ms: number; rms: number; peak: number; noise_floor: number; recommended_strength: number }>("calibrate_rnnoise"),
  prepareExport: (clip_ids: string[]) => invoke<ExportResult>("prepare_export", { request: { clip_ids } }),
  cacheStatus: () => invoke<{ size_bytes: number }>("cache_status"),
  clearCache: () => invoke<{ removed_files: number; cache_path: string; size_bytes: number }>("clear_cache"),
  defaultShortcuts: () => invoke<ShortcutBinding[]>("default_shortcuts"),
  getShortcuts: () => invoke<ShortcutBinding[]>("get_shortcuts"),
  updateShortcut: (binding: ShortcutBinding) => invoke<ShortcutBinding[]>("update_shortcut", { binding }),
  resetShortcuts: () => invoke<ShortcutBinding[]>("reset_shortcuts"),
};
