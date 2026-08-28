# Video Avatar Interviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the audio-reactive orb with a photorealistic HeyGen LiveAvatar (LITE mode) lip-synced from the existing OpenAI Realtime audio stream, with the orb retained as a failure fallback.

**Architecture:** The browser keeps its existing WebRTC connection to OpenAI Realtime (mic, VAD, data channel — unchanged). A new hook opens a second session to HeyGen LiveAvatar via the official `@heygen/liveavatar-web-sdk` (LiveKit video under the hood). An AudioWorklet taps the OpenAI remote audio track at 24 kHz, converts to PCM16 base64, and feeds it to the avatar; the browser plays HeyGen's returned synchronized audio+video while the OpenAI `<audio>` element is muted. Barge-in triggers `interrupt()`. Any avatar or bridge failure falls back to the orb + unmuted OpenAI audio — a face failure must never break the interview. The first AI response is deferred until the avatar is ready or definitively failed (10 s cap) so the opening sentence doesn't switch renderers mid-utterance.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@heygen/liveavatar-web-sdk` (v0.0.x), AudioWorklet, Vitest (new, for pure PCM utils only).

**Spec:** `docs/superpowers/specs/2026-08-28-video-avatar-design.md`
**Plan review:** `docs/superpowers/reviews/2026-08-28-video-avatar-plan-review.md` (findings incorporated)

**Key external API facts (verified 2026-08-28 against docs.liveavatar.com):**
- Server mints a session token: `POST https://api.liveavatar.com/v1/sessions/token`, header `X-API-KEY`, body `{"mode":"LITE","avatar_id":"<uuid>", ...}` → `{ "data": { "session_id", "session_token" } }`.
- Browser SDK: `new LiveAvatarSession(sessionToken, { voiceChat: false })`; `await session.start()` (calls `/v1/sessions/start` itself, joins LiveKit, connects event WebSocket); `session.attach(videoEl)` after the `session.stream_ready` event; `session.repeatAudio(base64Pcm)` sends `agent.speak` chunks + `agent.speak_end`; `session.interrupt()`; `session.keepAlive()`; `session.stop()`.
- Audio format: raw PCM, 16-bit signed LE, **24,000 Hz**, mono, base64 — identical to OpenAI Realtime output. Recommended ~1 s per chunk, max 1 MB per packet.
- LITE WebSocket wire events (relevant if the raw-WS contingency is needed): `{"type":"agent.speak","audio":"<b64>"}` per chunk, one `{"type":"agent.speak_end"}` at utterance end, `{"type":"agent.interrupt"}`.
- Idle timeout 5 min (reset via `keepAlive()`); sandbox mode (`is_sandbox: true`) is free, ~1 min sessions, fixed avatar `dd73ea75-1218-4ef3-92ce-606d5f7fbc0a` (Wayne) — use for integration testing; free tier is only 10 LITE minutes/month.
- Session end reasons include `NO_CREDITS`, `MAX_DURATION_REACHED`, `IDLE_TIMEOUT` — all must trigger orb fallback, not interview death.
- SDK events (from package `.d.ts` v0.0.18): `session.state_changed` (`INACTIVE|CONNECTING|CONNECTED|DISCONNECTING|DISCONNECTED`), `session.stream_ready`, `session.disconnected`. **The executing engineer must confirm exact event-name exports in `node_modules/@heygen/liveavatar-web-sdk/dist/*.d.ts` after install and adjust imports if they differ.**
- OpenAI Realtime WebRTC data-channel events used for gating: `output_audio_buffer.started` (AI audio playout begins), `output_audio_buffer.stopped` (playout finished), `output_audio_buffer.cleared` (barge-in/interruption).

**File map:**
- Create: `src/lib/pcm.ts` (+ test `src/lib/pcm.test.ts`) — pure PCM convert/chunk utils
- Create: `public/pcm-capture-worklet.js` — AudioWorklet processor posting Float32 frames
- Create: `src/app/api/heygen/session/route.ts` — mints LiveAvatar session token
- Create: `src/hooks/use-heygen-avatar.ts` — avatar session lifecycle
- Modify: `src/hooks/use-realtime.ts` — 24 kHz AudioContext, worklet tap, audio sink, mute control, deferred first response
- Modify: `src/app/interview/page.tsx` — compose both hooks, fallback logic
- Modify: `src/components/interview-view.tsx` — video centerpiece, orb fallback
- Modify: `.env.example`, `package.json`, `CLAUDE.md` (env section)

