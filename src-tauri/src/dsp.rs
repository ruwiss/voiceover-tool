use nnnoiseless::DenoiseState;

const PCM_I16_SCALE: f32 = i16::MAX as f32;

#[derive(Clone, Debug)]
pub struct NoiseReductionConfig {
    pub enabled: bool,
    pub strength: f32,
}

pub struct LiveNoiseReducer {
    config: NoiseReductionConfig,
    denoise: Box<DenoiseState<'static>>,
    pending: Vec<f32>,
    first_frame: bool,
}

impl Default for NoiseReductionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            strength: 0.92,
        }
    }
}

impl LiveNoiseReducer {
    pub fn new(config: NoiseReductionConfig) -> Self {
        Self {
            config,
            denoise: DenoiseState::new(),
            pending: Vec::with_capacity(DenoiseState::FRAME_SIZE * 2),
            first_frame: true,
        }
    }

    pub fn process_samples(&mut self, samples: &[f32]) -> Vec<f32> {
        if !self.config.enabled {
            return samples.iter().copied().map(clamp_sample).collect();
        }

        self.pending.extend(samples.iter().copied());
        let mut output = Vec::with_capacity(samples.len());
        while self.pending.len() >= DenoiseState::FRAME_SIZE {
            let frame: Vec<f32> = self.pending.drain(..DenoiseState::FRAME_SIZE).collect();
            output.extend(self.process_frame(&frame));
        }
        output
    }

    pub fn flush_pending(&mut self) -> Vec<f32> {
        let pending: Vec<f32> = self.pending.drain(..).collect();
        if !self.config.enabled {
            return pending.into_iter().map(clamp_sample).collect();
        }
        pending.into_iter().map(apply_noise_gate).collect()
    }

    fn process_frame(&mut self, frame: &[f32]) -> Vec<f32> {
        let frame_in: Vec<f32> = frame.iter().map(|sample| sample * PCM_I16_SCALE).collect();
        let mut frame_out = vec![0.0_f32; DenoiseState::FRAME_SIZE];
        self.denoise.process_frame(&mut frame_out, &frame_in);

        if self.first_frame {
            self.first_frame = false;
            return frame.iter().copied().map(apply_noise_gate).collect();
        }

        frame
            .iter()
            .zip(frame_out.iter().map(|sample| (sample / PCM_I16_SCALE).clamp(-1.0, 1.0)))
            .map(|(dry, wet)| blend(*dry, wet, self.config.strength))
            .collect()
    }
}

fn blend(dry: f32, wet: f32, strength: f32) -> f32 {
    let amount = strength.clamp(0.0, 1.0);
    (dry * (1.0 - amount) + wet * amount).clamp(-1.0, 1.0)
}

fn apply_noise_gate(sample: f32) -> f32 {
    if sample.abs() < 0.012 {
        0.0
    } else {
        sample.clamp(-1.0, 1.0)
    }
}

fn clamp_sample(sample: f32) -> f32 {
    sample.clamp(-1.0, 1.0)
}
