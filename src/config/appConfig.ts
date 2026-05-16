export const appConfig = {
  audio: {
    sampleRateLabel: "48kHz / 24-bit WAV",
    rnnoisePreset: "RNNoise 92%",
    rnnoiseMode: "Kayıt sonrası nnnoiseless DSP",
  },
  timeline: {
    basePixelsPerSecond: 96,
    minZoom: 0.4,
    maxZoom: 6,
    snapMs: 250,
  },
  theme: {
    meterWarning: 0.72,
  },
} as const;
