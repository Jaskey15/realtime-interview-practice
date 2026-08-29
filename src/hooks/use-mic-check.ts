"use client";

import { useState, useEffect } from "react";

export type MicState = "checking" | "ready" | "denied";

/**
 * Local mic preview for the green room. The realtime connection doesn't call
 * getUserMedia until step 4 of its handshake, so without this the permission
 * prompt lands *after* Begin — with a billable avatar session already spinning
 * up — and a denial just kills the interview. Running it in the lobby resolves
 * the prompt and surfaces a dead input before anything connects.
 *
 * The stream is released as soon as `enabled` goes false, i.e. on Begin.
 */
export function useMicCheck(enabled: boolean) {
  const [state, setState] = useState<MicState>("checking");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf: number | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        setState("ready");

        ctx = new AudioContext();
        await ctx.resume().catch(() => {});
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          setLevel(sum / data.length / 255);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!cancelled) setState("denied");
      }
    })();

    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  return { state, level };
}
