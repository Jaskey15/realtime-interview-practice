The plan is not ready for autonomous implementation. It broadly covers the spec, but four blockers could prevent the avatar path from working or could break the primary voice interview.

## Findings

1. **Blocker — The required realism gate occurs after implementation**

   - Spec: “Testing & acceptance → Pre-integration realism check” requires evaluating stock avatars before writing code.
   - Plan: Tasks 1–8 implement the integration; realism is not judged until Task 9, Step 5.
   - Risk: The team could complete and commit the entire integration before discovering that the chosen provider fails the primary product requirement.
   - Fix: Add Task 0 before dependency installation: inspect several stock avatars in the LiveAvatar playground, record the selected avatar ID, and require an explicit go/no-go decision.

2. **Blocker — Failure of the optional audio bridge can kill the primary interview**

   - Spec: “Error handling & fallback” says the interview must never die because the face did.
   - Plan: Task 6, Step 2 places `new AudioContext({ sampleRate: 24000 })` and `audioWorklet.addModule()` directly inside `useRealtime.connect()`. Either operation throwing sends the entire OpenAI connection through its error cleanup.
   - Risk: A missing worklet, unsupported AudioWorklet environment, CSP issue, or AudioContext failure prevents voice-only fallback.
   - Fix: Treat bridge setup as optional. Establish OpenAI normally, then attempt the capture graph in an isolated `try/catch`. On failure, disable only the avatar sink, leave OpenAI audio connected and unmuted, and surface the normal video-unavailable state.

