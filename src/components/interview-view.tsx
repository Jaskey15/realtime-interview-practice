"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { InterviewConfig, TranscriptEntry } from "@/lib/types";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function InterviewView({
  config,
  status,
  transcripts,
  audioLevel,
  onConnect,
  onEnd,
}: {
  config: InterviewConfig;
  status: string;
  transcripts: TranscriptEntry[];
  audioLevel: number;
  onConnect: (config: InterviewConfig) => void;
  onEnd: () => void;
}) {
  const maxSeconds = config.durationMinutes * 60;
  const warnSeconds = Math.floor(maxSeconds * 0.8);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);

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

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-[#0b0b0e]">
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

      {/* Floating status indicator — top left */}
      <div className="absolute top-6 left-6 flex items-center gap-2">
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
          className="absolute top-5 right-6 font-mono text-2xl tracking-widest"
          style={{
            color: timerColor,
            textShadow: timerGlow,
            transition: "color 2s ease, text-shadow 2s ease",
          }}
        >
          {formatTime(remaining)}
        </div>
      )}

      {/* Morphing blob orb */}
      <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 35%, rgba(34, 211, 238, 0.25), rgba(61, 139, 253, 0.15) 60%, rgba(61, 139, 253, 0.05))`,
            border: "1px solid rgba(34, 211, 238, 0.2)",
            transform: `scale(${started ? orbScale : 1})`,
            boxShadow: started
              ? `0 0 ${glowIntensity}px rgba(34, 211, 238, ${0.15 + audioLevel * 0.25}), 0 0 ${glowIntensity * 2}px rgba(61, 139, 253, ${0.05 + audioLevel * 0.1}), inset 0 0 ${glowIntensity * 0.5}px rgba(34, 211, 238, ${audioLevel * 0.15})`
              : "0 0 20px rgba(34, 211, 238, 0.08), inset 0 0 10px rgba(34, 211, 238, 0.05)",
            transition: "transform 0.15s ease-out, box-shadow 0.15s ease-out",
          }}
        />
      </div>

      {/* Floating controls — bottom center */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center">
        {!started ? (
          <button
            onClick={handleStart}
            className="btn-glow rounded-xl px-10 py-3.5 font-semibold text-white"
          >
            Begin Interview
          </button>
        ) : (
          <button
            onClick={onEnd}
            disabled={status !== "connected"}
            className="rounded-xl border border-border-subtle bg-transparent px-8 py-3 text-sm font-medium text-text-muted transition-all hover:border-danger/40 hover:text-danger hover:shadow-[0_0_16px_rgba(248,113,113,0.15)] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            End Interview
          </button>
        )}
      </div>
    </div>
  );
}
