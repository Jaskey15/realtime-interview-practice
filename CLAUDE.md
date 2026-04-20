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

## Environment

Requires in `.env.local`:
- `OPENAI_API_KEY`

