use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CacheSummary {
    pub removed_files: usize,
    pub cache_path: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CacheStatus {
    pub size_bytes: u64,
}

#[derive(Debug, Error)]
pub enum CacheError {
    #[error("Dosya işlemi başarısız: {0}")]
    Io(#[from] std::io::Error),
}

pub fn clear(cache_dir: PathBuf) -> Result<CacheSummary, CacheError> {
    let mut removed_files = 0;
    for folder in [cache_dir.join("recordings"), cache_dir.join("exports")] {
        if folder.exists() {
            for entry in fs::read_dir(&folder)? {
                let entry = entry?;
                if entry.file_type()?.is_file() {
                    fs::remove_file(entry.path())?;
                    removed_files += 1;
                }
            }
        }
    }
    Ok(CacheSummary {
        removed_files,
        cache_path: cache_dir.to_string_lossy().to_string(),
        size_bytes: 0,
    })
}

pub fn status(cache_dir: PathBuf) -> Result<CacheStatus, CacheError> {
    Ok(CacheStatus { size_bytes: cache_size(&cache_dir)? })
}

fn cache_size(cache_dir: &PathBuf) -> Result<u64, CacheError> {
    let mut size_bytes = 0;
    for folder in [cache_dir.join("recordings"), cache_dir.join("exports")] {
        if folder.exists() {
            for entry in fs::read_dir(&folder)? {
                let entry = entry?;
                if entry.file_type()?.is_file() {
                    size_bytes += entry.metadata()?.len();
                }
            }
        }
    }
    Ok(size_bytes)
}
