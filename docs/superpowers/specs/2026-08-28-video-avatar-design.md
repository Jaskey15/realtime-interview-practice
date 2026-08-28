# Video Avatar Interviewer — Design

**Date:** 2026-08-28
**Status:** Draft for review

## Goal

Replace the audio-reactive orb in the interview view with a photorealistic, lip-synced
human avatar rendered by HeyGen LiveAvatar (LITE mode), while keeping the existing
OpenAI Realtime voice pipeline — prompts, VAD, transcripts, wrap-up injection, and
grading — completely unchanged.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Priority | Realism over cost | User practices real interviews; presence matters. Cost optimization deferred. |
| Provider | HeyGen LiveAvatar, LITE mode | Top-tier photorealism; LITE mode accepts external PCM16 24 kHz audio — byte-for-byte the OpenAI Realtime output format; ~$0.10–0.13/min. |
| Pipeline ownership | We own both connections (no HeyGen hosted OpenAI connector) | App logic (transcript capture for grading, 2-minute wrap-up injection) depends on direct access to the OpenAI data channel. HeyGen is a face renderer only. |
| Avatar | Stock avatar | Zero setup; professional preset. Custom/selectable avatars deferred. |
| UI | Video replaces the orb | Full avatar experience. Orb code is retained as the failure fallback, not a user-selectable mode. |
| Fallback trim | Keep orb for now | Fallback needs a visual; orb is ~30 self-contained lines. Revisit deletion after the fallback proves unnecessary in practice. |

## Architecture

Two independent client connections:

1. **OpenAI Realtime (existing, unchanged):** browser WebRTC peer connection in
   `use-realtime.ts`. Mic upstream, AI audio downstream as a remote track, data channel
   for events. All current logic stays.
2. **HeyGen LiveAvatar LITE (new):** WebSocket control channel + WebRTC video session.
   The browser sends the AI's audio to HeyGen; HeyGen returns a synchronized
   audio+video stream of the avatar speaking.

### Audio flow

- An AudioWorklet taps the OpenAI remote audio track and emits PCM16 24 kHz chunks
  (capture/encode only — the source is already 24 kHz, no resampling).
- Chunks are base64-encoded and sent to HeyGen as `agent.speak` events;
  `agent.speak_end` marks utterance boundaries.
- The OpenAI `<audio>` element is muted while video mode is active. The user hears
  HeyGen's returned audio, which is already synchronized with the video — A/V sync is
  the provider's responsibility, not ours.
- On user barge-in (OpenAI response cancellation / output audio buffer events), send
  `agent.interrupt` so the face stops talking with the voice.
- The first interviewer response is deferred until the avatar stream is ready or has
  definitively failed (capped at ~10 s), so the opening utterance never switches
  renderers mid-sentence. Interview timing/wrap-up logic is otherwise unchanged.
- If the audio bridge itself cannot initialize (AudioWorklet unsupported/failed),
  the app degrades to voice-only mode — bridge failure must never break the
  OpenAI connection.

### Expected latency

Audio now round-trips through HeyGen's renderer before playback. Responses will feel
slightly slower than the current orb (sub-second added delay expected). Acceptable for
interview practice; validated in the end-to-end acceptance run.

## Components

- **`src/hooks/use-heygen-avatar.ts` (new):** owns the HeyGen session lifecycle.
  Fetches a session token from the server route, opens the WebSocket + video
  connection, exposes `sendAudioChunk`, `interrupt`, `status`, and a
  `setVideoElement` attach callback (the provider SDK attaches its synchronized
  media tracks to the supplied `<video>` element). Mirrors the shape of
  `use-realtime`.
- **`src/app/api/heygen/session/route.ts` (new):** server-side exchange of
  `HEYGEN_API_KEY` for a short-lived session token. Same pattern as
  `/api/realtime/session`.
- **Audio bridge (new, small):** AudioWorklet module that captures the OpenAI remote
  track as PCM16 24 kHz chunks. `use-realtime` gains an optional audio sink so the
  avatar hook can consume output audio; when no sink is attached, behavior is exactly
  as today.
- **`src/components/interview-view.tsx` (modified):** a `<video>` element becomes the
  centerpiece, rendering the HeyGen stream. The orb remains as the fallback rendering
  path, driven by the existing `audioLevel` analyser.

## Error handling & fallback

The interview must never die because the face did. Voice is primary; video is a
presentation layer.

- **HeyGen session fails to start** (auth, quota, network): begin the interview in
  voice-only mode with the orb; show a quiet "video unavailable — continuing in voice"
  note.
- **Mid-session drop or credit exhaustion:** unmute the OpenAI audio element, swap the
  video for the orb, same quiet note. The conversation continues without interruption.
  Credit exhaustion mid-session is considered likely (trial/low balances), not an edge
  case.
- No retry loops in v1; a dropped video session stays dropped for that interview.

## Environment

- New required env var: `HEYGEN_API_KEY` (alongside existing `OPENAI_API_KEY`).
  Added to `.env.example`.

## Cost surface

Every interview consumes HeyGen LITE credits (~$0.10–0.13/min) in addition to OpenAI
usage. No voice-only UI escape hatch in v1 (fallback triggers only on failure).
Accepted for experimentation; if cost becomes an issue, options are a setup-form
toggle or swapping to a cheaper provider (the audio-in interface makes providers
swappable — Anam and Simli use the same pattern).

## Testing & acceptance

1. **Pre-integration realism check:** eyeball stock avatars in HeyGen's LiveAvatar
   demo playground before writing code. If realism disappoints, reassess provider
   before any integration work.
2. **Playwright (mechanical):** interview page renders video element and receives a
   stream; forced HeyGen failure (bad key / blocked route) triggers the orb fallback
   and the interview still connects.
3. **End-to-end acceptance (human judgment):** a short (~5 min) real interview on dev
   server against HeyGen trial credits. Pass criteria: lip-sync reads as natural,
   added latency is acceptable in conversation, barge-in stops the face promptly.
   This judgment is the user's and is the true acceptance test.

## Out of scope (v1)

- Custom or per-interviewer-style avatars
- User-facing voice-only toggle
- Cost optimization / provider switching
- Any changes to prompts, grading, or interview logic
