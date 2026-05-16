import { useEffect, useState } from "react";
import type { ShortcutBinding } from "../types/domain";

type ShortcutSettingsModalProps = {
  shortcuts: ShortcutBinding[];
  onShortcutChange: (binding: ShortcutBinding) => void;
  onResetShortcuts: () => void;
  onClose: () => void;
};

export function ShortcutSettingsModal({ shortcuts, onShortcutChange, onResetShortcuts, onClose }: ShortcutSettingsModalProps) {
  const [listeningAction, setListeningAction] = useState<string | null>(null);

  useEffect(() => {
    if (!listeningAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setListeningAction(null);
        return;
      }
      const keys = shortcutFromEvent(event);
      if (!keys) return;
      const shortcut = shortcuts.find((item) => item.action === listeningAction);
      if (shortcut) onShortcutChange({ ...shortcut, keys });
      setListeningAction(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listeningAction, onShortcutChange, shortcuts]);

  return (
    <div className="settings-modal-backdrop" onPointerDown={onClose}>
      <section className="settings-panel shortcuts-modal" onPointerDown={(event) => event.stopPropagation()}>
        <header className="settings-modal-header">
          <div>
            <strong>Kısayollar</strong>
            <span>Tıkla, tuş kombinasyonunu bas. ESC iptal.</span>
          </div>
          <button className="modal-close-btn" onClick={onClose}>Kapat</button>
        </header>

        <div className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <button
              className={listeningAction === shortcut.action ? "shortcut-capture listening" : "shortcut-capture"}
              key={shortcut.action}
              onClick={() => setListeningAction(shortcut.action)}
            >
              <span>{shortcut.label}</span>
              <kbd>{listeningAction === shortcut.action ? "Tuş bekleniyor..." : shortcut.keys}</kbd>
            </button>
          ))}
        </div>

        <div className="settings-card">
          <p className="eyebrow">Varsayılan</p>
          <button className="secondary-btn" onClick={onResetShortcuts}>Kısayolları Varsayılana Döndür</button>
        </div>
      </section>
    </div>
  );
}

function shortcutFromEvent(event: KeyboardEvent) {
  const key = normalizeKey(event);
  if (!key) return "";
  const parts = [];
  if (event.ctrlKey && key !== "Ctrl") parts.push("Ctrl");
  if (event.shiftKey && key !== "Shift") parts.push("Shift");
  if (event.altKey && key !== "Alt") parts.push("Alt");
  if (event.metaKey && key !== "Meta") parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

function normalizeKey(event: KeyboardEvent) {
  if (event.code === "Space") return "Space";
  if (event.key === " ") return "Space";
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return "";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}
