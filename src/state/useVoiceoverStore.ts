import { useCallback, useEffect, useMemo, useState } from "react";
import { tauriApi } from "../api/tauriApi";
import { appConfig } from "../config/appConfig";
import type { AudioSettings, ExportResult, InputDeviceInfo, RecordingPreview, ShortcutBinding, TimelineProject, TimelineUpdate } from "../types/domain";

const initialProject: TimelineProject = {
  clips: [],
  selection: [],
  playhead_ms: 0,
  zoom: 1,
  snapping_enabled: true,
  revision: 0,
};

const initialAudioSettings: AudioSettings = {
  input_device_name: null,
  rnnoise_enabled: true,
  rnnoise_strength: 0.92,
};

export function useVoiceoverStore() {
  const [project, setProject] = useState<TimelineProject>(initialProject);
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>([]);
  const [inputDevices, setInputDevices] = useState<InputDeviceInfo[]>([]);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(initialAudioSettings);
  const [recording, setRecording] = useState(false);
  const [recordingPreview, setRecordingPreview] = useState<RecordingPreview | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0);
  const [rnnoiseCalibration, setRnnoiseCalibration] = useState<{ running: boolean; summary: string | null }>({ running: false, summary: null });
  const [message, setMessage] = useState("Hazır");

  useEffect(() => {
    void Promise.all([tauriApi.getProject(), tauriApi.getShortcuts(), tauriApi.getAudioSettings(), tauriApi.listInputDevices(), tauriApi.cacheStatus()])
      .then(([loadedProject, loadedShortcuts, loadedAudioSettings, loadedInputDevices, loadedCacheStatus]) => {
        setProject({ ...initialProject, ...loadedProject, zoom: loadedProject.zoom || initialProject.zoom });
        setShortcuts(loadedShortcuts);
        setAudioSettings({ ...initialAudioSettings, ...loadedAudioSettings });
        setInputDevices(loadedInputDevices);
        setCacheSizeBytes(loadedCacheStatus.size_bytes);
      })
      .catch((error) => setMessage(String(error)));
  }, []);

  const shortcutByAction = useMemo(
    () => new Map(shortcuts.map((shortcut) => [shortcut.action, shortcut])),
    [shortcuts],
  );

  const applyUpdate = useCallback(async (update: TimelineUpdate) => {
    const nextProject = await tauriApi.updateTimeline(update);
    setProject({ ...initialProject, ...nextProject, zoom: nextProject.zoom || initialProject.zoom });
    setExportResult(null);
  }, []);

  const undoTimeline = useCallback(async () => {
    try {
      const nextProject = await tauriApi.undoTimeline();
      setProject({ ...initialProject, ...nextProject, zoom: nextProject.zoom || initialProject.zoom });
      setExportResult(null);
      setMessage("Son işlem geri alındı");
    } catch (error) {
      setMessage(String(error));
    }
  }, []);

  const redoTimeline = useCallback(async () => {
    try {
      const nextProject = await tauriApi.redoTimeline();
      setProject({ ...initialProject, ...nextProject, zoom: nextProject.zoom || initialProject.zoom });
      setExportResult(null);
      setMessage("İşlem yinelendi");
    } catch (error) {
      setMessage(String(error));
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const placement = findRecordingPlacement(project);
      await tauriApi.startRecording(placement.start_ms, placement.lane);
      setRecording(true);
      setRecordingPreview({ active: true, start_ms: placement.start_ms, duration_ms: 1, waveform: [], lane: placement.lane });
      setMessage(`${appConfig.audio.rnnoisePreset} ile kayıt alınıyor`);
    } catch (error) {
      setRecording(false);
      setMessage(`Kayıt başlatılamadı: ${String(error)}`);
    }
  }, [project]);

  const stopRecording = useCallback(async () => {
    try {
      const clip = await tauriApi.stopRecording();
      setProject((current) => ({ ...current, clips: [...current.clips, clip], revision: current.revision + 1 }));
      setRecording(false);
      setRecordingPreview(null);
      void refreshCacheSize(setCacheSizeBytes);
      setMessage("Kayıt timeline'a eklendi");
    } catch (error) {
      setMessage(`Kayıt bitirilemedi: ${String(error)}`);
    }
  }, []);

  const restartRecording = useCallback(async () => {
    try {
      const placement = findRecordingPlacement(project);
      await tauriApi.restartRecording(placement.start_ms, placement.lane);
      setRecording(true);
      setRecordingPreview({ active: true, start_ms: placement.start_ms, duration_ms: 1, waveform: [], lane: placement.lane });
      setMessage("Mevcut kayıt iptal edildi, yeniden başladı");
    } catch (error) {
      setMessage(`Yeniden kayıt başlatılamadı: ${String(error)}`);
    }
  }, [project]);

  const prepareExport = useCallback(async () => {
    try {
      const result = await tauriApi.prepareExport(project.selection);
      setExportResult(result);
      void refreshCacheSize(setCacheSizeBytes);
      setMessage(`${result.clip_count} parça export'a hazır`);
    } catch (error) {
      setMessage(`Export hazırlanamadı: ${String(error)}`);
    }
  }, [project.selection]);

  const clearCache = useCallback(async () => {
    try {
      const result = await tauriApi.clearCache();
      setProject(initialProject);
      setExportResult(null);
      setRecording(false);
      setRecordingPreview(null);
      setCacheSizeBytes(result.size_bytes);
      setMessage(`${result.removed_files} dosya önbellekten silindi`);
    } catch (error) {
      setMessage(`Önbellek temizlenemedi: ${String(error)}`);
    }
  }, []);

  const updateAudioSettings = useCallback(async (settings: AudioSettings) => {
    try {
      const nextSettings = await tauriApi.updateAudioSettings(settings);
      setAudioSettings(nextSettings);
      setMessage("Ses ayarları güncellendi");
    } catch (error) {
      setMessage(`Ses ayarları güncellenemedi: ${String(error)}`);
    }
  }, []);

  const resetAudioSettings = useCallback(async () => {
    try {
      const nextSettings = await tauriApi.resetAudioSettings();
      setAudioSettings(nextSettings);
      setMessage("Ses ayarları varsayılana döndü");
    } catch (error) {
      setMessage(`Ses ayarları sıfırlanamadı: ${String(error)}`);
    }
  }, []);

  const calibrateRnnoise = useCallback(async () => {
    try {
      setRnnoiseCalibration({ running: true, summary: "3 saniye test konuşması dinleniyor" });
      const result = await tauriApi.calibrateRnnoise();
      setAudioSettings((current) => ({ ...current, rnnoise_enabled: true, rnnoise_strength: result.recommended_strength }));
      setRnnoiseCalibration({ running: false, summary: `Öneri: ${Math.round(result.recommended_strength * 100)}% · Gürültü: ${Math.round(result.noise_floor * 1000) / 1000}` });
      setMessage("RNNoise kalibrasyonu tamamlandı");
    } catch (error) {
      setRnnoiseCalibration({ running: false, summary: `Kalibrasyon başarısız: ${String(error)}` });
      setMessage(`RNNoise kalibrasyonu başarısız: ${String(error)}`);
    }
  }, []);

  const updateShortcut = useCallback(async (binding: ShortcutBinding) => {
    try {
      const nextShortcuts = await tauriApi.updateShortcut(binding);
      setShortcuts(nextShortcuts);
      setMessage("Kısayol güncellendi");
    } catch (error) {
      setMessage(`Kısayol güncellenemedi: ${String(error)}`);
    }
  }, []);

  const resetShortcuts = useCallback(async () => {
    try {
      const nextShortcuts = await tauriApi.resetShortcuts();
      setShortcuts(nextShortcuts);
      setMessage("Kısayollar varsayılana döndü");
    } catch (error) {
      setMessage(`Kısayollar sıfırlanamadı: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      void tauriApi.recordingPreview()
        .then((preview) => setRecordingPreview(preview))
        .catch((error) => setMessage(String(error)));
    }, 120);
    return () => window.clearInterval(timer);
  }, [recording]);

  return {
    project,
    recording,
    recordingPreview,
    exportResult,
    cacheSizeBytes,
    rnnoiseCalibration,
    inputDevices,
    audioSettings,
    message,
    shortcutByAction,
    applyUpdate,
    undoTimeline,
    redoTimeline,
    startRecording,
    stopRecording,
    restartRecording,
    prepareExport,
    clearCache,
    updateAudioSettings,
    resetAudioSettings,
    calibrateRnnoise,
    updateShortcut,
    resetShortcuts,
  };
}

async function refreshCacheSize(setCacheSizeBytes: (sizeBytes: number) => void) {
  const status = await tauriApi.cacheStatus();
  setCacheSizeBytes(status.size_bytes);
}

function findRecordingPlacement(project: TimelineProject) {
  const requestedStartMs = project.playhead_ms;
  for (let lane = 0; lane < 3; lane += 1) {
    const occupied = project.clips.some((clip) => clip.lane === lane && requestedStartMs >= clip.start_ms && requestedStartMs < clip.start_ms + clip.trim_end_ms - clip.trim_start_ms);
    if (!occupied) return { start_ms: requestedStartMs, lane };
  }
  return {
    start_ms: project.clips.reduce((endMs, clip) => Math.max(endMs, clip.start_ms + clip.trim_end_ms - clip.trim_start_ms), requestedStartMs),
    lane: 0,
  };
}
