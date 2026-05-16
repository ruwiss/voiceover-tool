use crate::dsp::{LiveNoiseReducer, NoiseReductionConfig};
use crate::timeline::Clip;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use hound::{SampleFormat as WavSampleFormat, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;
use thiserror::Error;
use uuid::Uuid;

const TARGET_SAMPLE_RATE: u32 = 48_000;
const BIT_DEPTH: u16 = 24;
const WAVEFORM_BUCKETS: usize = 240;
const MAX_I24_AMPLITUDE: f32 = 8_388_607.0;
const EDGE_FADE_MS: u64 = 8;
const EDGE_TRIM_MS: u64 = 200;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AudioSettings {
    pub input_device_name: Option<String>,
    pub rnnoise_enabled: bool,
    pub rnnoise_strength: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InputDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

impl From<AudioSettings> for NoiseReductionConfig {
    fn from(settings: AudioSettings) -> Self {
        Self {
            enabled: settings.rnnoise_enabled,
            strength: settings.rnnoise_strength.clamp(0.0, 1.0),
        }
    }
}

impl Default for AudioSettings {
    fn default() -> Self {
        let noise_reduction = NoiseReductionConfig::default();
        Self {
            input_device_name: None,
            rnnoise_enabled: noise_reduction.enabled,
            rnnoise_strength: noise_reduction.strength,
        }
    }
}

#[derive(Default)]
pub struct RecordingState {
    active: Option<ActiveRecording>,
}

struct ActiveRecording {
    id: Uuid,
    position_ms: u64,
    lane: u32,
    started_at: Instant,
    file_path: PathBuf,
    samples: Arc<Mutex<Vec<f32>>>,
    noise_reduction: NoiseReductionConfig,
    reducer: Arc<Mutex<LiveNoiseReducer>>,
    stream: Stream,
}

unsafe impl Send for RecordingState {}
unsafe impl Send for ActiveRecording {}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RecordingSummary {
    pub id: Uuid,
    pub position_ms: u64,
    pub rnnoise_enabled: bool,
    pub preset: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RecordingPreviewStatus {
    pub active: bool,
    pub start_ms: u64,
    pub duration_ms: u64,
    pub waveform: Vec<f32>,
    pub lane: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NoiseCalibrationResult {
    pub duration_ms: u64,
    pub rms: f32,
    pub peak: f32,
    pub noise_floor: f32,
    pub recommended_strength: f32,
}

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("Kayıt zaten aktif")]
    AlreadyRecording,
    #[error("Aktif kayıt yok")]
    NotRecording,
    #[error("Mikrofon bulunamadı")]
    NoInputDevice,
    #[error("Mikrofon config okunamadı: {0}")]
    InputConfig(String),
    #[error("Ses akışı oluşturulamadı: {0}")]
    StreamBuild(String),
    #[error("Ses akışı başlatılamadı: {0}")]
    StreamPlay(String),
    #[error("Dosya işlemi başarısız: {0}")]
    Io(#[from] std::io::Error),
    #[error("WAV yazılamadı: {0}")]
    Wav(#[from] hound::Error),
}

pub fn start(cache_dir: PathBuf, position_ms: u64, lane: u32, settings: AudioSettings, state: &mut RecordingState) -> Result<RecordingSummary, AudioError> {
    if state.active.is_some() {
        return Err(AudioError::AlreadyRecording);
    }

    let recordings_dir = cache_dir.join("recordings");
    fs::create_dir_all(&recordings_dir)?;

    let id = Uuid::new_v4();
    let file_path = recordings_dir.join(format!("{}.wav", id));
    let samples = Arc::new(Mutex::new(Vec::new()));
    let noise_reduction = NoiseReductionConfig::from(settings.clone());
    let reducer = Arc::new(Mutex::new(LiveNoiseReducer::new(noise_reduction.clone())));
    let stream = build_input_stream(settings.input_device_name.as_deref(), Arc::clone(&samples), Arc::clone(&reducer))?;
    stream.play().map_err(|error| AudioError::StreamPlay(error.to_string()))?;

    let active = ActiveRecording {
        id,
        position_ms,
        lane,
        started_at: Instant::now(),
        file_path,
        samples,
        noise_reduction,
        reducer,
        stream,
    };
    let summary = summary(&active);
    state.active = Some(active);
    Ok(summary)
}

pub fn stop(state: &mut RecordingState) -> Result<Clip, AudioError> {
    let active = state.active.take().ok_or(AudioError::NotRecording)?;
    drop(active.stream);

    if let Ok(mut reducer) = active.reducer.lock() {
        let tail = reducer.flush_pending();
        if !tail.is_empty() {
            if let Ok(mut samples) = active.samples.lock() {
                samples.extend(tail);
            }
        }
    }
    let mut processed_samples = active.samples.lock().map(|values| values.clone()).unwrap_or_default();
    trim_recording_edges(&mut processed_samples, EDGE_TRIM_MS);
    apply_edge_fade(&mut processed_samples, EDGE_FADE_MS);
    let duration_ms = samples_to_ms(processed_samples.len()).max(1);
    write_recording(&active.file_path, &processed_samples)?;

    Ok(Clip {
        id: active.id,
        name: "Voiceover take".to_string(),
        source_path: active.file_path.to_string_lossy().to_string(),
        start_ms: active.position_ms,
        duration_ms,
        trim_start_ms: 0,
        trim_end_ms: duration_ms,
        waveform: waveform_from_samples(&processed_samples, WAVEFORM_BUCKETS),
        lane: active.lane,
    })
}

pub fn restart(cache_dir: PathBuf, position_ms: u64, lane: u32, settings: AudioSettings, state: &mut RecordingState) -> Result<RecordingSummary, AudioError> {
    if let Some(active) = state.active.take() {
        drop(active.stream);
        let _ = fs::remove_file(active.file_path);
    }
    start(cache_dir, position_ms, lane, settings, state)
}

pub fn preview(state: &RecordingState) -> Option<RecordingPreviewStatus> {
    let active = state.active.as_ref()?;
    let samples = active.samples.lock().map(|values| values.clone()).unwrap_or_default();
    Some(RecordingPreviewStatus {
        active: true,
        start_ms: active.position_ms,
        duration_ms: active.started_at.elapsed().as_millis().max(1) as u64,
        waveform: waveform_from_samples(&samples, WAVEFORM_BUCKETS),
        lane: active.lane,
    })
}

pub fn input_devices() -> Result<Vec<InputDeviceInfo>, AudioError> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|device| device.name().ok());
    let devices = host.input_devices().map_err(|error| AudioError::InputConfig(error.to_string()))?;
    let mut results = Vec::new();
    for device in devices {
        let name = device.name().map_err(|error| AudioError::InputConfig(error.to_string()))?;
        results.push(InputDeviceInfo {
            is_default: default_name.as_ref().is_some_and(|default| default == &name),
            name,
        });
    }
    Ok(results)
}

pub fn calibrate_noise(input_device_name: Option<&str>, duration_ms: u64) -> Result<NoiseCalibrationResult, AudioError> {
    let samples = Arc::new(Mutex::new(Vec::new()));
    let stream = build_raw_input_stream(input_device_name, Arc::clone(&samples))?;
    stream.play().map_err(|error| AudioError::StreamPlay(error.to_string()))?;
    thread::sleep(Duration::from_millis(duration_ms.max(1)));
    drop(stream);
    let captured = samples.lock().map(|values| values.clone()).unwrap_or_default();
    Ok(analyze_calibration(&captured, duration_ms))
}

fn summary(active: &ActiveRecording) -> RecordingSummary {
    RecordingSummary {
        id: active.id,
        position_ms: active.position_ms,
        rnnoise_enabled: active.noise_reduction.enabled,
        preset: format!("RNNoise {}%", (active.noise_reduction.strength * 100.0).round()),
    }
}

fn build_input_stream(input_device_name: Option<&str>, samples: Arc<Mutex<Vec<f32>>>, reducer: Arc<Mutex<LiveNoiseReducer>>) -> Result<Stream, AudioError> {
    let host = cpal::default_host();
    let device = select_input_device(&host, input_device_name)?;
    let supported_config = device.default_input_config().map_err(|error| AudioError::InputConfig(error.to_string()))?;
    let sample_format = supported_config.sample_format();
    let config: StreamConfig = supported_config.into();
    let channels = config.channels as usize;
    let error_callback = |error| eprintln!("Ses akışı hatası: {error}");

    match sample_format {
        SampleFormat::F32 => device.build_input_stream(&config, move |data: &[f32], _| push_frames(data, channels, &samples, &reducer), error_callback, None),
        SampleFormat::I16 => device.build_input_stream(&config, move |data: &[i16], _| push_frames(data, channels, &samples, &reducer), error_callback, None),
        SampleFormat::U16 => device.build_input_stream(&config, move |data: &[u16], _| push_frames(data, channels, &samples, &reducer), error_callback, None),
        other => return Err(AudioError::InputConfig(format!("Desteklenmeyen sample format: {other:?}"))),
    }
    .map_err(|error| AudioError::StreamBuild(error.to_string()))
}

fn build_raw_input_stream(input_device_name: Option<&str>, samples: Arc<Mutex<Vec<f32>>>) -> Result<Stream, AudioError> {
    let host = cpal::default_host();
    let device = select_input_device(&host, input_device_name)?;
    let supported_config = device.default_input_config().map_err(|error| AudioError::InputConfig(error.to_string()))?;
    let sample_format = supported_config.sample_format();
    let config: StreamConfig = supported_config.into();
    let channels = config.channels as usize;
    let error_callback = |error| eprintln!("Kalibrasyon ses akışı hatası: {error}");

    match sample_format {
        SampleFormat::F32 => device.build_input_stream(&config, move |data: &[f32], _| push_raw_frames(data, channels, &samples), error_callback, None),
        SampleFormat::I16 => device.build_input_stream(&config, move |data: &[i16], _| push_raw_frames(data, channels, &samples), error_callback, None),
        SampleFormat::U16 => device.build_input_stream(&config, move |data: &[u16], _| push_raw_frames(data, channels, &samples), error_callback, None),
        other => return Err(AudioError::InputConfig(format!("Desteklenmeyen sample format: {other:?}"))),
    }
    .map_err(|error| AudioError::StreamBuild(error.to_string()))
}

fn select_input_device(host: &cpal::Host, input_device_name: Option<&str>) -> Result<cpal::Device, AudioError> {
    if let Some(target_name) = input_device_name.filter(|name| !name.is_empty()) {
        let devices = host.input_devices().map_err(|error| AudioError::InputConfig(error.to_string()))?;
        for device in devices {
            let name = device.name().map_err(|error| AudioError::InputConfig(error.to_string()))?;
            if name == target_name {
                return Ok(device);
            }
        }
    }
    host.default_input_device().ok_or(AudioError::NoInputDevice)
}

fn push_frames<T>(data: &[T], channels: usize, samples: &Arc<Mutex<Vec<f32>>>, reducer: &Arc<Mutex<LiveNoiseReducer>>)
where
    T: Copy + IntoSampleF32,
{
    let mono = mono_frames(data, channels);
    let processed = reducer.lock().map(|mut processor| processor.process_samples(&mono)).unwrap_or(mono);
    if processed.is_empty() {
        return;
    }
    if let Ok(mut output) = samples.lock() {
        output.extend(processed);
    }
}

fn push_raw_frames<T>(data: &[T], channels: usize, samples: &Arc<Mutex<Vec<f32>>>)
where
    T: Copy + IntoSampleF32,
{
    let mono = mono_frames(data, channels);
    if let Ok(mut output) = samples.lock() {
        output.extend(mono);
    }
}

fn mono_frames<T>(data: &[T], channels: usize) -> Vec<f32>
where
    T: Copy + IntoSampleF32,
{
    data.chunks(channels.max(1))
        .map(|frame| {
            let sum: f32 = frame.iter().map(|sample| sample.into_sample_f32()).sum();
            (sum / frame.len() as f32).clamp(-1.0, 1.0)
        })
        .collect()
}

fn write_recording(file_path: &PathBuf, samples: &[f32]) -> Result<(), AudioError> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: BIT_DEPTH,
        sample_format: WavSampleFormat::Int,
    };
    let mut writer = WavWriter::create(file_path, spec)?;
    for sample in samples {
        writer.write_sample((sample * MAX_I24_AMPLITUDE) as i32)?;
    }
    writer.finalize()?;
    Ok(())
}

