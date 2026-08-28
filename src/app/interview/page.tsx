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

  // If the realtime connection dies after Begin (mic denied, handshake failure,
  // mid-interview drop), don't leave a billable avatar session running with no
  // way to stop it (the End button is disabled unless realtime is connected).
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current && (status === "error" || status === "idle")) {
      disconnectAvatar();
    }
  }, [status, disconnectAvatar]);

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
    const t = setTimeout(() => {
      // The deadline is definitive: an avatar that becomes ready after the
      // opening response has started must not mute OpenAI mid-utterance.
      disconnectAvatar("failed");
      startConversation();
    }, AVATAR_START_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [status, avatarSettled, bridgeAvailable, startConversation, disconnectAvatar]);

  const handleConnect = useCallback(
    (cfg: InterviewConfig) => {
      startedRef.current = true;
      connect(cfg);
      connectAvatar(cfg.durationMinutes, cfg.interviewType); // parallel; failure just means orb fallback
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
