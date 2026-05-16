import { Download, Magnet, Minus, Redo2, RotateCcw, Scissors, Settings, Trash2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Keyboard } from "lucide-react";
import { startNativeFileDrag } from "../api/nativeDrag";
import { closeWindow, minimizeWindow, startWindowDrag } from "../api/windowControls";
import { useVoiceoverStore } from "../state/useVoiceoverStore";
import { Timeline } from "./Timeline";
import { ShortcutHint } from "./ShortcutHint";
import { ShortcutSettingsModal } from "./ShortcutSettingsModal";
import { SettingsPanel } from "./SettingsPanel";
import { useShortcuts } from "./useShortcuts";

export function App() {
  const store = useVoiceoverStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const selectedClip = store.project.clips.find((clip) => store.project.selection.includes(clip.id));
  const exportCount = store.project.selection.length > 0 ? store.project.selection.length : store.project.clips.length;
  const canExport = exportCount > 0;
  const clipAtPlayhead = store.project.clips.find((clip) => {
    const endMs = clip.start_ms + clip.trim_end_ms - clip.trim_start_ms;
    return store.project.playhead_ms > clip.start_ms && store.project.playhead_ms < endMs;
  });
  const splitTargetClip = selectedClip ?? clipAtPlayhead;

  const splitSelected = () => {
    if (!splitTargetClip) return;
    const split_ms = Math.floor(splitTargetClip.trim_start_ms + store.project.playhead_ms - splitTargetClip.start_ms);
    void store.applyUpdate({ type: "splitClip", clip_id: splitTargetClip.id, split_ms });
  };

  const toggleRecording = () => void (store.recording ? store.stopRecording() : store.startRecording());
  const toggleTransport = () => {
    if (store.recording) {
      void store.stopRecording();
      return;
    }
    setPlaying((current) => !current);
  };
  const restartRecording = () => void store.restartRecording();
  const toggleSnapping = () => void store.applyUpdate({ type: "toggleSnapping", enabled: !store.project.snapping_enabled });
  const deleteSelected = () => void store.applyUpdate({ type: "deleteSelected" });
  const prepareExport = () => {
    if (!canExport) return;
    void store.prepareExport();
  };
  const undoTimeline = () => void store.undoTimeline();
  const redoTimeline = () => void store.redoTimeline();

  useShortcuts([
    { keys: "Space", run: toggleTransport },
    { keys: "F9", run: toggleRecording },
    { keys: "F8", enabled: store.recording, run: restartRecording },
    { keys: "Ctrl+B", enabled: Boolean(splitTargetClip), run: splitSelected },
    { keys: "Delete", enabled: store.project.selection.length > 0, run: deleteSelected },
    { keys: "Ctrl+Z", run: undoTimeline },
    { keys: "Ctrl+Shift+Z", run: redoTimeline },
    { keys: "Ctrl+N", run: toggleSnapping },
    { keys: "Ctrl+E", enabled: canExport, run: prepareExport },
  ]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="title-drag-region" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="brand-row">
            <img src="/logo.png" alt="" />
            <strong>Voiceover Tool</strong>
          </div>
        </div>
        <div className="top-actions">
          <div className="output-actions top-output-actions">
            <ShortcutHint shortcut={store.shortcutByAction.get("export.prepare")}>
              <button className="export-btn" disabled={!canExport} onClick={prepareExport}>
                <Download size={15} />
                <span>Export</span>
                {canExport ? <span className="export-count">{exportCount}</span> : null}
              </button>
            </ShortcutHint>
            {store.exportResult ? (
              <button
                className="drag-chip"
                draggable
                title={store.exportResult.path}
                onPointerDown={() => void startNativeFileDrag(store.exportResult?.path ?? "")}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", store.exportResult?.path ?? "")}
              >
                Sürükle
              </button>
            ) : null}
          </div>
          <button className={settingsOpen ? "tab active" : "tab"} onClick={() => {
            setShortcutsOpen(false);
            setSettingsOpen((current) => !current);
          }}>
            <Settings size={16} />
          </button>
          <button className={shortcutsOpen ? "tab active" : "tab"} onClick={() => {
            setSettingsOpen(false);
            setShortcutsOpen((current) => !current);
          }}>
            <Keyboard size={16} />
          </button>
          <div className="window-controls">
            <button onClick={minimizeWindow} aria-label="Gizle"><Minus size={15} /></button>
            <button onClick={closeWindow} aria-label="Kapat"><X size={15} /></button>
          </div>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsPanel
          audioSettings={store.audioSettings}
          inputDevices={store.inputDevices}
          cacheSizeBytes={store.cacheSizeBytes}
          rnnoiseCalibration={store.rnnoiseCalibration}
          onAudioSettingsChange={(settings) => void store.updateAudioSettings(settings)}
          onResetAudioSettings={() => void store.resetAudioSettings()}
          onCalibrateRnnoise={() => void store.calibrateRnnoise()}
          onClearCache={() => void store.clearCache()}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {shortcutsOpen ? (
        <ShortcutSettingsModal
          shortcuts={Array.from(store.shortcutByAction.values())}
          onShortcutChange={(binding) => void store.updateShortcut(binding)}
          onResetShortcuts={() => void store.resetShortcuts()}
          onClose={() => setShortcutsOpen(false)}
        />
      ) : null}

      <Timeline
        project={store.project}
        recordingPreview={store.recordingPreview}
        onUpdate={store.applyUpdate}
        playing={playing}
        onPlayingChange={setPlaying}
        toolbar={(
          <>
            <ShortcutHint shortcut={store.shortcutByAction.get("record.toggle")}>
              <button className={store.recording ? "record-btn active" : "record-btn"} onClick={toggleRecording}>
                <span className="record-dot" /> {store.recording ? "Bitir" : "Kayıt"}
              </button>
            </ShortcutHint>
            <ShortcutHint shortcut={store.shortcutByAction.get("record.restart")}>
              <button className="icon-btn" disabled={!store.recording} onClick={restartRecording} aria-label="Yeniden"><RotateCcw size={16} /></button>
            </ShortcutHint>
            <ShortcutHint shortcut={store.shortcutByAction.get("timeline.split")}>
              <button className="icon-btn" disabled={!splitTargetClip} onClick={splitSelected} aria-label="Böl"><Scissors size={16} /></button>
            </ShortcutHint>
            <ShortcutHint shortcut={store.shortcutByAction.get("timeline.delete")}>
              <button className="icon-btn" disabled={store.project.selection.length === 0} onClick={deleteSelected} aria-label="Sil"><Trash2 size={16} /></button>
            </ShortcutHint>
            <span className="toolbar-spacer" />
            <ShortcutHint shortcut={store.shortcutByAction.get("timeline.undo")}>
              <button className="icon-btn history-btn" onClick={undoTimeline} aria-label="Geri al"><Undo2 size={16} /></button>
            </ShortcutHint>
            <ShortcutHint shortcut={store.shortcutByAction.get("timeline.redo")}>
              <button className="icon-btn history-btn" onClick={redoTimeline} aria-label="Yinele"><Redo2 size={16} /></button>
            </ShortcutHint>
            <ShortcutHint shortcut={store.shortcutByAction.get("timeline.snapping")}>
              <button className={store.project.snapping_enabled ? "icon-btn selected history-btn" : "icon-btn history-btn"} onClick={toggleSnapping} aria-label="Snapping"><Magnet size={16} /></button>
            </ShortcutHint>
          </>
        )}
      />

    </main>
  );
}