3. **Blocker — The proposed SDK call does not implement the spec’s utterance boundaries**

   - Spec: “Audio flow” requires many `agent.speak` chunks followed by one `agent.speak_end` at the utterance boundary.
   - Plan: Task 6 sends every one-second chunk through `repeatAudio()`. The plan itself acknowledges under “Known risks” that every call may act as a separate speak/end sequence.
   - Risk: One-second speech fragments can create gaps, repeated facial resets, extra latency, and unnatural lip-sync—the core feature being built.
   - Fix: Resolve this before implementation. Either prove with a focused SDK spike that consecutive `repeatAudio()` calls stream continuously, or plan the raw WebSocket flow from the outset. Add `onSpeechEnd` to `RealtimeAudioSink`, send chunks as `agent.speak`, and send exactly one `agent.speak_end` on `output_audio_buffer.stopped`. Current provider documentation describes `agent.speak` as buffered audio and `agent.speak_end` as the speaking-event boundary. [LiveAvatar LITE events](https://docs.liveavatar.com/docs/lite-mode/events)

4. **Blocker — “Active” does not mean the avatar stream is ready to play**

   - Spec: OpenAI audio is muted while the synchronized HeyGen stream is being heard.
   - Plan: Task 5 sets `status = "active"` immediately after `session.start()`, while `session.stream_ready` independently attaches the media. Task 7 mutes OpenAI whenever status becomes active.
   - Risk: OpenAI may be muted before HeyGen has supplied and attached both media tracks, producing dead air. The known-risk allowance for switching mid-sentence is also not present in the spec.
   - Fix: Introduce distinct `connected` and `streamReady` states. Render video and mute OpenAI only after `session.stream_ready`, successful attachment, and preferably a `video.play()`/media readiness check. Until then, retain the orb and direct audio. Also gate the initial `response.create` until the avatar is ready or has definitively failed, preventing the first response from switching renderers mid-utterance.

5. **Should-fix — The AudioWorklet graph is underspecified and may not process**

   - Plan: Task 6 connects `source → worklet` but provides no downstream connection or explicit verification that the processor remains active.
   - Risk: Browsers may not continuously process a worklet branch that has no active destination. The plan also assumes that requesting a 24 kHz AudioContext guarantees byte-for-byte, non-resampled 24 kHz capture, which is not verified.
   - Fix: Specify a validated graph that keeps the processor active without audible duplicate playback, such as a zero-gain destination branch, and add an in-browser assertion that chunks arrive at the expected sample count/rate. Explicitly verify `audioContext.sampleRate === 24000`; fall back to voice-only if the required format cannot be guaranteed.

6. **Should-fix — Sandbox session duration may make the planned happy-path test fail**

   - Plan: Task 4 always sends `(durationMinutes + 2) * 60` as `max_session_duration`, including sandbox sessions.
   - Provider constraint: `max_session_duration` must not exceed the subscription’s configured limit, while sandbox sessions last approximately one minute. [Create Session Token](https://docs.liveavatar.com/api-reference/sessions/create-session-token), [Sandbox mode](https://docs.liveavatar.com/docs/sandbox-mode)
   - Risk: A five-minute interview requests a seven-minute sandbox duration and may receive a validation error, preventing Task 9’s video-path verification.
   - Fix: Omit `max_session_duration` in sandbox mode or clamp it to the documented sandbox limit. For production, validate the client-controlled duration against the app’s `[5, 10, 15]` options and a server-side maximum.

7. **Should-fix — Session lifecycle cleanup is incomplete**

   - Spec: `use-heygen-avatar` owns the session lifecycle.
   - Plan: Task 5 has no unmount cleanup. Keep-alive promises are not awaited or caught, and a failed keep-alive does not transition to fallback.
   - Risk: Navigation or unexpected component removal can leave a billable session running. Rejected keep-alive promises can become unhandled and leave the UI incorrectly active.
   - Fix: Add an unmount effect that stops the session, clears the interval, and detaches media. Catch keep-alive failures and transition once to `failed`/`stopped`. Make disconnect idempotent and prevent a late disconnect event from changing an intentionally disconnected session back to `"stopped"`.

8. **Should-fix — Task 7 introduces unstable callbacks that can alter timer behavior**

   - Spec: Interview timing and wrap-up behavior must remain unchanged.
   - Plan: `useHeygenAvatar()` returns a new object each render, but `handleConnect` and `handleEnd` depend on the entire `avatar` object. `InterviewView`’s timer effect depends on `onEnd`.
   - Risk: Avatar status and transcript renders recreate `onEnd`, repeatedly tearing down and restarting the timer interval, introducing drift into existing interview behavior.
   - Fix: Destructure the stable avatar methods and status, and depend only on individual callbacks. Alternatively memoize the hook return object. Add a regression check that elapsed time and automatic ending remain accurate through transcript and avatar-status updates.

9. **Should-fix — The planned Playwright failure test mutates local secrets/configuration**

   - Spec: Mechanically force a bad-key or blocked-route failure.
   - Plan: Task 9 comments out `HEYGEN_API_KEY` in `.env.local`.
   - Risk: This is easy to forget to restore, requires restarting Next.js for reliable env loading, and alters user-owned configuration.
   - Fix: Use Playwright route interception to return a 500 from `/api/heygen/session`, or start the test server with a command-scoped environment override. Assert the orb and notice are visible, the OpenAI connection reaches connected state, and direct audio is unmuted.

10. **Should-fix — `git add -A` is unsafe for an autonomous final task**

    - Plan: Task 9, Step 6 stages every repository change.
    - Risk: It can include unrelated user changes or generated artifacts, contrary to the project instruction not to modify unrelated code.
    - Fix: List the exact files changed by verification fixes, inspect `git diff --check` and `git status --short`, then stage only those files.

11. **Should-fix — The plan silently changes the specified hook contract**

    - Spec: “Components” says `use-heygen-avatar` exposes a `videoStream`.
    - Plan: Task 5 exposes `setVideoElement` and attaches through the SDK instead.
    - Assessment: The callback-ref approach may be reasonable, but it is a spec deviation.
    - Fix: Either expose `videoStream` as specified or explicitly amend the spec to approve SDK-managed attachment via `setVideoElement`.

## Sound areas

- The plan preserves the OpenAI peer connection, prompts, transcripts, grading, VAD, and wrap-up logic rather than moving them into HeyGen.
- The orb is retained only as automatic failure fallback; no prohibited voice-only toggle or avatar selector is introduced.
- PCM conversion has focused unit tests, and most tasks end with appropriate lint/typecheck/test/build checks.
- Initial failure, mid-session disconnection, credit exhaustion, no-retry behavior, barge-in, double-audio prevention, and human acceptance are all represented.
- The added sandbox configuration, exact SDK pinning, keep-alive, and bounded production duration are reasonable implementation necessities rather than scope creep, provided the duration handling is corrected.
- Documentation updates are appropriate under the project’s documentation rules.