---

### Task 0: Pre-integration realism check (USER CHECKPOINT)

**Files:** none

The spec requires judging avatar realism before integration work. This is the user's call, not the implementer's.

- [ ] **Step 1: User eyeballs stock avatars**

The user browses stock avatars at app.liveavatar.com (dashboard playground; the public list is also at `GET https://api.liveavatar.com/v1/avatars/public`, no auth) and decides go/no-go on HeyGen realism. On go, they record the chosen avatar UUID for `HEYGEN_AVATAR_ID`.

- [ ] **Step 2: Record the decision**

Note the chosen avatar ID (or "sandbox only for now") in the task notes. If realism disappoints, STOP — reassess provider (Anam is the designated runner-up) before any further tasks.

*Implementation note: Tasks 1–8 may proceed in sandbox mode while the user completes this, but Task 9 Step 6 (production acceptance) is blocked on it.*

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
Expected: both pass (no test files yet; SDK types resolve).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add LiveAvatar SDK, vitest, and HeyGen env vars"
```

---

### Task 2: SDK audio-path spike (decides chunk-send strategy)

**Files:** none (read-only investigation; conclusions recorded in this plan's task notes)

The spec requires many `agent.speak` chunks and **one** `agent.speak_end` per utterance. The SDK's documented `repeatAudio()` sends a full speak/speak_end sequence per call, which — if called once per 1 s chunk — could fragment utterances (mouth resets, gaps). Resolve this now, before the hooks are built.

- [ ] **Step 1: Inspect the installed SDK**

Read `node_modules/@heygen/liveavatar-web-sdk/dist/index.d.ts` and the corresponding `dist/*.js` implementation. Answer in writing:
1. Does each `repeatAudio()` call emit its own `agent.speak_end` (i.e., one sequence per call)?
2. Does the SDK expose any lower-level primitive to send `agent.speak` chunks and `agent.speak_end` separately (method, or an accessible WebSocket/command channel)?
3. Are the event names/constants as assumed in this plan?

- [ ] **Step 2: Choose the audio-send strategy**

Decision rule, in order of preference:
- **(a)** SDK exposes separate speak / speak-end primitives → use them: `sendAudioChunk` maps to speak, `endOfSpeech` maps to speak-end.
- **(b)** SDK internals show consecutive `repeatAudio()` calls queue seamlessly (scheduled back-to-back without visual reset) → use `repeatAudio` per ~1 s chunk; `endOfSpeech` is a no-op.
- **(c)** Neither provable → plan for the **raw-WS contingency** (see "Known risks" at the bottom: manual `/v1/sessions/start`, `livekit-client` for media, own `WebSocket(ws_url)` for events) and implement Task 5 against that design instead of the SDK session wrapper.

Record the chosen strategy; Tasks 5–7 reference it as **THE STRATEGY**.

- [ ] **Step 3: Commit (only if plan file was annotated)**

```bash
git add docs/superpowers/plans/2026-08-28-video-avatar.md
git commit -m "docs: record LiveAvatar SDK audio-path spike decision"
```

---

### Task 3: PCM conversion and chunking utilities (TDD)

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

### Task 4: AudioWorklet capture processor

**Files:**
- Create: `public/pcm-capture-worklet.js`

Plain JS (worklet scope has no bundler). It copies input channel 0 and posts it to the main thread every process() call (128 samples). Verified in-browser in Task 9; no unit test (AudioWorklet global scope isn't available in Node).

- [ ] **Step 1: Create `public/pcm-capture-worklet.js`**

```js
/* global AudioWorkletProcessor, registerProcessor */
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
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add public/pcm-capture-worklet.js
git commit -m "feat: add AudioWorklet PCM capture processor"
```

---

### Task 5: HeyGen session token API route

**Files:**
- Create: `src/app/api/heygen/session/route.ts`

Mirrors the pattern of `src/app/api/realtime/session/route.ts`. Sandbox mode (env `HEYGEN_SANDBOX=true`) uses the fixed free Wayne avatar and **omits `max_session_duration`** (sandbox sessions are ~1 min and a longer request may fail tier validation). In production mode, `max_session_duration` is the clamped interview duration plus a 2-minute buffer so a stuck session can't burn unbounded credits.

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
  const requested =
    typeof body?.durationMinutes === "number" ? body.durationMinutes : 10;
  const durationMinutes = Math.min(60, Math.max(1, requested));

  const tokenConfig: Record<string, unknown> = {
    mode: "LITE",
    avatar_id: avatarId,
    is_sandbox: sandbox,
  };
  if (!sandbox) {
    tokenConfig.max_session_duration = (durationMinutes + 2) * 60;
  }

  const response = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tokenConfig),
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

### Task 6: `use-heygen-avatar` hook

**Files:**
- Create: `src/hooks/use-heygen-avatar.ts`

Owns the LiveAvatar session lifecycle. Status semantics (review finding 4): **`"active"` means the avatar's media stream is ready** (`session.stream_ready` received) — not merely that `start()` resolved. Only `"active"` renders video and mutes OpenAI audio. A 15 s watchdog fails the session if the stream never becomes ready. A 4-minute keep-alive interval guards the 5-minute idle timeout; keep-alive failures transition to `"stopped"` (fallback). Cleanup is idempotent and runs on unmount so a navigation can't leave a billable session running.

**IMPORTANT for the implementer:** apply THE STRATEGY from Task 2. The code below assumes strategy (b) (`repeatAudio` per chunk, `endOfSpeech` no-op). For strategy (a), map `sendAudioChunk`/`endOfSpeech` to the SDK's separate speak/speak-end primitives. For strategy (c), replace the SDK session wrapper with the raw-WS design from "Known risks". Also reconcile event-name strings against the installed `.d.ts` (use enum exports if available).

- [ ] **Step 1: Create the hook**

```ts
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { LiveAvatarSession } from "@heygen/liveavatar-web-sdk";

