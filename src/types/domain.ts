export type Clip = {
  id: string;
  name: string;
  source_path: string;
  start_ms: number;
  duration_ms: number;
  trim_start_ms: number;
  trim_end_ms: number;
  waveform: number[];
  lane: number;
};

export type TimelineProject = {
  clips: Clip[];
  selection: string[];
  playhead_ms: number;
  zoom: number;
  snapping_enabled: boolean;
  revision: number;
};

export type RecordingPreview = {
  active: boolean;
  start_ms: number;
  duration_ms: number;
  waveform: number[];
  lane: number;
};

export type ShortcutBinding = {
  action: string;
  label: string;
  keys: string;
};

export type AudioSettings = {
  input_device_name: string | null;
  rnnoise_enabled: boolean;
  rnnoise_strength: number;
};

export type InputDeviceInfo = {
  name: string;
  is_default: boolean;
};

export type ExportResult = {
  path: string;
  file_name: string;
  duration_ms: number;
  clip_count: number;
};

export type TimelineUpdate =
  | { type: "moveClip"; clip_id: string; start_ms: number; lane: number }
  | { type: "trimClip"; clip_id: string; trim_start_ms: number; trim_end_ms: number }
  | { type: "splitClip"; clip_id: string; split_ms: number }
  | { type: "select"; clip_ids: string[] }
  | { type: "setPlayhead"; playhead_ms: number }
  | { type: "setZoom"; zoom: number }
  | { type: "toggleSnapping"; enabled: boolean }
  | { type: "deleteSelected" }
  | { type: "deleteLane"; lane: number };
