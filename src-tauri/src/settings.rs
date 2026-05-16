use crate::audio::AudioSettings;
use crate::shortcuts;
use crate::shortcuts::ShortcutBinding;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const SETTINGS_FILE: &str = "settings.json";
const SHORTCUT_SCHEMA_VERSION: u32 = 3;

pub fn shortcut_schema_version() -> u32 {
    SHORTCUT_SCHEMA_VERSION
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PersistedSettings {
    #[serde(default)]
    pub shortcut_schema_version: u32,
    pub audio: AudioSettings,
    pub shortcuts: Vec<ShortcutBinding>,
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            shortcut_schema_version: SHORTCUT_SCHEMA_VERSION,
            audio: AudioSettings::default(),
            shortcuts: shortcuts::defaults(),
        }
    }
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Dosya işlemi başarısız: {0}")]
    Io(#[from] std::io::Error),
    #[error("Ayar JSON okunamadı: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn load(app_config_dir: &Path) -> PersistedSettings {
    read_settings(settings_path(app_config_dir)).unwrap_or_default()
}

pub fn save(app_config_dir: &Path, settings: &PersistedSettings) -> Result<(), SettingsError> {
    fs::create_dir_all(app_config_dir)?;
    let payload = serde_json::to_string_pretty(settings)?;
    fs::write(settings_path(app_config_dir), payload)?;
    Ok(())
}

fn read_settings(path: PathBuf) -> Result<PersistedSettings, SettingsError> {
    if !path.exists() {
        return Ok(PersistedSettings::default());
    }
    let payload = fs::read_to_string(path)?;
    let mut settings: PersistedSettings = serde_json::from_str(&payload)?;
    if settings.shortcut_schema_version != SHORTCUT_SCHEMA_VERSION {
        settings.shortcut_schema_version = SHORTCUT_SCHEMA_VERSION;
        settings.shortcuts = shortcuts::defaults();
    }
    Ok(settings)
}

fn settings_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(SETTINGS_FILE)
}
