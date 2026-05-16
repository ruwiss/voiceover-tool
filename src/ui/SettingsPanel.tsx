import type { AudioSettings, InputDeviceInfo } from "../types/domain";

type SettingsPanelProps = {
  audioSettings: AudioSettings;
  inputDevices: InputDeviceInfo[];
  cacheSizeBytes: number;
  rnnoiseCalibration: { running: boolean; summary: string | null };
  onAudioSettingsChange: (settings: AudioSettings) => void;
  onResetAudioSettings: () => void;
  onCalibrateRnnoise: () => void;
  onClearCache: () => void;
  onClose: () => void;
};

export function SettingsPanel({ audioSettings, inputDevices, cacheSizeBytes, rnnoiseCalibration, onAudioSettingsChange, onResetAudioSettings, onCalibrateRnnoise, onClearCache, onClose }: SettingsPanelProps) {
  return (
    <div className="settings-modal-backdrop" onPointerDown={onClose}>
      <section className="settings-panel" onPointerDown={(event) => event.stopPropagation()}>
        <header className="settings-modal-header">
          <div>
            <strong>Ayarlar</strong>
            <span>Ses ve önbellek</span>
          </div>
          <button className="modal-close-btn" onClick={onClose}>Kapat</button>
        </header>

      <div className="settings-card">
        <p className="eyebrow">Ses girişi</p>
        <label>
          Mikrofon
          <select
            value={audioSettings.input_device_name ?? ""}
            onChange={(event) => onAudioSettingsChange({ ...audioSettings, input_device_name: event.target.value || null })}
          >
            <option value="">Varsayılan mikrofon</option>
            {inputDevices.map((device) => (
              <option key={device.name} value={device.name}>
                {device.name}{device.is_default ? " · varsayılan" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-card">
        <p className="eyebrow">RNNoise</p>
        <label className="toggle-row">
          <span>Canlı RNNoise</span>
          <input
            type="checkbox"
            checked={audioSettings.rnnoise_enabled}
            onChange={(event) => onAudioSettingsChange({ ...audioSettings, rnnoise_enabled: event.target.checked })}
          />
        </label>
        <label>
          Güç: {Math.round(audioSettings.rnnoise_strength * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={audioSettings.rnnoise_strength}
            onChange={(event) => onAudioSettingsChange({ ...audioSettings, rnnoise_strength: Number(event.target.value) })}
          />
        </label>
        <button className="secondary-btn" disabled={rnnoiseCalibration.running} onClick={onCalibrateRnnoise}>
          {rnnoiseCalibration.running ? "Test konuşması dinleniyor..." : "Test Konuşmasıyla Otomatik Ayarla"}
        </button>
        {rnnoiseCalibration.summary ? <p className="settings-note">{rnnoiseCalibration.summary}</p> : null}
      </div>

      <div className="settings-card danger-settings-card">
        <p className="eyebrow">Önbellek</p>
        <button className="danger-btn" onClick={onClearCache}>Önbelleği Temizle ({formatBytes(cacheSizeBytes)})</button>
      </div>

      <div className="settings-card">
        <p className="eyebrow">Varsayılan</p>
        <button className="secondary-btn" onClick={onResetAudioSettings}>Ayarları Varsayılana Döndür</button>
      </div>
      </section>
    </div>
  );
}

function formatBytes(sizeBytes: number) {
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
