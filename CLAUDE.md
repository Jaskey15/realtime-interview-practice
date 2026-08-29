# Interview Practice Agent

Voice-based technical interview practice app. OpenAI Realtime API for live interviews, GPT-5.1 for post-interview grading.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- OpenAI Realtime API via WebRTC
- OpenAI GPT-5.1 for grading (single API key for everything)
- Tailwind CSS v4
- No database — ephemeral sessions

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build
- `npm run lint` — ESLint

## Architecture

- Voice interview: OpenAI Realtime API via WebRTC + server VAD
- Grading: GPT-5.1 via OpenAI API, server-side API route
- Sessions are ephemeral — no DB, state lives in React, export for persistence
- Video interviewer: HeyGen LiveAvatar LITE renders a lip-synced avatar from the
  OpenAI Realtime audio stream, full-bleed; orb UI is the automatic fallback if video fails
- Interviewer identity (avatar, name, voice) is one table in `src/lib/interviewers.ts` —
  face, name, and voice must agree, so change them together
- `/interview` opens on a green room: interviewer portrait + mic check before Begin

## Environment

Requires in `.env.local`:
- `OPENAI_API_KEY`
- `HEYGEN_API_KEY` — LiveAvatar API key (video interviewer; optional, falls back to voice-only)
- `HEYGEN_SANDBOX=true` for free dev sessions — sandbox allows only one avatar, so it
  locks the interviewer to the technical persona for every interview type
  (`HEYGEN_AVATAR_ID` overrides with a single avatar outside sandbox)