export type AvatarStatus = "idle" | "connecting" | "active" | "failed" | "stopped";

const KEEP_ALIVE_MS = 4 * 60 * 1000; // provider idle timeout is 5 min
const STREAM_READY_TIMEOUT_MS = 15_000;

export function useHeygenAvatar() {
  const [status, setStatus] = useState<AvatarStatus>("idle");
  const sessionRef = useRef<LiveAvatarSession | null>(null);
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

  /** Ends the session server-side; safe to call repeatedly. */
  const disconnect = useCallback(() => {
    const session = sessionRef.current;
    stoppingRef.current = true;
    teardown();
    session?.stop().catch(() => {});
    setStatus("idle");
  }, [teardown]);

  // Unmount safety: never leave a billable session running.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        stoppingRef.current = true;
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
    async (durationMinutes: number): Promise<void> => {
      stoppingRef.current = false;
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
          if (stoppingRef.current) return;
          streamReadyRef.current = true;
          if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
          }
          if (videoElRef.current) session.attach(videoElRef.current);
          setStatus("active"); // only now: media is attachable, OpenAI may mute
        });
        session.on("session.disconnected", () => {
          if (stoppingRef.current) return;
          // Server-side stops: NO_CREDITS, IDLE_TIMEOUT, MAX_DURATION, errors
          teardown();
          setStatus("stopped");
        });

        await session.start();

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
          Promise.resolve(sessionRef.current?.keepAlive()).catch(() => {
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

  const sendAudioChunk = useCallback((base64Pcm: string) => {
    sessionRef.current?.repeatAudio(base64Pcm);
  }, []);

  /** Utterance boundary. No-op under strategy (b); sends speak-end under (a)/(c). */
  const endOfSpeech = useCallback(() => {}, []);

  const interrupt = useCallback(() => {
    sessionRef.current?.interrupt();
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

### Task 7: Audio sink and deferred first response in `use-realtime`

**Files:**
- Modify: `src/hooks/use-realtime.ts`

Adds: (a) an **optional** 24 kHz AudioContext + worklet tap on the OpenAI remote track — set up in an isolated try/catch so bridge failure can never break the voice interview (review finding 2), with the worklet kept alive through a zero-gain branch to the destination (finding 5); (b) an attachable audio sink gated by the `output_audio_buffer.*` data-channel events; (c) output mute control; (d) the initial `response.create` moved out of `dc.onopen` into an idempotent `startConversation()` so the page can defer the first response until the avatar settles (finding 4). When no sink is attached and no `startConversation` deferral is used, behavior matches today's.

- [ ] **Step 1: Add the sink type and refs**

Near the top of `src/hooks/use-realtime.ts`, add the import and interface:
```ts
import { PcmChunker } from "@/lib/pcm";

/** Receives the interviewer's audio as base64 PCM16 24 kHz chunks. */
export interface RealtimeAudioSink {
  onAudioChunk: (base64Pcm: string) => void;
  onSpeechEnd: () => void;
  onInterrupt: () => void;
}
```

Inside `useRealtime()`, alongside the existing refs and state, add:
```ts
const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null);
const sinkRef = useRef<RealtimeAudioSink | null>(null);
const chunkerRef = useRef<PcmChunker | null>(null);
const workletRef = useRef<AudioWorkletNode | null>(null);
const workletReadyRef = useRef(false);
const aiSpeakingRef = useRef(false);
const conversationStartedRef = useRef(false);
```

- [ ] **Step 2: Set up the audio bridge — isolated, optional**

In `connect`, after fetching the client secret and before creating the peer connection, add:

```ts
// 1.5 Audio bridge (optional): 24 kHz context + capture worklet for the avatar.
// Failure here must never break the voice interview — degrade to voice-only.
workletReadyRef.current = false;
try {
  const ctx = new AudioContext({ sampleRate: 24000 });
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
  audioCtxRef.current?.close();
  audioCtxRef.current = new AudioContext(); // analyser-only fallback, default rate
  setBridgeAvailable(false);
}
```

Then in `pc.ontrack`, use `audioCtxRef.current` instead of creating a new context, and add the worklet tap after the analyser wiring:

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
  function tick() { /* ...existing tick body unchanged... */ }
  tick();
};
```
(The existing `tick` body and rAF wiring stay exactly as they are.)

- [ ] **Step 3: Move the initial response out of `dc.onopen`**

In `dc.onopen`, delete the line `dc.send(JSON.stringify({ type: "response.create" }));` (the wrap-up timeout wiring stays). Add alongside the other callbacks:

```ts
/**
 * Sends the initial response.create. Idempotent — the page calls this once
 * the avatar has settled (active/failed/stopped) or a deadline passes.
 */
const startConversation = useCallback(() => {
  const dc = dcRef.current;
  if (!dc || dc.readyState !== "open" || conversationStartedRef.current) return;
  conversationStartedRef.current = true;
  dc.send(JSON.stringify({ type: "response.create" }));
}, []);
```

- [ ] **Step 4: Gate the sink with output_audio_buffer events**

In `handleServerEvent`, add cases:
```ts
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
```
Note: `handleServerEvent` is a plain function declared inside the hook body — these refs are in scope; no signature change needed.

- [ ] **Step 5: Expose sink attach and mute controls; extend cleanup**

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
workletReadyRef.current = false;
aiSpeakingRef.current = false;
conversationStartedRef.current = false;
```

And extend the hook's return object:
```ts
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
```

- [ ] **Step 6: Verify**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-realtime.ts
git commit -m "feat: add avatar audio sink tap and deferred first response to realtime hook"
```

(Manual voice-only regression happens in the next task once the page calls `startConversation` — until then the page still expects the old auto-start, so don't run the app between Tasks 7 and 8.)

---

### Task 8: Wire avatar into the interview page and view

**Files:**
- Modify: `src/app/interview/page.tsx`
- Modify: `src/components/interview-view.tsx`

Composition rules: avatar connects in parallel with the OpenAI session at Begin. Only when avatar is `active` (stream ready): sink attached + OpenAI audio muted + video rendered. On `failed`/`stopped` or bridge unavailable: sink detached + audio unmuted + orb rendered + quiet notice. The first AI response fires when the avatar settles or after a 10 s deadline. Interview end tears down both. Callbacks are destructured so unstable hook-object identity can't churn the view's timer effect (review finding 8).

- [ ] **Step 1: Compose hooks in `src/app/interview/page.tsx`**

Replace the component body wiring (keep `useSessionConfig` exactly as is):
```tsx
"use client";

import { useEffect, useRef, useSyncExternalStore, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";
import { useHeygenAvatar } from "@/hooks/use-heygen-avatar";
import { InterviewView } from "@/components/interview-view";
import type { InterviewConfig } from "@/lib/types";

// ...useSessionConfig unchanged...

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

- [ ] **Step 4: Manual regression — voice-only still works**

Run `npm run dev` **without** `HEYGEN_API_KEY` in `.env.local` (or with the avatar route unreachable): start an interview. Confirm: the interviewer speaks (first response arrives after the avatar fails or the 10 s deadline), the orb reacts, transcripts appear, wrap-up timing unaffected. This proves the primary voice path survived the refactor.

- [ ] **Step 5: Commit**

```bash
git add src/app/interview/page.tsx src/components/interview-view.tsx
git commit -m "feat: render video avatar interviewer with orb fallback"
```

---

### Task 9: Update project docs

**Files:**
- Modify: `CLAUDE.md` (Environment + Architecture sections)
- Modify: `README.md` (env var section, if one exists — check first)

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

### Task 10: End-to-end verification

**Files:** none (verification only)

Prereqs: `HEYGEN_API_KEY` set in `.env.local`, `HEYGEN_SANDBOX=true` (free sandbox sessions, ~1 min, Wayne avatar — enough to verify plumbing without burning credits).

- [ ] **Step 1: Playwright — fallback path (no env mutation)**

Run `npm run dev`. Using the Playwright CLI, intercept the avatar route to force failure — do NOT edit `.env.local`:
```js
await page.route("**/api/heygen/session", (r) =>
  r.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
);
```
Then load the app, fill the setup form, begin an interview. Verify: OpenAI connects, the orb renders (not video), the "Video unavailable" note appears, interviewer audio is audible (unmuted).

- [ ] **Step 2: Playwright — video path (sandbox)**

Without interception and with `HEYGEN_SANDBOX=true`: begin an interview. Verify: a `<video>` element appears with a playing stream (Wayne avatar), lips move when the interviewer speaks, no doubled voice (OpenAI element muted), and chunks flow (add a temporary `console.log` in the sink if needed; remove after). Also confirm in the console that `AudioContext.sampleRate` is 24000.

- [ ] **Step 3: Mid-session drop fallback**

Let the sandbox session hit its ~1-minute auto-termination. Verify the UI swaps to the orb, OpenAI audio unmutes, the notice appears, and the interview continues.

- [ ] **Step 4: Barge-in check**

During an avatar response, interrupt by speaking. Verify the avatar stops talking within ~a second (the `interrupt()` path) and no stale audio plays later (chunker discarded).

- [ ] **Step 5: Full suite**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all PASS.

- [ ] **Step 6: Human acceptance (user; requires Task 0 go decision)**

With the user's chosen avatar ID (`HEYGEN_SANDBOX=false`) and trial/paid credits, the user runs a ~5-minute real interview and judges: realism, lip-sync quality, added latency, barge-in feel. This is the spec's true acceptance test.

- [ ] **Step 7: Commit any fixes — explicit staging only**

Run `git status --short` and `git diff` to review. Stage ONLY files you changed for verification fixes, by name (never `git add -A`):
```bash
git add <specific files>
git commit -m "fix: address issues found in end-to-end verification"
```
(Only if fixes were needed.)

---

## Known risks & mitigations

- **Chunked sends may fragment utterances** (Task 2 decides the strategy). If sandbox testing in Task 10 still shows gaps or mouth resets: first try larger chunks (2–3 s — still ≪ 1 MB); if still choppy, implement the **raw-WS contingency**: skip the SDK session wrapper; call `POST /v1/sessions/start` (Bearer session token) yourself to get `livekit_url`, `livekit_client_token`, and `ws_url`; join the room with `livekit-client` and attach the avatar participant's tracks; open `WebSocket(ws_url)`, wait for `session.state_updated: "connected"`, then send `{"type":"agent.speak","audio":<b64>}` per chunk, one `{"type":"agent.speak_end"}` from `onSpeechEnd`, and `{"type":"agent.interrupt"}` on barge-in; keep-alive via `{"type":"session.keep_alive"}`. The hook's public surface (`sendAudioChunk`/`endOfSpeech`/`interrupt`) already matches this shape.
- **SDK is v0.0.x** — pin the exact installed version in `package.json`; Task 2/6 reconcile names against the installed `.d.ts`.
- **First-response delay** — deferring `response.create` until the avatar settles adds up to ~10 s before the interviewer's greeting when the avatar is slow. Acceptable trade-off (spec-amended); the deadline caps it.
