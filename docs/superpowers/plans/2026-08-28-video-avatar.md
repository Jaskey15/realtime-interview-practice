# Video Avatar Interviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the audio-reactive orb with a photorealistic HeyGen LiveAvatar (LITE mode) lip-synced from the existing OpenAI Realtime audio stream, with the orb retained as a failure fallback.

**Architecture:** The browser keeps its existing WebRTC connection to OpenAI Realtime (mic, VAD, data channel — unchanged). A new hook opens a second session to HeyGen LiveAvatar via the official `@heygen/liveavatar-web-sdk` (LiveKit video under the hood). An AudioWorklet taps the OpenAI remote audio track at 24 kHz, converts to PCM16 base64, and feeds it to the avatar via `repeatAudio()`; the browser plays HeyGen's returned synchronized audio+video while the OpenAI `<audio>` element is muted. Barge-in triggers `interrupt()`. Any avatar failure falls back to the orb + unmuted OpenAI audio.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@heygen/liveavatar-web-sdk` (v0.0.x), AudioWorklet, Vitest (new, for pure PCM utils only).

**Spec:** `docs/superpowers/specs/2026-08-28-video-avatar-design.md`

**Key external API facts (verified 2026-08-28 against docs.liveavatar.com):**
- Server mints a session token: `POST https://api.liveavatar.com/v1/sessions/token`, header `X-API-KEY`, body `{"mode":"LITE","avatar_id":"<uuid>", ...}` → `{ "data": { "session_id", "session_token" } }`.
- Browser SDK: `new LiveAvatarSession(sessionToken, { voiceChat: false })`; `await session.start()` (calls `/v1/sessions/start` itself, joins LiveKit, connects event WebSocket); `session.attach(videoEl)` after the `session.stream_ready` event; `session.repeatAudio(base64Pcm)` sends `agent.speak` chunks + `agent.speak_end`; `session.interrupt()`; `session.keepAlive()`; `session.stop()`.
- Audio format: raw PCM, 16-bit signed LE, **24,000 Hz**, mono, base64 — identical to OpenAI Realtime output. Recommended ~1 s per chunk, max 1 MB per packet.
- Idle timeout 5 min (reset via `keepAlive()`); sandbox mode (`is_sandbox: true`) is free, ~1 min sessions, fixed avatar `dd73ea75-1218-4ef3-92ce-606d5f7fbc0a` (Wayne) — use for integration testing; free tier is only 10 LITE minutes/month.
- Session end reasons include `NO_CREDITS`, `MAX_SESSION_DURATION_REACHED`, `IDLE_TIMEOUT` — all must trigger orb fallback, not interview death.
- SDK events (from package `.d.ts` v0.0.18): `session.state_changed` (`INACTIVE|CONNECTING|CONNECTED|DISCONNECTING|DISCONNECTED`), `session.stream_ready`, `session.disconnected`. **The executing engineer must confirm exact event-name exports in `node_modules/@heygen/liveavatar-web-sdk/dist/*.d.ts` after install and adjust imports if they differ.**
- OpenAI Realtime WebRTC data-channel events used for gating: `output_audio_buffer.started` (AI audio playout begins), `output_audio_buffer.stopped` (playout finished), `output_audio_buffer.cleared` (barge-in/interruption).

**File map:**
- Create: `src/lib/pcm.ts` (+ test `src/lib/pcm.test.ts`) — pure PCM convert/chunk utils
- Create: `public/pcm-capture-worklet.js` — AudioWorklet processor posting Float32 frames
- Create: `src/app/api/heygen/session/route.ts` — mints LiveAvatar session token
- Create: `src/hooks/use-heygen-avatar.ts` — avatar session lifecycle
- Modify: `src/hooks/use-realtime.ts` — 24 kHz AudioContext, worklet tap, audio sink, mute control
- Modify: `src/app/interview/page.tsx` — compose both hooks, fallback logic
- Modify: `src/components/interview-view.tsx` — video centerpiece, orb fallback
- Modify: `.env.example`, `package.json`, `CLAUDE.md` (env section)

---

