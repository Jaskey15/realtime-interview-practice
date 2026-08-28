"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  LiveAvatarSession,
  SessionEvent,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";

export type AvatarStatus = "idle" | "connecting" | "active" | "failed" | "stopped";

const KEEP_ALIVE_MS = 4 * 60 * 1000; // provider idle timeout is 5 min
const STREAM_READY_TIMEOUT_MS = 15_000;

/**
 * LITE-mode session with streaming audio input. The public repeatAudio() sends a
 * full speak+speak_end sequence per call, which fragments utterances when called
 * per chunk. The event WebSocket is protected on the base class, so this subclass
 * streams agent.speak chunks and sends exactly one agent.speak_end per utterance.
 */
class LiteAudioSession extends LiveAvatarSession {
  private utteranceId: string | null = null;

  speakAudioChunk(base64Pcm: string): void {
    const ws = this._sessionEventSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!this.utteranceId) this.utteranceId = crypto.randomUUID();
    ws.send(
      JSON.stringify({ type: "agent.speak", event_id: this.utteranceId, audio: base64Pcm }),
    );
  }

  speakEnd(): void {
    const ws = this._sessionEventSocket;
    const id = this.utteranceId;
    this.utteranceId = null;
    if (!ws || ws.readyState !== WebSocket.OPEN || !id) return;
    ws.send(JSON.stringify({ type: "agent.speak_end", event_id: id }));
  }

  resetUtterance(): void {
    this.utteranceId = null;
  }
}

export function useHeygenAvatar() {
  const [status, setStatus] = useState<AvatarStatus>("idle");
  const sessionRef = useRef<LiteAudioSession | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamReadyRef = useRef(false);
  const stoppingRef = useRef(false); // intentional stop — ignore late disconnect events
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    streamReadyRef.current = false;
    sessionRef.current = null;
  }, []);

  /**
   * Ends the session server-side; safe to call repeatedly. Pass "failed" when the
   * shutdown should surface the video-unavailable fallback UI (e.g. the page's
   * start deadline expired before the stream became ready).
   */
  const disconnect = useCallback(
    (finalStatus: "idle" | "failed" = "idle") => {
      const session = sessionRef.current;
      stoppingRef.current = true;
      teardown();
      session?.stop().catch(() => {});
      setStatus(finalStatus);
    },
    [teardown],
  );

  // Unmount safety: never leave a billable session running. Set stoppingRef even
  // when no session exists yet — connect() may still be mid-flight (e.g. awaiting
  // the token fetch) and must not proceed to start a session after unmount.
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      if (sessionRef.current) {
        sessionRef.current.stop().catch(() => {});
      }
      teardown();
    };
  }, [teardown]);

  /** Registers the <video> element; attaches immediately if the stream is ready. */
  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamReadyRef.current && sessionRef.current) {
      sessionRef.current.attach(el);
    }
  }, []);

  const connect = useCallback(
    async (durationMinutes: number, interviewType: string): Promise<void> => {
      stoppingRef.current = false;
      setStatus("connecting");
      try {
        const res = await fetch("/api/heygen/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ durationMinutes, interviewType }),
        });
        if (!res.ok) throw new Error("Failed to get avatar session token");
        const { sessionToken } = await res.json();

        // disconnect()/unmount may have fired while awaiting the fetch above; no
        // session existed yet for them to stop, so bail out before creating one.
        if (stoppingRef.current) return;

        const session = new LiteAudioSession(sessionToken, { voiceChat: false });
        sessionRef.current = session;

        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          if (stoppingRef.current) return;
          streamReadyRef.current = true;
          if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
          }
          if (videoElRef.current) session.attach(videoElRef.current);
          setStatus("active"); // only now: media is attachable, OpenAI may mute
        });
        session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
          if (stoppingRef.current) return;
          // Server-side stops: NO_CREDITS, IDLE_TIMEOUT, MAX_DURATION, errors
          console.warn("Avatar session disconnected:", reason);
          teardown();
          setStatus("stopped");
        });
        session.on(AgentEventsEnum.SESSION_STOPPED, (event) => {
          if (stoppingRef.current) return;
          console.warn("Avatar session stopped:", event.stop_reason);
          teardown();
          setStatus("stopped");
        });

        await session.start();

        // disconnect()/unmount may have fired while awaiting start(); the session
        // now exists, so stop it (it's real and billable) rather than leaving it
        // running, and skip arming the watchdog/keep-alive.
        if (stoppingRef.current) {
          session.stop().catch(() => {});
          teardown();
          return;
        }

        // Stream must become ready promptly or we fall back.
        watchdogRef.current = setTimeout(() => {
          if (!streamReadyRef.current && !stoppingRef.current) {
            stoppingRef.current = true;
            session.stop().catch(() => {});
            teardown();
            setStatus("failed");
          }
        }, STREAM_READY_TIMEOUT_MS);

        keepAliveRef.current = setInterval(() => {
          sessionRef.current?.keepAlive().catch(() => {
            // A concurrent disconnect() may have already torn this down and set
            // status to "idle" — don't let a late rejection flip it to "stopped".
            if (stoppingRef.current) return;
            teardown();
            setStatus("stopped");
          });
        }, KEEP_ALIVE_MS);
      } catch (err) {
        console.error("Avatar connection failed:", err);
        teardown();
        setStatus("failed");
      }
    },
    [teardown],
  );

  /** Streams one base64 PCM16 24 kHz chunk of interviewer audio to the avatar. */
  const sendAudioChunk = useCallback((base64Pcm: string) => {
    sessionRef.current?.speakAudioChunk(base64Pcm);
  }, []);

  /** Utterance boundary — sends the single agent.speak_end for the utterance. */
  const endOfSpeech = useCallback(() => {
    sessionRef.current?.speakEnd();
  }, []);

  const interrupt = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.resetUtterance();
    try {
      session.interrupt(); // public method; throws if not connected
    } catch {
      // Session no longer connected — nothing to interrupt.
    }
  }, []);

  return {
    status,
    connect,
    disconnect,
    setVideoElement,
    sendAudioChunk,
    endOfSpeech,
    interrupt,
  };
}
