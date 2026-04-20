"use client";

import { useState, useRef, useCallback } from "react";
import type {
  InterviewConfig,
  ConnectionStatus,
  TranscriptEntry,
} from "@/lib/types";

export function useRealtime() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const wrapUpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiTranscriptBuffer = useRef("");

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
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(remoteStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.5;
          source.connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;

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
          dc.send(JSON.stringify({ type: "response.create" }));

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

  return {
    connect,
    disconnect,
    status,
    transcripts,
    audioLevel,
  };
}