### Task 1: Dependencies and environment scaffolding

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Install runtime and dev dependencies**

Run:
```bash
npm install @heygen/liveavatar-web-sdk
npm install -D vitest
```
Expected: both appear in `package.json`; no peer-dependency errors.

- [ ] **Step 2: Add test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run"
```

- [ ] **Step 3: Extend `.env.example`**

Append:
```bash
# HeyGen LiveAvatar (video interviewer). Get an API key at app.liveavatar.com
HEYGEN_API_KEY=

# Stock avatar UUID from GET https://api.liveavatar.com/v1/avatars/public (no auth)
# Leave HEYGEN_SANDBOX=true during development: free sandbox sessions (~1 min, fixed
# "Wayne" avatar, no credits burned). Set to false for real interviews.
HEYGEN_AVATAR_ID=
HEYGEN_SANDBOX=true
```

- [ ] **Step 4: Verify install**

Run: `npm run lint && npx tsc --noEmit`
Expected: both pass (tsc has no test files yet; SDK types resolve).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add LiveAvatar SDK, vitest, and HeyGen env vars"
```

---

### Task 2: PCM conversion and chunking utilities (TDD)

**Files:**
- Create: `src/lib/pcm.ts`
- Test: `src/lib/pcm.test.ts`

The worklet emits Float32 frames (128 samples each). These utils convert Float32 → Int16 PCM, base64-encode, and accumulate frames into ~1 s chunks (24,000 samples = 48,000 bytes, well under the 1 MB packet cap).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pcm.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { floatTo16BitPCM, int16ToBase64, PcmChunker } from "./pcm";

describe("floatTo16BitPCM", () => {
  it("converts full-scale values with clipping", () => {
    const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 1.5, -1.5]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768]);
  });

  it("scales mid-range values", () => {
    const out = floatTo16BitPCM(new Float32Array([0.5, -0.5]));
    expect(out[0]).toBe(16383); // floor(0.5 * 32767)
    expect(out[1]).toBe(-16384); // floor(-0.5 * 32768)
  });
});

describe("int16ToBase64", () => {
  it("encodes little-endian bytes", () => {
    // 0x0102 little-endian => bytes [0x02, 0x01]
    const b64 = int16ToBase64(new Int16Array([0x0102]));
    expect(atob(b64)).toBe("\x02\x01");
  });
});

