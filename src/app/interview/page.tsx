"use client";

import { useEffect, useRef, useSyncExternalStore, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";
import { useHeygenAvatar } from "@/hooks/use-heygen-avatar";
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

const AVATAR_START_DEADLINE_MS = 10_000;

export default function InterviewPage() {
  const router = useRouter();
  const config = useSessionConfig();
  const {
    connect,
    disconnect,
    status,
    transcripts,
    audioLevel,
    bridgeAvailable,
    startConversation,
    setAudioSink,
    setOutputMuted,
  } = useRealtime();
  const {
    status: avatarStatus,
    connect: connectAvatar,
    disconnect: disconnectAvatar,
    setVideoElement,
    sendAudioChunk,
    endOfSpeech,
    interrupt,
  } = useHeygenAvatar();

  useEffect(() => {
    if (!config) {
      router.push("/");
    }
  }, [config, router]);

  // Without the audio bridge the avatar can never receive audio — shut it down.
  useEffect(() => {
    if (bridgeAvailable === false && (avatarStatus === "connecting" || avatarStatus === "active")) {
      disconnectAvatar();
    }
  }, [bridgeAvailable, avatarStatus, disconnectAvatar]);

  // Route interviewer audio to the avatar only while its stream is live.
  useEffect(() => {
    if (avatarStatus === "active" && bridgeAvailable) {
      setAudioSink({
        onAudioChunk: sendAudioChunk,
        onSpeechEnd: endOfSpeech,
        onInterrupt: interrupt,
      });
      setOutputMuted(true);
    } else {
      setAudioSink(null);
      setOutputMuted(false);
    }
  }, [avatarStatus, bridgeAvailable, sendAudioChunk, endOfSpeech, interrupt, setAudioSink, setOutputMuted]);

  // First AI response: wait for the avatar to settle, capped by a deadline.
  const avatarSettled =
    avatarStatus === "active" || avatarStatus === "failed" || avatarStatus === "stopped";
  useEffect(() => {
    if (status !== "connected") return;
    if (avatarSettled || bridgeAvailable === false) {
      startConversation();
      return;
    }
    const t = setTimeout(startConversation, AVATAR_START_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [status, avatarSettled, bridgeAvailable, startConversation]);

  const handleConnect = useCallback(
    (cfg: InterviewConfig) => {
      connect(cfg);
      connectAvatar(cfg.durationMinutes); // parallel; failure just means orb fallback
    },
    [connect, connectAvatar],
  );

  const handleEnd = useCallback(() => {
    disconnectAvatar();
    disconnect();
    sessionStorage.setItem("interviewTranscript", JSON.stringify(transcripts));
    router.push("/feedback");
  }, [disconnectAvatar, disconnect, transcripts, router]);

  if (!config) return null;

  return (
    <InterviewView
      config={config}
      status={status}
      transcripts={transcripts}
      audioLevel={audioLevel}
      avatarStatus={avatarStatus}
      onVideoElement={setVideoElement}
      onConnect={handleConnect}
      onEnd={handleEnd}
    />
  );
}
