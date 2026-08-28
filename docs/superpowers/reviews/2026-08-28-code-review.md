The patch passes tests, lint, type-checking, and production build, but it has lifecycle races that can switch audio renderers during the opening response and leave a billable avatar session running after realtime setup fails.

Full review comments:

- [P1] Stop the avatar when the startup deadline expires — /Users/jacobaskey/conductor/workspaces/realtime-interview-practice/honiara/src/app/interview/page.tsx:95-95
  If the avatar becomes active after this 10-second timer fires, the opening response has already begun in voice-only mode, but the active-state effect then installs the sink and mutes OpenAI mid-utterance. This is especially possible because the avatar watchdog allows 15 seconds and `session.start()` itself has no timeout. Treat the deadline as definitive fallback by disconnecting or otherwise preventing the late avatar from becoming active.

- [P1] Tear down the avatar when the realtime connection fails — /Users/jacobaskey/conductor/workspaces/realtime-interview-practice/honiara/src/app/interview/page.tsx:101-103
  When microphone permission is denied or the OpenAI token/SDP handshake fails after the parallel avatar connection succeeds, realtime enters `error` but nothing disconnects HeyGen. The End button is disabled unless realtime is connected, so the user cannot stop the avatar and its keep-alive continues consuming the session until the provider duration limit. Disconnect the avatar whenever realtime connection setup fails.