describe("PcmChunker", () => {
  it("emits a base64 chunk once the sample threshold is reached", () => {
    const onChunk = vi.fn();
    const chunker = new PcmChunker(256, onChunk);
    chunker.push(new Float32Array(128)); // below threshold
    expect(onChunk).not.toHaveBeenCalled();
    chunker.push(new Float32Array(128)); // reaches 256
    expect(onChunk).toHaveBeenCalledTimes(1);
    const decoded = atob(onChunk.mock.calls[0][0]);
    expect(decoded.length).toBe(512); // 256 samples * 2 bytes
  });

  it("flush emits the remainder and resets", () => {
    const onChunk = vi.fn();
    const chunker = new PcmChunker(256, onChunk);
    chunker.push(new Float32Array(100));
    chunker.flush();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(atob(onChunk.mock.calls[0][0]).length).toBe(200);
    chunker.flush(); // nothing buffered — no extra emit
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it("discard drops buffered samples without emitting", () => {
    const onChunk = vi.fn();
    const chunker = new PcmChunker(256, onChunk);
    chunker.push(new Float32Array(100));
    chunker.discard();
    chunker.flush();
    expect(onChunk).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/pcm.test.ts`
Expected: FAIL — cannot resolve `./pcm`.

- [ ] **Step 3: Implement `src/lib/pcm.ts`**

```ts
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  // Chunk to avoid call-stack limits on large arrays
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Accumulates Float32 audio frames and emits base64 PCM16 chunks of
 * `chunkSamples` samples. Call flush() at utterance end, discard() on barge-in.
 */
export class PcmChunker {
  private buffer: Float32Array;
  private length = 0;

  constructor(
    private chunkSamples: number,
    private onChunk: (base64: string) => void,
  ) {
    this.buffer = new Float32Array(chunkSamples);
  }

  push(frame: Float32Array): void {
    let offset = 0;
    while (offset < frame.length) {
      const take = Math.min(frame.length - offset, this.chunkSamples - this.length);
      this.buffer.set(frame.subarray(offset, offset + take), this.length);
      this.length += take;
      offset += take;
      if (this.length === this.chunkSamples) this.emit();
    }
  }

  flush(): void {
    if (this.length > 0) this.emit();
  }

  discard(): void {
    this.length = 0;
  }

  private emit(): void {
    const samples = floatTo16BitPCM(this.buffer.subarray(0, this.length));
    this.length = 0;
    this.onChunk(int16ToBase64(samples));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pcm.test.ts`
Expected: PASS (5 tests). Note: vitest runs in Node ≥18 where `atob`/`btoa` exist globally.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pcm.ts src/lib/pcm.test.ts
git commit -m "feat: add PCM16 conversion and chunking utilities"
```

---

### Task 3: AudioWorklet capture processor

**Files:**
- Create: `public/pcm-capture-worklet.js`

Plain JS (worklet scope has no bundler). It copies input channel 0 and posts it to the main thread every process() call (128 samples). Verified in-browser in Task 7; no unit test (AudioWorklet global scope isn't available in Node).

- [ ] **Step 1: Create `public/pcm-capture-worklet.js`**

```js
// AudioWorklet processor: forwards mono Float32 frames to the main thread.
// Registered as "pcm-capture"; loaded from use-realtime via audioWorklet.addModule.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      // Copy — the engine reuses the underlying buffer between calls.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: PASS. If ESLint complains about `AudioWorkletProcessor`/`registerProcessor` being undefined in `public/`, add at the top of the file:
```js
/* global AudioWorkletProcessor, registerProcessor */
```

- [ ] **Step 3: Commit**

```bash
git add public/pcm-capture-worklet.js
git commit -m "feat: add AudioWorklet PCM capture processor"
```

---

### Task 4: HeyGen session token API route

**Files:**
- Create: `src/app/api/heygen/session/route.ts`

Mirrors the pattern of `src/app/api/realtime/session/route.ts`. Sandbox mode (env `HEYGEN_SANDBOX=true`) uses the fixed free Wayne avatar. `max_session_duration` is set from the interview duration plus a 2-minute buffer so a stuck session can't burn unbounded credits.

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";

const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"; // "Wayne" — only avatar allowed in sandbox

export async function POST(request: Request) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "HEYGEN_API_KEY not configured" },
      { status: 500 },
    );
  }

  const sandbox = process.env.HEYGEN_SANDBOX === "true";
  const avatarId = sandbox ? SANDBOX_AVATAR_ID : process.env.HEYGEN_AVATAR_ID;
  if (!avatarId) {
    return NextResponse.json(
      { error: "HEYGEN_AVATAR_ID not configured (or set HEYGEN_SANDBOX=true)" },
      { status: 500 },
    );
  }

  const body = await request.json();
  const durationMinutes =
    typeof body?.durationMinutes === "number" ? body.durationMinutes : 10;

  const response = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "LITE",
      avatar_id: avatarId,
      is_sandbox: sandbox,
      max_session_duration: (durationMinutes + 2) * 60,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("LiveAvatar API error:", error);
    return NextResponse.json(
      { error: "Failed to create avatar session" },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json({ sessionToken: data.data.session_token });
}
```

- [ ] **Step 2: Verify build and lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Runtime smoke test (requires `HEYGEN_API_KEY` in `.env.local`)**

Run: `npm run dev` in background, then:
```bash
curl -s -X POST http://localhost:3000/api/heygen/session \
  -H "Content-Type: application/json" -d '{"durationMinutes": 5}'
```
Expected: `{"sessionToken":"eyJ..."}` (a JWT). Without a key in `.env.local`, expected: `{"error":"HEYGEN_API_KEY not configured"}` with status 500 — both outcomes verify the route logic. Stop the dev server after.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/heygen/session/route.ts
git commit -m "feat: add HeyGen LiveAvatar session token route"
```

---

### Task 5: `use-heygen-avatar` hook

**Files:**
- Create: `src/hooks/use-heygen-avatar.ts`

Owns the LiveAvatar session lifecycle. Exposes an imperative surface consumed by the interview page. Status drives UI: `"active"` renders video; `"failed"`/`"stopped"` triggers orb fallback. A 4-minute keep-alive interval guards the 5-minute idle timeout (a long user monologue produces no avatar activity).

**IMPORTANT for the implementer:** after `npm install`, read `node_modules/@heygen/liveavatar-web-sdk/dist/index.d.ts` and confirm the exact exported names for `LiveAvatarSession`, the config shape, event subscription API (`.on(...)`), and event name constants (`session.stream_ready`, `session.disconnected`, `session.state_changed`). The code below uses string event names per the v0.0.18 typings — adjust to enum imports if the package exports them (e.g., `SessionEvent.STREAM_READY`).

- [ ] **Step 1: Create the hook**

```ts
"use client";

import { useState, useRef, useCallback } from "react";
import { LiveAvatarSession } from "@heygen/liveavatar-web-sdk";

export type AvatarStatus = "idle" | "connecting" | "active" | "failed" | "stopped";

const KEEP_ALIVE_MS = 4 * 60 * 1000; // idle timeout is 5 min

export function useHeygenAvatar() {
  const [status, setStatus] = useState<AvatarStatus>("idle");
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamReadyRef = useRef(false);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    streamReadyRef.current = false;
    sessionRef.current = null;
  }, []);

  /** Registers the <video> element; attaches immediately if the stream is ready. */
  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamReadyRef.current && sessionRef.current) {
      sessionRef.current.attach(el);
    }
  }, []);

  const connect = useCallback(
    async (durationMinutes: number): Promise<boolean> => {
      setStatus("connecting");
      try {
        const res = await fetch("/api/heygen/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ durationMinutes }),
        });
        if (!res.ok) throw new Error("Failed to get avatar session token");
        const { sessionToken } = await res.json();

        const session = new LiveAvatarSession(sessionToken, { voiceChat: false });
        sessionRef.current = session;

        session.on("session.stream_ready", () => {
          streamReadyRef.current = true;
          if (videoElRef.current) session.attach(videoElRef.current);
        });
        session.on("session.disconnected", () => {
          // Covers server-side stops: NO_CREDITS, IDLE_TIMEOUT, MAX_DURATION, errors
          teardown();
          setStatus("stopped");
        });

        await session.start();

        keepAliveRef.current = setInterval(() => {
          sessionRef.current?.keepAlive();
        }, KEEP_ALIVE_MS);

        setStatus("active");
        return true;
      } catch (err) {
        console.error("Avatar connection failed:", err);
        teardown();
        setStatus("failed");
        return false;
      }
    },
    [teardown],
  );

  const disconnect = useCallback(() => {
    const session = sessionRef.current;
    teardown();
    session?.stop().catch(() => {});
    setStatus("idle");
  }, [teardown]);

  const sendAudioChunk = useCallback((base64Pcm: string) => {
    sessionRef.current?.repeatAudio(base64Pcm);
  }, []);

  const interrupt = useCallback(() => {
    sessionRef.current?.interrupt();
  }, []);

  return {
    status,
    connect,
    disconnect,
    setVideoElement,
    sendAudioChunk,
    interrupt,
  };
}
```

- [ ] **Step 2: Verify types against the installed SDK**

Run: `npx tsc --noEmit`
Expected: PASS. If event-name strings or method signatures mismatch the installed `.d.ts`, fix per the actual typings (see IMPORTANT note above) and re-run until clean.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-heygen-avatar.ts
git commit -m "feat: add useHeygenAvatar hook for LiveAvatar session lifecycle"
```

---

### Task 6: Audio sink in `use-realtime`

**Files:**
- Modify: `src/hooks/use-realtime.ts`

Adds: (a) a 24 kHz AudioContext + worklet tap on the OpenAI remote track, (b) an attachable audio sink gated by the `output_audio_buffer.*` data-channel events, (c) output mute control. When no sink is attached, behavior is exactly today's.

- [ ] **Step 1: Add the sink type and refs**

Near the top of `src/hooks/use-realtime.ts`, add the import and interface:
```ts
import { PcmChunker } from "@/lib/pcm";

/** Receives the interviewer's audio as base64 PCM16 24 kHz chunks. */
export interface RealtimeAudioSink {
  onAudioChunk: (base64Pcm: string) => void;
  onInterrupt: () => void;
}
```

Inside `useRealtime()`, alongside the existing refs, add:
```ts
const sinkRef = useRef<RealtimeAudioSink | null>(null);
const chunkerRef = useRef<PcmChunker | null>(null);
const workletRef = useRef<AudioWorkletNode | null>(null);
const aiSpeakingRef = useRef(false);
```

- [ ] **Step 2: Create the AudioContext at 24 kHz and load the worklet in `connect`**

In `connect`, replace the AudioContext creation inside `pc.ontrack` with a context created up front (before step "2. Create peer connection" in the existing numbered comments), so the worklet module is loaded before audio arrives:

```ts
// 1.5 Audio context at 24 kHz (OpenAI Realtime output rate) + capture worklet
const ctx = new AudioContext({ sampleRate: 24000 });
await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
audioCtxRef.current = ctx;
```

Then in `pc.ontrack`, use `audioCtxRef.current` instead of `new AudioContext()`, and after wiring the analyser add the worklet tap:

```ts
pc.ontrack = (e) => {
  const remoteStream = e.streams[0];
  audio.srcObject = remoteStream;

  const ctx = audioCtxRef.current!;
  const source = ctx.createMediaStreamSource(remoteStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  analyserRef.current = analyser;

  // Tap for the avatar audio sink: 1 s chunks of PCM16 @ 24 kHz
  const worklet = new AudioWorkletNode(ctx, "pcm-capture");
  chunkerRef.current = new PcmChunker(24000, (b64) => {
    sinkRef.current?.onAudioChunk(b64);
  });
  worklet.port.onmessage = (msg: MessageEvent<Float32Array>) => {
    if (sinkRef.current && aiSpeakingRef.current) {
      chunkerRef.current?.push(msg.data);
    }
  };
  source.connect(worklet);
  workletRef.current = worklet;

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  function tick() { /* ...existing tick body unchanged... */ }
  tick();
};
```
(The existing `tick` body and rAF wiring stay exactly as they are.)

Note: `connect` already runs inside a user gesture (Begin Interview click), so the AudioContext starts unsuspended. If `ctx.state === "suspended"`, call `ctx.resume()` after creation.

- [ ] **Step 3: Gate the sink with output_audio_buffer events**

In `handleServerEvent`, add cases:
```ts
case "output_audio_buffer.started": {
  aiSpeakingRef.current = true;
  break;
}

case "output_audio_buffer.stopped": {
  aiSpeakingRef.current = false;
  chunkerRef.current?.flush(); // send the final partial chunk
  break;
}

case "output_audio_buffer.cleared": {
  // User barge-in: drop buffered audio and stop the avatar's mouth
  aiSpeakingRef.current = false;
  chunkerRef.current?.discard();
  sinkRef.current?.onInterrupt();
  break;
}
```
Note: `handleServerEvent` is currently a plain function declared inside the hook body — these refs are in scope; no signature change needed.

- [ ] **Step 4: Expose sink attach and mute controls**

Add before the return statement:
```ts
/** Attach/detach the avatar audio sink. Muting the local element is separate. */
const setAudioSink = useCallback((sink: RealtimeAudioSink | null) => {
  sinkRef.current = sink;
}, []);

/** Mute/unmute the local OpenAI audio playback (avatar plays its own synced audio). */
const setOutputMuted = useCallback((muted: boolean) => {
  if (audioRef.current) audioRef.current.muted = muted;
}, []);
```

Extend `cleanup` (inside the existing function) with:
```ts
if (workletRef.current) {
  workletRef.current.port.onmessage = null;
  workletRef.current.disconnect();
  workletRef.current = null;
}
chunkerRef.current = null;
sinkRef.current = null;
aiSpeakingRef.current = false;
```

And extend the hook's return object:
```ts
return {
  connect,
  disconnect,
  status,
  transcripts,
  audioLevel,
  setAudioSink,
  setOutputMuted,
};
```

- [ ] **Step 5: Verify**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Manual regression — voice-only still works**

Run `npm run dev`, start an interview with no HeyGen wiring yet (nothing consumes the sink): confirm the interviewer speaks, the orb reacts, transcripts appear. This proves the refactor didn't break the existing path.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-realtime.ts
git commit -m "feat: add avatar audio sink tap to realtime hook"
```

---

### Task 7: Wire avatar into the interview page and view

**Files:**
- Modify: `src/app/interview/page.tsx`
- Modify: `src/components/interview-view.tsx`

Composition rules: avatar connects in parallel with the OpenAI session at Begin. When avatar is `active`: sink attached + OpenAI audio muted + video rendered. On `failed`/`stopped`: sink detached + audio unmuted + orb rendered + quiet notice. Interview end tears down both.

- [ ] **Step 1: Compose hooks in `src/app/interview/page.tsx`**

Replace the component body wiring (keep `useSessionConfig` as is):
```tsx
"use client";

import { useEffect, useRef, useSyncExternalStore, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";
import { useHeygenAvatar } from "@/hooks/use-heygen-avatar";
import { InterviewView } from "@/components/interview-view";
import type { InterviewConfig } from "@/lib/types";

// ...useSessionConfig unchanged...

export default function InterviewPage() {
  const router = useRouter();
  const config = useSessionConfig();
  const {
    connect,
    disconnect,
    status,
    transcripts,
    audioLevel,
    setAudioSink,
    setOutputMuted,
  } = useRealtime();
  const avatar = useHeygenAvatar();

  useEffect(() => {
    if (!config) {
      router.push("/");
    }
  }, [config, router]);

  // Route interviewer audio to the avatar while it is active; fall back otherwise.
  useEffect(() => {
    if (avatar.status === "active") {
      setAudioSink({
        onAudioChunk: avatar.sendAudioChunk,
        onInterrupt: avatar.interrupt,
      });
      setOutputMuted(true);
    } else {
      setAudioSink(null);
      setOutputMuted(false);
    }
  }, [avatar.status, avatar.sendAudioChunk, avatar.interrupt, setAudioSink, setOutputMuted]);

  const handleConnect = useCallback(
    (cfg: InterviewConfig) => {
      connect(cfg);
      avatar.connect(cfg.durationMinutes); // parallel; failure just means orb fallback
    },
    [connect, avatar],
  );

  const handleEnd = useCallback(() => {
    avatar.disconnect();
    disconnect();
    sessionStorage.setItem("interviewTranscript", JSON.stringify(transcripts));
    router.push("/feedback");
  }, [avatar, disconnect, transcripts, router]);

  if (!config) return null;

  return (
    <InterviewView
      config={config}
      status={status}
      transcripts={transcripts}
      audioLevel={audioLevel}
      avatarStatus={avatar.status}
      onVideoElement={avatar.setVideoElement}
      onConnect={handleConnect}
      onEnd={handleEnd}
    />
  );
}
```

- [ ] **Step 2: Update `src/components/interview-view.tsx` — props and centerpiece**

Add to the props type:
```ts
avatarStatus: string;
onVideoElement: (el: HTMLVideoElement | null) => void;
```

Replace the orb block (the `{/* Morphing blob orb */}` div) with a conditional centerpiece. The orb JSX moves inside the `else` branch **unchanged**:

```tsx
{/* Interviewer: video avatar, orb as fallback */}
{avatarStatus === "active" ? (
  <div className="relative overflow-hidden rounded-2xl border border-border-subtle shadow-[0_0_40px_rgba(34,211,238,0.1)]">
    <video
      ref={onVideoElement}
      autoPlay
      playsInline
      className="h-auto w-[min(560px,85vw)] bg-black"
    />
  </div>
) : (
  <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
    {/* ...existing orb div, byte-for-byte unchanged... */}
  </div>
)}

{/* Quiet fallback notice: only when video was expected but died mid-interview */}
{started && (avatarStatus === "failed" || avatarStatus === "stopped") && (
  <div className="absolute bottom-24 left-0 right-0 text-center text-xs text-text-muted">
    Video unavailable — continuing in voice mode
  </div>
)}
```

Note: `ref={onVideoElement}` works because React callback refs receive the element (or null on unmount) — exactly the `setVideoElement` contract.

- [ ] **Step 3: Verify**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/interview/page.tsx src/components/interview-view.tsx
git commit -m "feat: render video avatar interviewer with orb fallback"
```

---

### Task 8: Update project docs

**Files:**
- Modify: `CLAUDE.md` (Environment + Architecture sections)
- Modify: `README.md` (env var table/section, if one exists — check first)

- [ ] **Step 1: Update `CLAUDE.md`**

In the Architecture section add:
```markdown
- Video interviewer: HeyGen LiveAvatar LITE renders a lip-synced avatar from the
  OpenAI Realtime audio stream; orb UI is the automatic fallback if video fails
```
In the Environment section add:
```markdown
- `HEYGEN_API_KEY` — LiveAvatar API key (video interviewer)
- `HEYGEN_AVATAR_ID` — stock avatar UUID (or `HEYGEN_SANDBOX=true` for free dev sessions)
```

- [ ] **Step 2: Check README for an env section and mirror the change if present**

Run: `grep -n "OPENAI_API_KEY" README.md` — if it appears, add the HeyGen vars in the same style.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document HeyGen video avatar env vars and architecture"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

Prereqs: `HEYGEN_API_KEY` set in `.env.local`, `HEYGEN_SANDBOX=true` (free sandbox sessions, ~1 min, Wayne avatar — enough to verify plumbing without burning credits).

- [ ] **Step 1: Playwright — fallback path (no HeyGen key)**

Temporarily comment out `HEYGEN_API_KEY` in `.env.local`, run `npm run dev`, and with the Playwright CLI: load the app, fill the setup form, begin an interview. Verify: interview connects, orb renders (not video), the "Video unavailable" note appears, interviewer audio is audible. Restore the key after.

- [ ] **Step 2: Playwright — video path (sandbox)**

With the key restored and `HEYGEN_SANDBOX=true`: begin an interview. Verify: a `<video>` element appears with a playing stream (Wayne avatar), his lips move when the interviewer speaks, OpenAI's direct audio is muted (no doubled voice). Expect the sandbox session to self-terminate after ~1 min — verify the UI falls back to the orb and the interview continues (this doubles as the mid-session-drop fallback test).

- [ ] **Step 3: Barge-in check**

During an avatar response, interrupt by speaking. Verify the avatar stops talking within ~a second (the `interrupt()` path).

- [ ] **Step 4: Full suite**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all PASS.

- [ ] **Step 5: Human acceptance (user)**

With a real avatar ID (`HEYGEN_SANDBOX=false`) and paid/trial credits, the user runs a ~5-minute real interview and judges: realism, lip-sync quality, added latency, barge-in feel. This is the spec's true acceptance test.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix: address issues found in end-to-end verification"
```
(Only if fixes were needed.)

---

## Known risks & mitigations

- **`repeatAudio` per-1s-chunk may introduce micro-gaps** between chunks (each call sends its own `agent.speak`/`agent.speak_end` sequence). If audible/visible choppiness appears in Task 9: first try larger chunks (2–3 s — still ≪ 1 MB); if still choppy, switch from the SDK's `repeatAudio` to a raw `WebSocket(ws_url)` sending `agent.speak` per chunk and a single `agent.speak_end` at `output_audio_buffer.stopped` (the hook already has that boundary signal — pass it through the sink as an `onSpeechEnd` callback).
- **SDK is v0.0.x** — pin the exact installed version in `package.json` and expect the implementer to reconcile event names against the installed `.d.ts` (called out in Task 5).
- **Avatar connects after the AI's first sentence has started** — the first response may begin on the orb/unmuted audio and switch to the avatar mid-utterance. Acceptable for v1; noted so it isn't mistaken for a bug.
