"use client";

import { useState, useRef, useCallback } from "react";
import type {
  InterviewConfig,
  ConnectionStatus,
  TranscriptEntry,
} from "@/lib/types";
import { PcmChunker } from "@/lib/pcm";

/** Receives the interviewer's audio as base64 PCM16 24 kHz chunks. */
export interface RealtimeAudioSink {
  onAudioChunk: (base64Pcm: string) => void;
  onSpeechEnd: () => void;
  onInterrupt: () => void;
}

export function useRealtime() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(
    null,
  );

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const wrapUpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiTranscriptBuffer = useRef("");
  const sinkRef = useRef<RealtimeAudioSink | null>(null);
  const chunkerRef = useRef<PcmChunker | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletReadyRef = useRef(false);
  const aiSpeakingRef = useRef(false);
  const conversationStartedRef = useRef(false);

  function handleServerEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = event.transcript as string | undefined;
        if (transcript?.trim()) {
          setTranscripts((prev) => [
            ...prev,
            { speaker: "user", text: transcript.trim() },
          ]);
        }
        break;
      }

      case "response.output_audio_transcript.delta": {
        const delta = event.delta as string;
        aiTranscriptBuffer.current += delta;

        setTranscripts((prev) => {
          const last = prev[prev.length - 1];
          if (last?.speaker === "interviewer") {
            return [
              ...prev.slice(0, -1),
              { speaker: "interviewer", text: aiTranscriptBuffer.current },
            ];
          }
          return [
            ...prev,
            { speaker: "interviewer", text: aiTranscriptBuffer.current },
          ];
        });
        break;
      }

      case "response.output_audio_transcript.done": {
        aiTranscriptBuffer.current = "";
        break;
      }

      case "output_audio_buffer.started": {
        aiSpeakingRef.current = true;
        break;
      }

      case "output_audio_buffer.stopped": {
        aiSpeakingRef.current = false;
        chunkerRef.current?.flush(); // send the final partial chunk
        sinkRef.current?.onSpeechEnd();
        break;
      }

      case "output_audio_buffer.cleared": {
        // User barge-in: drop buffered audio and stop the avatar's mouth
        aiSpeakingRef.current = false;
        chunkerRef.current?.discard();
        sinkRef.current?.onInterrupt();
        break;
      }
    }
  }

  const cleanup = useCallback(() => {
    if (wrapUpTimeoutRef.current) {
      clearTimeout(wrapUpTimeoutRef.current);
      wrapUpTimeoutRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    if (workletRef.current) {
      workletRef.current.port.onmessage = null;
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    chunkerRef.current = null;
    sinkRef.current = null;
    workletReadyRef.current = false;
    aiSpeakingRef.current = false;
    conversationStartedRef.current = false;
    setAudioLevel(0);
  }, []);

  const connect = useCallback(
    async (config: InterviewConfig) => {
      setStatus("connecting");
      setTranscripts([]);

      try {
        // 1. Fetch ephemeral key
        const res = await fetch("/api/realtime/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobDescription: config.jobDescription,
            focusPrompt: config.focusPrompt,
            interviewType: config.interviewType,
            interviewerStyle: config.interviewerStyle,
            durationMinutes: config.durationMinutes,
          }),
        });

        if (!res.ok) throw new Error("Failed to get session token");
        const { client_secret } = await res.json();

        // 1.5 Audio bridge (optional): 24 kHz context + capture worklet for the avatar.
        // Failure here must never break the voice interview — degrade to voice-only.
        workletReadyRef.current = false;
        let ctx: AudioContext | undefined;
        try {
          ctx = new AudioContext({ sampleRate: 24000 });
          if (ctx.state === "suspended") await ctx.resume();
          if (ctx.sampleRate !== 24000) {
            throw new Error(`AudioContext rate ${ctx.sampleRate}, need 24000`);
          }
          await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
          audioCtxRef.current = ctx;
          workletReadyRef.current = true;
          setBridgeAvailable(true);
        } catch (err) {
          console.warn("Avatar audio bridge unavailable, voice-only mode:", err);
          ctx?.close();
          audioCtxRef.current = new AudioContext(); // analyser-only fallback, default rate
          setBridgeAvailable(false);
        }

        // 2. Create peer connection
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        // 3. Remote audio playback + volume analyser
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audioRef.current = audio;
        pc.ontrack = (e) => {
          const remoteStream = e.streams[0];
          audio.srcObject = remoteStream;

          // Wire up Web Audio analyser for volume metering
          const ctx = audioCtxRef.current!;
          const source = ctx.createMediaStreamSource(remoteStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.5;
          source.connect(analyser);
          analyserRef.current = analyser;

          if (workletReadyRef.current) {
            // Tap for the avatar audio sink: 1 s chunks of PCM16 @ 24 kHz.
            const worklet = new AudioWorkletNode(ctx, "pcm-capture");
            chunkerRef.current = new PcmChunker(24000, (b64) => {
              sinkRef.current?.onAudioChunk(b64);
            });
            worklet.port.onmessage = (msg: MessageEvent<Float32Array>) => {
              if (sinkRef.current && aiSpeakingRef.current) {
                chunkerRef.current?.push(msg.data);
              }
            };
            // Zero-gain branch to the destination keeps the worklet processing
            // without audibly doubling the audio element's playback.
            const silent = ctx.createGain();
            silent.gain.value = 0;
            source.connect(worklet);
            worklet.connect(silent);
            silent.connect(ctx.destination);
            workletRef.current = worklet;
          }

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          function tick() {
            analyser.getByteFrequencyData(dataArray);
            // Average the frequency bins into a 0-1 level
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length / 255;
            setAudioLevel(avg);
            rafRef.current = requestAnimationFrame(tick);
          }
          tick();
        };

        // 4. Capture mic
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;
        pc.addTrack(stream.getTracks()[0]);

        // 5. Open data channel
        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onopen = () => {
          setStatus("connected");

          const wrapUpMs = Math.max(0, (config.durationMinutes - 2) * 60_000);
          wrapUpTimeoutRef.current = setTimeout(() => {
            if (dc.readyState !== "open") return;
            dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: "[System: 2 minutes remaining. After the candidate's current answer, wrap up: acknowledge time, thank them, invite their questions.]",
                    },
                  ],
                },
              }),
            );
          }, wrapUpMs);
        };
        dc.onmessage = (e) => handleServerEvent(JSON.parse(e.data));
        dc.onerror = () => setStatus("error");
        dc.onclose = () => setStatus("idle");

        // 6. SDP handshake
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            body: offer.sdp,
            headers: {
              Authorization: `Bearer ${client_secret}`,
              "Content-Type": "application/sdp",
            },
          },
        );

        if (!sdpRes.ok) throw new Error("SDP handshake failed");

        const answer: RTCSessionDescriptionInit = {
          type: "answer",
          sdp: await sdpRes.text(),
        };
        await pc.setRemoteDescription(answer);
      } catch (err) {
        console.error("Connection failed:", err);
        setStatus("error");
        cleanup();
      }
    },
    [cleanup],
  );

  const disconnect = useCallback(() => {
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  /**
   * Sends the initial response.create. Idempotent — the page calls this once
   * the avatar has settled (active/failed/stopped) or a deadline passes.
   */
  const startConversation = useCallback(() => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open" || conversationStartedRef.current)
      return;
    conversationStartedRef.current = true;
    dc.send(JSON.stringify({ type: "response.create" }));
  }, []);

  /** Attach/detach the avatar audio sink. Muting the local element is separate. */
  const setAudioSink = useCallback((sink: RealtimeAudioSink | null) => {
    sinkRef.current = sink;
  }, []);

  /** Mute/unmute the local OpenAI audio playback (avatar plays its own synced audio). */
  const setOutputMuted = useCallback((muted: boolean) => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, []);

  return {
    connect,
    disconnect,
    status,
    transcripts,
    audioLevel,
    bridgeAvailable,
    startConversation,
    setAudioSink,
    setOutputMuted,
  };
}
