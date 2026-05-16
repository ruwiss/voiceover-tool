import { Minus, Pause, Play, Plus, Rows3 } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { appConfig } from "../config/appConfig";
import type { Clip, RecordingPreview, TimelineProject, TimelineUpdate } from "../types/domain";

type TimelineProps = {
  project: TimelineProject;
  recordingPreview: RecordingPreview | null;
  onUpdate: (update: TimelineUpdate) => Promise<void>;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  toolbar: ReactNode;
};

type DragState =
  | { mode: "move"; clipId: string; originX: number; originY: number; originStartMs: number; originLane: number; previewStartMs: number; previewLane: number }
  | { mode: "trimStart" | "trimEnd"; clipId: string; originX: number; originStartMs: number; originTrimStartMs: number; originTrimEndMs: number; previewStartMs: number; previewTrimStartMs: number; previewTrimEndMs: number };

type MarqueeState = { originX: number; originY: number; currentX: number; currentY: number; active: boolean };

export function Timeline({ project, recordingPreview, onUpdate, playing, onPlayingChange, toolbar }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const playbackStartedRef = useRef<number | null>(null);
  const playbackOriginRef = useRef(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [playheadDrag, setPlayheadDrag] = useState<number | null>(null);
  const [playheadPreviewMs, setPlayheadPreviewMs] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [smoothPlayheadMs, setSmoothPlayheadMs] = useState(project.playhead_ms);
  const [laneCount, setLaneCount] = useState(1);
  const [laneHeight, setLaneHeight] = useState(92);
  const [laneResize, setLaneResize] = useState<{ originY: number; originHeight: number } | null>(null);
  const [laneMenu, setLaneMenu] = useState<{ lane: number; x: number; y: number } | null>(null);
  const pixelsPerMs = (appConfig.timeline.basePixelsPerSecond * project.zoom) / 1_000;
  const effectiveLaneCount = Math.min(3, Math.max(laneCount, ...project.clips.map((clip) => clip.lane + 1), recordingPreview?.active ? recordingPreview.lane + 1 : 0));
  const laneGap = 8;
  const laneTop = 36;
  const recordingDurationMs = recordingPreview?.active ? Math.max(1, recordingPreview.duration_ms) : 0;
  const recordingEndMs = recordingPreview?.active ? recordingPreview.start_ms + recordingDurationMs : 0;
  const width = Math.max(980, recordingEndMs * pixelsPerMs + 240, ...project.clips.map((clip) => (clip.start_ms + clip.duration_ms) * pixelsPerMs + 240));
  const visiblePlayheadMs = playheadDrag ?? playheadPreviewMs ?? (playing ? smoothPlayheadMs : project.playhead_ms);
  const previewSelection = marquee?.active ? previewSelectedClipIds(marquee, project.clips, pixelsPerMs, laneTop, laneHeight, laneGap) : [];

  useEffect(() => {
    if (!playing) setSmoothPlayheadMs(project.playhead_ms);
  }, [playing, project.playhead_ms]);

  useEffect(() => {
    if (!playing) {
      audioRefs.current.forEach((audio) => audio.pause());
      playbackStartedRef.current = null;
      return;
    }

    const startMs = project.playhead_ms;
    const endMs = timelineEndMs(project.clips);
    if (project.clips.length === 0 || startMs >= endMs) {
      onPlayingChange(false);
      return;
    }

    playbackStartedRef.current = performance.now();
    playbackOriginRef.current = startMs;
    const startedClipIds = new Set<string>();
    let frame = 0;

    const tick = (now: number) => {
      const startedAt = playbackStartedRef.current;
      if (startedAt === null) return;
      const currentMs = playbackOriginRef.current + now - startedAt;
      setSmoothPlayheadMs(currentMs);

      for (const clip of project.clips) {
        const clipVisibleEndMs = clip.start_ms + clip.trim_end_ms - clip.trim_start_ms;
        const isActive = currentMs >= clip.start_ms && currentMs < clipVisibleEndMs;
        const audio = audioRefs.current.get(clip.id);
        if (!audio) continue;
        if (!isActive) {
          if (currentMs < clip.start_ms || currentMs >= clipVisibleEndMs) audio.pause();
          continue;
        }
        if (!startedClipIds.has(clip.id) || audio.paused) {
          audio.currentTime = (clip.trim_start_ms + currentMs - clip.start_ms) / 1_000;
          void audio.play();
          startedClipIds.add(clip.id);
        }
      }

      if (currentMs >= endMs) {
        void onUpdate({ type: "setPlayhead", playhead_ms: Math.round(endMs) });
        onPlayingChange(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      const startedAt = playbackStartedRef.current;
      if (startedAt !== null) {
        const currentMs = Math.min(endMs, playbackOriginRef.current + performance.now() - startedAt);
        void onUpdate({ type: "setPlayhead", playhead_ms: Math.round(currentMs) });
      }
      playbackStartedRef.current = null;
      audioRefs.current.forEach((audio) => audio.pause());
    };
  }, [playing, project.clips, project.playhead_ms, onPlayingChange, onUpdate]);

  useEffect(() => {
    if (!drag) return;

    const onPointerMove = (event: PointerEvent) => {
      const deltaMs = (event.clientX - drag.originX) / pixelsPerMs;
      setDrag((current) => {
        if (!current) return current;
        if (current.mode === "move") {
          const deltaLane = Math.round((event.clientY - current.originY) / (laneHeight + laneGap));
          const previewLane = clamp(current.originLane + deltaLane, 0, Math.min(2, effectiveLaneCount - 1));
          const clip = project.clips.find((item) => item.id === current.clipId);
          const clipDurationMs = clip ? clip.trim_end_ms - clip.trim_start_ms : 0;
          return {
            ...current,
            previewStartMs: snapClipStart(project.clips, current.clipId, current.originStartMs + deltaMs, clipDurationMs, previewLane, project.snapping_enabled),
            previewLane,
          };
        }
        const clip = project.clips.find((item) => item.id === current.clipId);
        if (!clip) return current;
        const delta = normalizeDeltaMs(deltaMs, project.snapping_enabled);
        if (current.mode === "trimStart") {
          const previewTrimStartMs = clamp(current.originTrimStartMs + delta, 0, current.previewTrimEndMs - appConfig.timeline.snapMs);
          const previewStartMs = Math.max(0, current.originStartMs + previewTrimStartMs - current.originTrimStartMs);
          return { ...current, previewStartMs, previewTrimStartMs };
        }
        const rawTrimEndMs = clamp(current.originTrimEndMs + delta, current.previewTrimStartMs + appConfig.timeline.snapMs, clip.duration_ms);
        const previewTrimEndMs = snapTrimEnd(project.clips, clip, rawTrimEndMs, project.snapping_enabled);
        return { ...current, previewTrimEndMs };
      });
    };

    const onPointerUp = () => {
      const currentDrag = drag;
      setDrag(null);
      if (currentDrag.mode === "move") {
        void onUpdate({ type: "moveClip", clip_id: currentDrag.clipId, start_ms: currentDrag.previewStartMs, lane: currentDrag.previewLane });
        return;
      }
      void onUpdate({
        type: "trimClip",
        clip_id: currentDrag.clipId,
        trim_start_ms: currentDrag.previewTrimStartMs,
        trim_end_ms: currentDrag.previewTrimEndMs,
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag, onUpdate, pixelsPerMs, project.snapping_enabled]);

  useEffect(() => {
    if (!laneResize) return;
    const onPointerMove = (event: PointerEvent) => {
      setLaneHeight(clamp(laneResize.originHeight + event.clientY - laneResize.originY, 56, 124));
    };
    const onPointerUp = () => setLaneResize(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [laneResize]);

  useEffect(() => {
    if (!laneMenu) return;
    const closeMenu = () => setLaneMenu(null);
    window.addEventListener("pointerdown", closeMenu, { once: true });
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, [laneMenu]);

  useEffect(() => {
    if (!marquee) return;
    const onPointerMove = (event: PointerEvent) => {
      const point = trackPointFromClient(event.clientX, event.clientY, trackRef.current);
      if (!point) return;
      setMarquee((current) => current ? { ...current, currentX: point.x, currentY: point.y, active: current.active || distance(current.originX, current.originY, point.x, point.y) > 4 } : current);
    };
    const onPointerUp = () => {
      const currentMarquee = marquee;
      setMarquee(null);
      if (!currentMarquee.active) {
        void onUpdate({ type: "setPlayhead", playhead_ms: normalizeMs(currentMarquee.originX / pixelsPerMs, project.snapping_enabled) });
        void onUpdate({ type: "select", clip_ids: [] });
        return;
      }
      const rect = normalizeRect(currentMarquee.originX, currentMarquee.originY, currentMarquee.currentX, currentMarquee.currentY);
      const clip_ids = project.clips
        .filter((clip) => intersects(rect, clipRect(clip, pixelsPerMs, laneTop, laneHeight, laneGap)))
        .map((clip) => clip.id);
      void onUpdate({ type: "select", clip_ids });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [marquee, onUpdate, pixelsPerMs, project.clips, project.snapping_enabled, laneHeight]);

  useEffect(() => {
    if (playheadDrag === null) return;

    const onPointerMove = (event: PointerEvent) => {
      const playhead_ms = playheadMsFromClientX(event.clientX, trackRef.current, pixelsPerMs, project.snapping_enabled);
      setPlayheadDrag(playhead_ms);
      setPlayheadPreviewMs(playhead_ms);
    };

    const onPointerUp = () => {
      const nextPlayhead = playheadDrag;
      setPlayheadDrag(null);
      setPlayheadPreviewMs(nextPlayhead);
      void onUpdate({ type: "setPlayhead", playhead_ms: nextPlayhead });
      window.setTimeout(() => setPlayheadPreviewMs(null), 80);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [playheadDrag, onUpdate, pixelsPerMs, project.snapping_enabled]);

  const selectClip = (clip: Clip, additive: boolean) => {
    const nextSelection = additive
      ? project.selection.includes(clip.id)
        ? project.selection.filter((id) => id !== clip.id)
        : [...project.selection, clip.id]
      : [clip.id];
    void onUpdate({ type: "select", clip_ids: nextSelection });
  };

  const startPlayheadDrag = (event: MouseEvent<HTMLDivElement>) => {
    const playhead_ms = playheadMsFromClientX(event.clientX, trackRef.current, pixelsPerMs, project.snapping_enabled);
    setPlayheadDrag(playhead_ms);
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-header">
        <div className="timeline-toolbar">{toolbar}</div>
        <div className="timeline-zoom-controls">
          <button onClick={() => onPlayingChange(!playing)} aria-label={playing ? "Duraklat" : "Oynat"}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <span className="timeline-time-readout">{formatMs(visiblePlayheadMs)}</span>
          <button onClick={() => void onUpdate({ type: "setZoom", zoom: project.zoom - 0.25 })} aria-label="Uzaklaş">
            <Minus size={15} />
          </button>
          <span>{Math.round(project.zoom * 100)}%</span>
          <button onClick={() => void onUpdate({ type: "setZoom", zoom: project.zoom + 0.25 })} aria-label="Yakınlaş">
            <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="timeline-body">
        <aside
          className="track-sidebar"
          style={{ paddingTop: laneTop }}
          onContextMenu={(event) => {
            event.preventDefault();
            const laneElement = (event.target as HTMLElement).closest<HTMLElement>(".track-lane-header");
            const lane = Number(laneElement?.dataset.lane ?? 0);
            setLaneMenu({ lane, x: event.clientX, y: event.clientY });
          }}
        >
          {Array.from({ length: effectiveLaneCount }).map((_, index) => (
            <div className="track-lane-header" data-lane={index} key={index} style={{ height: laneHeight, marginBottom: index === effectiveLaneCount - 1 ? 0 : laneGap }}>
              <Rows3 size={13} />
              <span>A{index + 1}</span>
              {index === effectiveLaneCount - 1 && effectiveLaneCount < 3 ? (
                <button type="button" onClick={() => setLaneCount((count) => Math.min(3, Math.max(count, index + 2)))} aria-label="Alt satır ekle"><Plus size={13} /></button>
              ) : <span />}
              <div
                className="track-lane-resizer"
                onPointerDown={(event) => {
                  event.preventDefault();
                  setLaneResize({ originY: event.clientY, originHeight: laneHeight });
                }}
              />
            </div>
          ))}
          {laneMenu ? (
            <div className="track-context-menu" style={{ left: laneMenu.x, top: laneMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  void onUpdate({ type: "deleteLane", lane: laneMenu.lane });
                  setLaneCount((count) => Math.max(1, count - 1));
                  setLaneMenu(null);
                }}
              >
                Sil
              </button>
            </div>
          ) : null}
        </aside>
        <div className="timeline-scroll">
          <div
            className="track"
            ref={trackRef}
            style={{ width, height: laneTop + effectiveLaneCount * laneHeight + Math.max(0, effectiveLaneCount - 1) * laneGap + 12 }}
          onWheel={(event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            const zoom = project.zoom + (event.deltaY < 0 ? 0.25 : -0.25);
            void onUpdate({ type: "setZoom", zoom });
          }}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("article")) return;
            const point = trackPointFromClient(event.clientX, event.clientY, trackRef.current);
            if (!point) return;
            if (point.y <= laneTop) {
              startPlayheadDrag(event);
              return;
            }
            setMarquee({ originX: point.x, originY: point.y, currentX: point.x, currentY: point.y, active: false });
          }}
          >
          <div className="ruler" style={{ width }}>
            {Array.from({ length: Math.ceil(width / 120) }).map((_, index) => (
              <span key={index} style={{ left: index * 120 }}>{index}s</span>
            ))}
          </div>
          <div
            className="playhead"
            style={{ left: visiblePlayheadMs * pixelsPerMs }}
            onPointerDown={(event) => {
              event.stopPropagation();
              startPlayheadDrag(event);
            }}
          />
          {marquee?.active ? (
            <div className="marquee-selection" style={marqueeStyle(marquee)} />
          ) : null}
          {project.clips.length === 0 ? <div className="empty-state" /> : null}
          {recordingPreview?.active ? (
            <article
              className="clip recording-preview"
              style={{ left: recordingPreview.start_ms * pixelsPerMs, top: laneTop + recordingPreview.lane * (laneHeight + laneGap), height: laneHeight, width: Math.max(2, recordingDurationMs * pixelsPerMs) }}
            >
              <div className="recording-preview-line" />
              <Waveform values={recordingPreview.waveform} trimStartMs={0} trimEndMs={recordingDurationMs} durationMs={recordingDurationMs} />
              <span>{formatMs(recordingDurationMs)}</span>
            </article>
          ) : null}
          {project.clips.map((clip) => {
            const isCurrentDrag = drag?.clipId === clip.id;
            const previewStartMs = isCurrentDrag && drag.mode === "move" ? drag.previewStartMs : clip.start_ms;
            const previewTrimStartMs = isCurrentDrag && drag.mode !== "move" ? drag.previewTrimStartMs : clip.trim_start_ms;
            const previewStartWithTrimMs = isCurrentDrag && drag.mode === "trimStart" ? drag.previewStartMs : previewStartMs;
            const previewLane = isCurrentDrag && drag.mode === "move" ? drag.previewLane : clip.lane;
            const previewTrimEndMs = isCurrentDrag && drag.mode !== "move" ? drag.previewTrimEndMs : clip.trim_end_ms;
            return (
            <article
              className={project.selection.includes(clip.id) || previewSelection.includes(clip.id) ? "clip selected dragging-ready" : "clip dragging-ready"}
              key={clip.id}
              style={{ left: previewStartWithTrimMs * pixelsPerMs, top: laneTop + previewLane * (laneHeight + laneGap), height: laneHeight, width: Math.max(16, (previewTrimEndMs - previewTrimStartMs) * pixelsPerMs) }}
              onClick={(event) => {
                event.stopPropagation();
                selectClip(clip, event.shiftKey || event.ctrlKey);
              }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                event.stopPropagation();
                setDrag({ mode: "move", clipId: clip.id, originX: event.clientX, originY: event.clientY, originStartMs: clip.start_ms, originLane: clip.lane, previewStartMs: clip.start_ms, previewLane: clip.lane });
              }}
            >
              <button
                className="trim-handle start"
                aria-label="Baş trim"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDrag({
                    mode: "trimStart",
                    clipId: clip.id,
                    originX: event.clientX,
                    originStartMs: clip.start_ms,
                    originTrimStartMs: clip.trim_start_ms,
                    originTrimEndMs: clip.trim_end_ms,
                    previewStartMs: clip.start_ms,
                    previewTrimStartMs: clip.trim_start_ms,
                    previewTrimEndMs: clip.trim_end_ms,
                  });
                }}
              />
              <button
                className="trim-handle end"
                aria-label="Son trim"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDrag({
                    mode: "trimEnd",
                    clipId: clip.id,
                    originX: event.clientX,
                    originStartMs: clip.start_ms,
                    originTrimStartMs: clip.trim_start_ms,
                    originTrimEndMs: clip.trim_end_ms,
                    previewStartMs: clip.start_ms,
                    previewTrimStartMs: clip.trim_start_ms,
                    previewTrimEndMs: clip.trim_end_ms,
                  });
                }}
              />
              <div className="clip-topline">
                <span>{formatMs(previewTrimEndMs - previewTrimStartMs)}</span>
              </div>
              <Waveform values={clip.waveform} trimStartMs={previewTrimStartMs} trimEndMs={previewTrimEndMs} durationMs={clip.duration_ms} />
              <audio ref={(node) => {
                if (node) audioRefs.current.set(clip.id, node);
                else audioRefs.current.delete(clip.id);
              }} src={convertFileSrc(clip.source_path)} preload="auto" />
            </article>
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Waveform({ values, trimStartMs, trimEndMs, durationMs }: { values: number[]; trimStartMs: number; trimEndMs: number; durationMs: number }) {
  const visibleValues = trimWaveform(values, trimStartMs, trimEndMs, durationMs);
  const width = Math.max(160, visibleValues.length * 3);
  const height = 56;
  const center = height / 2;
  const points = visibleValues.map((value, index) => {
    const x = visibleValues.length <= 1 ? 0 : (index / (visibleValues.length - 1)) * width;
    const y = center - Math.max(1, value * center);
    return `${x},${y}`;
  });
  const mirror = [...visibleValues].reverse().map((value, index) => {
    const x = visibleValues.length <= 1 ? 0 : ((visibleValues.length - 1 - index) / (visibleValues.length - 1)) * width;
    const y = center + Math.max(1, value * center);
    return `${x},${y}`;
  });

  return (
    <svg className="waveform" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={[...points, ...mirror].join(" ")} />
      <line x1="0" y1={center} x2={width} y2={center} />
    </svg>
  );
}

function trimWaveform(values: number[], trimStartMs: number, trimEndMs: number, durationMs: number) {
  if (values.length === 0 || durationMs <= 0) return values;
  const startIndex = Math.floor((trimStartMs / durationMs) * values.length);
  const endIndex = Math.ceil((trimEndMs / durationMs) * values.length);
  return values.slice(clamp(startIndex, 0, values.length - 1), clamp(endIndex, 1, values.length));
}

function timelineEndMs(clips: Clip[]) {
  return clips.reduce((endMs, clip) => Math.max(endMs, clip.start_ms + clip.trim_end_ms - clip.trim_start_ms), 0);
}

function trackPointFromClient(clientX: number, clientY: number, track: HTMLDivElement | null) {
  if (!track) return null;
  const rect = track.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return { left, top, right: Math.max(x1, x2), bottom: Math.max(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function clipRect(clip: Clip, pixelsPerMs: number, laneTop: number, laneHeight: number, laneGap: number) {
  const left = clip.start_ms * pixelsPerMs;
  const top = laneTop + clip.lane * (laneHeight + laneGap);
  const width = Math.max(16, (clip.trim_end_ms - clip.trim_start_ms) * pixelsPerMs);
  return { left, top, right: left + width, bottom: top + laneHeight, width, height: laneHeight };
}

function intersects(a: ReturnType<typeof normalizeRect>, b: ReturnType<typeof clipRect>) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function previewSelectedClipIds(marquee: MarqueeState, clips: Clip[], pixelsPerMs: number, laneTop: number, laneHeight: number, laneGap: number) {
  const rect = normalizeRect(marquee.originX, marquee.originY, marquee.currentX, marquee.currentY);
  return clips
    .filter((clip) => intersects(rect, clipRect(clip, pixelsPerMs, laneTop, laneHeight, laneGap)))
    .map((clip) => clip.id);
}

function snapClipStart(clips: Clip[], clipId: string, rawStartMs: number, durationMs: number, lane: number, snappingEnabled: boolean) {
  const normalizedStartMs = normalizeMs(rawStartMs, snappingEnabled);
  if (!snappingEnabled) return normalizedStartMs;
  const thresholdMs = appConfig.timeline.snapMs;
  for (const clip of clips) {
    if (clip.id === clipId || clip.lane !== lane) continue;
    const clipStartMs = clip.start_ms;
    const clipEndMs = clip.start_ms + clip.trim_end_ms - clip.trim_start_ms;
    if (Math.abs(normalizedStartMs - clipEndMs) <= thresholdMs) return clipEndMs;
    if (Math.abs(normalizedStartMs + durationMs - clipStartMs) <= thresholdMs) return Math.max(0, clipStartMs - durationMs);
  }
  return normalizedStartMs;
}

function snapTrimEnd(clips: Clip[], activeClip: Clip, rawTrimEndMs: number, snappingEnabled: boolean) {
  if (!snappingEnabled) return rawTrimEndMs;
  const activeEndMs = activeClip.start_ms + rawTrimEndMs - activeClip.trim_start_ms;
  const thresholdMs = appConfig.timeline.snapMs;
  for (const clip of clips) {
    if (clip.id === activeClip.id || clip.lane !== activeClip.lane) continue;
    if (Math.abs(activeEndMs - clip.start_ms) <= thresholdMs) {
      return clamp(clip.start_ms - activeClip.start_ms + activeClip.trim_start_ms, activeClip.trim_start_ms + thresholdMs, activeClip.duration_ms);
    }
  }
  return rawTrimEndMs;
}

function marqueeStyle(marquee: MarqueeState) {
  const rect = normalizeRect(marquee.originX, marquee.originY, marquee.currentX, marquee.currentY);
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function formatMs(value: number) {
  return `${(value / 1_000).toFixed(2)}s`;
}

function normalizeMs(value: number, snappingEnabled: boolean) {
  const safeValue = Math.max(0, value);
  if (!snappingEnabled) return Math.round(safeValue);
  return Math.round(safeValue / appConfig.timeline.snapMs) * appConfig.timeline.snapMs;
}

function normalizeDeltaMs(value: number, snappingEnabled: boolean) {
  if (!snappingEnabled) return Math.round(value);
  return Math.round(value / appConfig.timeline.snapMs) * appConfig.timeline.snapMs;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function playheadMsFromClientX(clientX: number, track: HTMLDivElement | null, pixelsPerMs: number, snappingEnabled: boolean) {
  if (!track) return 0;
  const rect = track.getBoundingClientRect();
  const localX = clientX - rect.left;
  return normalizeMs(localX / pixelsPerMs, snappingEnabled);
}
