"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useMicCheck } from "@/hooks/use-mic-check";
import type { InterviewConfig, InterviewType, TranscriptEntry } from "@/lib/types";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const TYPE_LABELS: Record<InterviewType, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
  "case-study": "Case Study",
  general: "General",
};

type Interviewer = { name: string; title: string; previewUrl: string | null };

/** Who the candidate is about to meet — resolved server-side so the still we
 *  show is the avatar the session will actually render. */
function useInterviewer(interviewType: InterviewType): Interviewer | null {
  const [interviewer, setInterviewer] = useState<Interviewer | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/heygen/avatar?type=${interviewType}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setInterviewer(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [interviewType]);

  return interviewer;
}

function MicIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

function MicCheck({ state, level }: { state: string; level: number }) {
  if (state === "denied") {
    return (
      <div className="flex items-center gap-2 text-xs text-warning">
        <MicIcon muted />
        Microphone blocked — enable it in your browser settings
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-xs text-text-muted">
      <MicIcon />
      <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${Math.min(100, level * 400)}%` }}
        />
      </div>
      {state === "ready" ? "Mic ready" : "Checking mic..."}
    </div>
  );
}

/** Circular still of the interviewer, or their initial if HeyGen has no preview. */
function AvatarPortrait({
  interviewer,
  size,
  pulsing = false,
}: {
  interviewer: Interviewer | null;
  size: number;
  pulsing?: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-full border border-border-subtle bg-surface-raised shadow-[0_0_40px_rgba(34,211,238,0.12)]"
      style={{
        width: size,
        height: size,
        animation: pulsing ? "portrait-pulse 2.5s ease-in-out infinite" : "none",
      }}
    >
      {interviewer?.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- external HeyGen CDN, no loader needed
        <img
          src={interviewer.previewUrl}
          alt=""
          className="h-full w-full object-cover"
          // Stock avatars are framed as medium shots; crop in on the head so
          // the portrait reads as a face and not a distant figure.
          style={{ objectPosition: "center 22%", transform: "scale(1.6)" }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-display text-text-secondary"
          style={{ fontSize: size * 0.36 }}
        >
          {interviewer?.name?.[0] ?? ""}
        </div>
      )}
    </div>
  );
}

export function InterviewView({
  config,
  status,
  transcripts,
  audioLevel,
  avatarStatus,
  onVideoElement,
  onConnect,
  onEnd,
}: {
  config: InterviewConfig;
  status: string;
  transcripts: TranscriptEntry[];
  audioLevel: number;
  avatarStatus: string;
  onVideoElement: (el: HTMLVideoElement | null) => void;
  onConnect: (config: InterviewConfig) => void;
  onEnd: () => void;
}) {
  const maxSeconds = config.durationMinutes * 60;
  const warnSeconds = Math.floor(maxSeconds * 0.8);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);

  const interviewer = useInterviewer(config.interviewType);
  const mic = useMicCheck(!started);

  useEffect(() => {
    if (status !== "connected") return;
    const interval = setInterval(() => {
      setElapsed((prev) => {
        if (prev + 1 >= maxSeconds) {
          onEnd();
          return maxSeconds;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, onEnd, maxSeconds]);

  const handleStart = useCallback(() => {
    setStarted(true);
    onConnect(config);
  }, [config, onConnect]);

  const isWarning = elapsed >= warnSeconds;
  const remaining = maxSeconds - elapsed;

  // Orb dynamics driven by audio level
  const orbScale = 1 + audioLevel * 0.6;
  const glowIntensity = audioLevel * 50;
  const morphSpeed = started ? Math.max(3, 8 - audioLevel * 5) : 8;

  // Timer color: smooth transition from cyan → warning → danger
  const timerProgress = elapsed / maxSeconds;
  const timerColor = useMemo(() => {
    if (timerProgress < 0.7) return "var(--color-accent-cyan)";
    if (timerProgress < 0.85) return "var(--color-warning)";
    return "var(--color-danger)";
  }, [timerProgress]);

  const timerGlow = useMemo(() => {
    if (timerProgress < 0.7) return "0 0 12px rgba(34, 211, 238, 0.3)";
    if (timerProgress < 0.85) return "0 0 12px rgba(251, 191, 36, 0.4)";
    return "0 0 16px rgba(248, 113, 113, 0.5)";
  }, [timerProgress]);

  // Video is live / avatar is gone for good / still bringing the avatar up.
  const showVideo = avatarStatus === "active";
  const avatarDown = avatarStatus === "failed" || avatarStatus === "stopped";
  const connecting = started && !showVideo && !avatarDown;

  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden bg-[#0b0b0e]">
      {/* Ambient background glow */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: "50%",
          left: "50%",
          width: "min(700px, 90vw)",
          height: "min(700px, 90vw)",
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(ellipse at center, rgba(61, 139, 253, ${0.06 + audioLevel * 0.04}) 0%, rgba(34, 211, 238, ${0.03 + audioLevel * 0.02}) 35%, transparent 70%)`,
          animation: started ? "atmosphere-breathe 10s ease-in-out infinite" : "none",
          opacity: started ? 1 : 0,
          transition: "opacity 1.5s ease",
        }}
      />

      {/* Backdrop: the live video, or a blurred still of the same avatar before
          it connects — the lobby occupies the frame the video will fill, so
          Begin is a crossfade rather than a jump. */}
      {showVideo ? (
        <video
          ref={onVideoElement}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-cover"
        />
      ) : (
        interviewer?.previewUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- external HeyGen CDN, no loader needed */}
            <img
              src={interviewer.previewUrl}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
            />
            <div className="absolute inset-0 bg-black/50" />
          </>
        )
      )}

      {/* Scrims keep the floating chrome legible over bright video */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/75 to-transparent" />

      {/* Floating status indicator — top left */}
      <div className="absolute top-6 left-6 z-10 flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            status === "connected"
              ? "bg-success"
              : status === "connecting"
                ? "bg-warning animate-pulse"
                : status === "error"
                  ? "bg-danger"
                  : "bg-text-muted"
          }`}
        />
        <span className="text-xs text-text-muted">
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting..."
              : status === "error"
                ? "Connection error"
                : "Ready"}
        </span>
      </div>

      {/* Floating timer — top right */}
      {started && (
        <div
          className="absolute top-5 right-6 z-10 font-mono text-2xl tracking-widest"
          style={{
            color: timerColor,
            textShadow: timerGlow,
            transition: "color 2s ease, text-shadow 2s ease",
          }}
        >
          {formatTime(remaining)}
        </div>
      )}

      {/* Green room: who you're meeting, and whether your mic works */}
      {!started && (
        <div className="relative z-10 flex flex-col items-center gap-6 text-center">
          <AvatarPortrait interviewer={interviewer} size={132} />
          <div className="flex flex-col gap-1">
            <div className="font-display text-2xl text-text-primary">
              {interviewer?.name ?? " "}
            </div>
            <div className="text-sm text-text-secondary">
              {interviewer?.title ?? " "}
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">
            {TYPE_LABELS[config.interviewType]} &middot; {config.durationMinutes} min &middot;{" "}
            {config.interviewerStyle}
          </div>
          <MicCheck state={mic.state} level={mic.level} />
        </div>
      )}

      {/* Bringing the avatar up — same portrait, so nothing jumps */}
      {connecting && (
        <div className="relative z-10 flex flex-col items-center gap-5">
          <AvatarPortrait interviewer={interviewer} size={132} pulsing />
          <div className="text-sm text-text-secondary">
            Connecting to {interviewer?.name ?? "your interviewer"}...
          </div>
        </div>
      )}

      {/* Voice-only fallback: the orb stands in for the video that isn't coming */}
      {started && avatarDown && (
        <div
          className="relative z-10 flex items-center justify-center"
          style={{ width: 200, height: 200 }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: `radial-gradient(circle at 35% 35%, rgba(34, 211, 238, 0.25), rgba(61, 139, 253, 0.15) 60%, rgba(61, 139, 253, 0.05))`,
              border: "1px solid rgba(34, 211, 238, 0.2)",
              transform: `scale(${orbScale})`,
              boxShadow: `0 0 ${glowIntensity}px rgba(34, 211, 238, ${0.15 + audioLevel * 0.25}), 0 0 ${glowIntensity * 2}px rgba(61, 139, 253, ${0.05 + audioLevel * 0.1}), inset 0 0 ${glowIntensity * 0.5}px rgba(34, 211, 238, ${audioLevel * 0.15})`,
              transition: "transform 0.15s ease-out, box-shadow 0.15s ease-out",
            }}
          />
        </div>
      )}

      {/* Quiet fallback notice: only when video was expected but died mid-interview */}
      {started && avatarDown && (
        <div className="absolute bottom-24 left-0 right-0 z-10 text-center text-xs text-text-muted">
          Video unavailable — continuing in voice mode
        </div>
      )}

      {/* Floating controls — bottom center */}
      <div className="absolute bottom-8 left-0 right-0 z-10 flex justify-center">
        {!started ? (
          <button
            onClick={handleStart}
            disabled={mic.state === "denied"}
            className="btn-glow rounded-xl px-10 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Begin Interview
          </button>
        ) : (
          <button
            onClick={onEnd}
            disabled={status !== "connected"}
            className="rounded-xl border border-border-subtle bg-black/40 px-8 py-3 text-sm font-medium text-text-secondary backdrop-blur-sm transition-all hover:border-danger/40 hover:text-danger hover:shadow-[0_0_16px_rgba(248,113,113,0.15)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            End Interview
          </button>
        )}
      </div>
    </div>
  );
}