fn trim_recording_edges(samples: &mut Vec<f32>, trim_ms: u64) {
    if trim_ms == 0 || samples.is_empty() {
        return;
    }
    let trim_samples = ((TARGET_SAMPLE_RATE as u64 * trim_ms) / 1_000) as usize;
    if trim_samples == 0 || samples.len() <= trim_samples * 2 {
        return;
    }
    samples.drain(..trim_samples);
    let keep_len = samples.len().saturating_sub(trim_samples);
    samples.truncate(keep_len);
}

fn samples_to_ms(sample_count: usize) -> u64 {
    (sample_count as u64 * 1_000) / TARGET_SAMPLE_RATE as u64
}

fn apply_edge_fade(samples: &mut [f32], fade_ms: u64) {
    if samples.len() < 2 || fade_ms == 0 {
        return;
    }
    let fade_samples = ((TARGET_SAMPLE_RATE as u64 * fade_ms) / 1_000) as usize;
    let fade_len = fade_samples.min(samples.len() / 2).max(1);
    for index in 0..fade_len {
        let factor = index as f32 / fade_len as f32;
        samples[index] *= factor;
        let end_index = samples.len() - 1 - index;
        samples[end_index] *= factor;
    }
}

fn waveform_from_samples(samples: &[f32], buckets: usize) -> Vec<f32> {
    if samples.is_empty() {
        return vec![0.04; buckets];
    }
    let bucket_size = (samples.len() / buckets.max(1)).max(1);
    let peaks: Vec<f32> = (0..buckets)
        .map(|index| {
            let start = index * bucket_size;
            let end = (start + bucket_size).min(samples.len());
            if start >= end {
                return 0.04;
            }
            let sum = samples[start..end].iter().map(|sample| sample.abs()).sum::<f32>();
            (sum / (end - start) as f32).max(samples[start..end].iter().map(|sample| sample.abs()).fold(0.0, f32::max) * 0.65)
        })
        .collect();
    let max_peak = peaks.iter().copied().fold(0.0, f32::max).max(0.001);
    peaks.into_iter().map(|peak| (peak / max_peak).clamp(0.04, 1.0)).collect()
}

