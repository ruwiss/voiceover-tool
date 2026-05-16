use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ShortcutBinding {
    pub action: String,
    pub label: String,
    pub keys: String,
}

pub fn defaults() -> Vec<ShortcutBinding> {
    vec![
        binding("playback.toggle", "Oynat/duraklat", "Space"),
        binding("record.toggle", "Kayıt başlat/bitir", "F9"),
        binding("record.restart", "Yeniden al", "F8"),
        binding("timeline.split", "Böl", "Ctrl+B"),
        binding("timeline.delete", "Seçileni sil", "Delete"),
        binding("timeline.undo", "Geri al", "Ctrl+Z"),
        binding("timeline.redo", "Yinele", "Ctrl+Shift+Z"),
        binding("timeline.zoomIn", "Yakınlaş", "Ctrl+Scroll"),
        binding("timeline.zoomOut", "Uzaklaş", "Ctrl+Scroll"),
        binding("timeline.snapping", "Snapping aç/kapat", "Ctrl+N"),
        binding("export.prepare", "Export hazırla", "Ctrl+E"),
    ]
}

fn binding(action: &str, label: &str, keys: &str) -> ShortcutBinding {
    ShortcutBinding {
        action: action.to_string(),
        label: label.to_string(),
        keys: keys.to_string(),
    }
}
