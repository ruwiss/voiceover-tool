use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct TimelineProject {
    pub clips: Vec<Clip>,
    pub selection: Vec<Uuid>,
    pub playhead_ms: u64,
    pub zoom: f32,
    pub snapping_enabled: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Clip {
    pub id: Uuid,
    pub name: String,
    pub source_path: String,
    pub start_ms: u64,
    pub duration_ms: u64,
    pub trim_start_ms: u64,
    pub trim_end_ms: u64,
    pub waveform: Vec<f32>,
    #[serde(default)]
    pub lane: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TimelineUpdate {
    MoveClip { clip_id: Uuid, start_ms: u64, lane: u32 },
    TrimClip { clip_id: Uuid, trim_start_ms: u64, trim_end_ms: u64 },
    SplitClip { clip_id: Uuid, split_ms: u64 },
    Select { clip_ids: Vec<Uuid> },
    SetPlayhead { playhead_ms: u64 },
    SetZoom { zoom: f32 },
    ToggleSnapping { enabled: bool },
    DeleteSelected,
    DeleteLane { lane: u32 },
}

#[derive(Debug, Error)]
pub enum TimelineError {
    #[error("Clip bulunamadı")]
    ClipNotFound,
    #[error("Geçersiz trim aralığı")]
    InvalidTrim,
    #[error("Geçersiz split noktası")]
    InvalidSplit,
}

pub fn apply_update(project: &mut TimelineProject, update: TimelineUpdate) -> Result<(), TimelineError> {
    match update {
        TimelineUpdate::MoveClip { clip_id, start_ms, lane } => {
            let clip = clip_mut(project, clip_id)?;
            clip.start_ms = start_ms;
            clip.lane = lane;
        }
        TimelineUpdate::TrimClip { clip_id, trim_start_ms, trim_end_ms } => {
            let clip = clip_mut(project, clip_id)?;
            if trim_start_ms >= trim_end_ms || trim_end_ms > clip.duration_ms {
                return Err(TimelineError::InvalidTrim);
            }
            if trim_start_ms >= clip.trim_start_ms {
                clip.start_ms += trim_start_ms - clip.trim_start_ms;
            } else {
                clip.start_ms = clip.start_ms.saturating_sub(clip.trim_start_ms - trim_start_ms);
            }
            clip.trim_start_ms = trim_start_ms;
            clip.trim_end_ms = trim_end_ms;
        }
        TimelineUpdate::SplitClip { clip_id, split_ms } => split_clip(project, clip_id, split_ms)?,
        TimelineUpdate::Select { clip_ids } => project.selection = clip_ids,
        TimelineUpdate::SetPlayhead { playhead_ms } => project.playhead_ms = playhead_ms,
        TimelineUpdate::SetZoom { zoom } => project.zoom = zoom.clamp(0.4, 6.0),
        TimelineUpdate::ToggleSnapping { enabled } => project.snapping_enabled = enabled,
        TimelineUpdate::DeleteSelected => {
            delete_selected(project);
        }
        TimelineUpdate::DeleteLane { lane } => {
            project.clips.retain(|clip| clip.lane != lane);
            for clip in &mut project.clips {
                if clip.lane > lane {
                    clip.lane -= 1;
                }
            }
            project.selection.clear();
        }
    }
    project.revision += 1;
    Ok(())
}

pub fn is_history_update(update: &TimelineUpdate) -> bool {
    !matches!(update, TimelineUpdate::SetPlayhead { .. } | TimelineUpdate::SetZoom { .. } | TimelineUpdate::ToggleSnapping { .. } | TimelineUpdate::Select { .. })
}

fn clip_mut(project: &mut TimelineProject, clip_id: Uuid) -> Result<&mut Clip, TimelineError> {
    project.clips.iter_mut().find(|clip| clip.id == clip_id).ok_or(TimelineError::ClipNotFound)
}

fn split_clip(project: &mut TimelineProject, clip_id: Uuid, split_ms: u64) -> Result<(), TimelineError> {
    let index = project.clips.iter().position(|clip| clip.id == clip_id).ok_or(TimelineError::ClipNotFound)?;
    let clip = project.clips[index].clone();
    if split_ms <= clip.trim_start_ms || split_ms >= clip.trim_end_ms {
        return Err(TimelineError::InvalidSplit);
    }
    project.clips[index].trim_end_ms = split_ms;
    let mut right = clip.clone();
    right.id = Uuid::new_v4();
    right.name = format!("{} B", clip.name);
    right.start_ms = clip.start_ms + split_ms - clip.trim_start_ms;
    right.trim_start_ms = split_ms;
    project.selection = vec![right.id];
    project.clips.push(right);
    Ok(())
}

fn delete_selected(project: &mut TimelineProject) {
    let removed: Vec<(u32, u64, u64)> = project
        .clips
        .iter()
        .filter(|clip| project.selection.contains(&clip.id))
        .map(|clip| (clip.lane, clip.start_ms, clip.trim_end_ms - clip.trim_start_ms))
        .collect();
    project.clips.retain(|clip| !project.selection.contains(&clip.id));
    if project.snapping_enabled {
        for (lane, start_ms, duration_ms) in removed {
            for clip in project.clips.iter_mut().filter(|clip| clip.lane == lane && clip.start_ms >= start_ms + duration_ms) {
                clip.start_ms = clip.start_ms.saturating_sub(duration_ms);
            }
        }
    }
    project.selection.clear();
}