fn analyze_calibration(samples: &[f32], duration_ms: u64) -> NoiseCalibrationResult {
    if samples.is_empty() {
        return NoiseCalibrationResult { duration_ms, rms: 0.0, peak: 0.0, noise_floor: 0.0, recommended_strength: 0.92 };
    }
    let peak = samples.iter().map(|sample| sample.abs()).fold(0.0, f32::max);
    let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt();
    let noise_window = (samples.len() / 4).max(1);
    let noise_floor = (samples.iter().take(noise_window).map(|sample| sample * sample).sum::<f32>() / noise_window as f32).sqrt();
    let speech_ratio = if noise_floor <= 0.0001 { 24.0 } else { rms / noise_floor };
    let recommended_strength = if noise_floor > 0.045 || speech_ratio < 2.0 {
        0.96
    } else if noise_floor > 0.026 || speech_ratio < 3.2 {
        0.9
    } else if noise_floor > 0.014 {
        0.8
    } else {
        0.68
    };
    NoiseCalibrationResult { duration_ms, rms, peak, noise_floor, recommended_strength }
}

trait IntoSampleF32 {
    fn into_sample_f32(self) -> f32;
}

impl IntoSampleF32 for f32 {
    fn into_sample_f32(self) -> f32 {
        self
    }
}

impl IntoSampleF32 for i16 {
    fn into_sample_f32(self) -> f32 {
        self as f32 / i16::MAX as f32
    }
}

impl IntoSampleF32 for u16 {
    fn into_sample_f32(self) -> f32 {
        (self as f32 / u16::MAX as f32) * 2.0 - 1.0
    }
}
