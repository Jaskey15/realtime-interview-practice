"use client";

import { useEffect, useRef, useSyncExternalStore, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";
import { InterviewView } from "@/components/interview-view";
import type { InterviewConfig } from "@/lib/types";

function useSessionConfig(): InterviewConfig | null {
  const cachedRef = useRef<{ raw: string | null; parsed: InterviewConfig | null }>({
    raw: null,
    parsed: null,
  });

  return useSyncExternalStore(
    () => () => {},
    () => {
      const stored = sessionStorage.getItem("interviewConfig");
      if (stored !== cachedRef.current.raw) {
        cachedRef.current = {
          raw: stored,
          parsed: stored ? (JSON.parse(stored) as InterviewConfig) : null,
        };
      }
      return cachedRef.current.parsed;
    },
    () => null,
  );
}

export default function InterviewPage() {
  const router = useRouter();
  const config = useSessionConfig();
  const { connect, disconnect, status, transcripts, audioLevel } =
    useRealtime();

  useEffect(() => {
    if (!config) {
      router.push("/");
    }
  }, [config, router]);

  const handleEnd = useCallback(() => {
    disconnect();
    sessionStorage.setItem("interviewTranscript", JSON.stringify(transcripts));
    router.push("/feedback");
  }, [disconnect, transcripts, router]);

  if (!config) return null;

  return (
    <InterviewView
      config={config}
      status={status}
      transcripts={transcripts}
      audioLevel={audioLevel}
      onConnect={connect}
      onEnd={handleEnd}
    />
  );
}
