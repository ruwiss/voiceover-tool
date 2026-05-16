use crate::timeline::{Clip, TimelineProject};
use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

const SAMPLE_RATE: u32 = 48_000;
const BIT_DEPTH: u16 = 24;
const MAX_I24_AMPLITUDE: f32 = 8_388_607.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ExportRequest {
    pub clip_ids: Vec<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ExportResult {
    pub path: String,
    pub file_name: String,
    pub duration_ms: u64,
    pub clip_count: usize,
}

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("Export için clip yok")]
    EmptyTimeline,
    #[error("Dosya işlemi başarısız: {0}")]
    Io(#[from] std::io::Error),
    #[error("WAV yazılamadı: {0}")]
    Wav(#[from] hound::Error),
    #[error("Clip ses dosyası okunamadı: {0}")]
    SourceRead(String),
}

pub fn prepare(cache_dir: PathBuf, project: &TimelineProject, request: ExportRequest) -> Result<ExportResult, ExportError> {
    let clips = selected_clips(project, &request.clip_ids);
    if clips.is_empty() {
        return Err(ExportError::EmptyTimeline);
    }
    let exports_dir = cache_dir.join("exports");
    fs::create_dir_all(&exports_dir)?;
    let file_name = format!("voiceover-export-rev-{}.wav", project.revision);
    let file_path = exports_dir.join(&file_name);
    let duration_ms = clips.iter().map(|clip| clip.start_ms + clip.trim_end_ms - clip.trim_start_ms).max().unwrap_or(0);
    write_mixdown(&file_path, &clips, duration_ms)?;
    Ok(ExportResult {
        path: file_path.to_string_lossy().to_string(),
        file_name,
        duration_ms,
        clip_count: clips.len(),
    })
}

fn selected_clips<'a>(project: &'a TimelineProject, clip_ids: &[Uuid]) -> Vec<&'a Clip> {
    if clip_ids.is_empty() {
        return project.clips.iter().collect();
    }
    project.clips.iter().filter(|clip| clip_ids.contains(&clip.id)).collect()
}

fn write_mixdown(file_path: &PathBuf, clips: &[&Clip], duration_ms: u64) -> Result<(), ExportError> {
    let total_samples = ms_to_samples(duration_ms);
    let mut mix = vec![0.0_f32; total_samples];

    for clip in clips {
        let source = read_clip_samples(clip)?;
        let source_start = ms_to_samples(clip.trim_start_ms).min(source.len());
        let source_end = ms_to_samples(clip.trim_end_ms).min(source.len());
        let target_start = ms_to_samples(clip.start_ms);

        for (offset, sample) in source[source_start..source_end].iter().enumerate() {
            let target_index = target_start + offset;
            if target_index >= mix.len() {
                break;
            }
            mix[target_index] = (mix[target_index] + sample).clamp(-1.0, 1.0);
        }
    }

    let spec = WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: BIT_DEPTH,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(file_path, spec)?;
    for sample in mix {
        writer.write_sample((sample * MAX_I24_AMPLITUDE) as i32)?;
    }
    writer.finalize()?;
    Ok(())
}

fn read_clip_samples(clip: &Clip) -> Result<Vec<f32>, ExportError> {
    let mut reader = WavReader::open(&clip.source_path).map_err(|error| ExportError::SourceRead(error.to_string()))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let samples = match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Int, 24 | 32) => reader
            .samples::<i32>()
            .map(|sample| sample.map(|value| value as f32 / MAX_I24_AMPLITUDE))
            .collect::<Result<Vec<_>, _>>()?,
        (SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|sample| sample.map(|value| value as f32 / i16::MAX as f32))
            .collect::<Result<Vec<_>, _>>()?,
        (SampleFormat::Float, 32) => reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?,
        _ => return Err(ExportError::SourceRead(format!("Desteklenmeyen WAV formatı: {:?} {} bit", spec.sample_format, spec.bits_per_sample))),
    };
    Ok(to_mono(samples, channels))
}

fn to_mono(samples: Vec<f32>, channels: usize) -> Vec<f32> {
    if channels == 1 {
        return samples;
    }
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

fn ms_to_samples(value: u64) -> usize {
    (SAMPLE_RATE as u64 * value / 1_000) as usize
}
