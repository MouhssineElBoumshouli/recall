# Recall — Phase 0.6 project status

Status date: 2026-09-01

## Completed work

- Bootstrapped an Expo SDK 57 TypeScript application with Expo Router.
- Added `@siteed/audio-studio` as the native audio capture/recording/streaming layer.
- Added a minimal editorial mobile UI with IDLE, RECORDING, and stopped-result states.
- Added microphone permission handling and a clear permission-denied error.
- Configured one native recorder for mono, 16 kHz, signed 16-bit PCM, raw streaming, and approximately 100 ms callbacks.
- Wired that recorder to both the durable local recording and the live audio-chunk callback. No second microphone recorder is created.
- Added a local Node/TypeScript `/health` and `/token` server. It owns `GEMINI_API_KEY` and issues constrained, single-use ephemeral Gemini tokens.
- Added a direct Gemini Live WebSocket adapter for `gemini-3.5-transcribe-live`.
- Configured automatic language detection with an empty `languageCodes` list so mixed-language speech is not forced into one language.
- Added separate interim and finalized transcript state with structured segment metadata.
- Added duplicate-final handling using source event IDs where available and a short text/timestamp fallback window.
- Added reconnect backoff, bounded audio buffering, live connection status, and debug counters.
- Added pre-limit session rotation at approximately 8.5 minutes while retaining one application-level timer and continuous local recording.
- Added timestamped bookmarks with elapsed time and creation time.
- Added app cleanup and stop ordering that prioritizes finalizing the local recording before shutting down Gemini.
- Added hardware-independent Vitest coverage for transcript accumulation, deduplication, timestamp conversion, rotation timing, connection transitions, manager rotation, and bookmark creation.
- Added `.env.example`, README instructions, and this status handoff.
- Added a post-recording `/transcribe` endpoint for bounded raw WAV uploads.
- Added RIFF/WAVE PCM16 validation with useful non-secret metadata checks before contacting Gemini.
- Added server-side Files API upload and `client.interactions.create` refinement using `gemini-3.5-transcribe`, automatic language detection, and verbatim mode.
- Added best-effort deletion of the temporary Gemini File resource and guaranteed cleanup of the server's local temporary directory.
- Added a separate mobile refinement client/state path. The captured screen appears without waiting for refinement and preserves live transcript, local audio, and refinement failure independently.
- Added a temporary dual-output display for `LIVE TRANSCRIPT` and `REFINED TRANSCRIPT`, with non-destructive retry after a refinement failure.
- Added hardware-independent tests for refinement transitions, distinct live/refined output, client upload/error behavior, WAV validation, Gemini gateway cleanup, and the no-client-credential boundary.
- Added the Phase 0.6 benchmark boundary: one saved WAV request produces independent A/B/C/C2 backend results without replacing the live transcript.
- Added optional Cloud Speech-to-Text V2 Chirp 3 adapter using `chirp_3`, `ar-MA`, regional V2 `Recognize`, and server-side Application Default Credentials.
- Added Gemini audio-understanding adapter using `gemini-3.7-flash` with a strict no-translation/no-summary Moroccan code-switching transcription instruction.
- Added temporary Gemini Flash-Lite audio-understanding adapter using `gemini-3.5-flash-lite` with the same strict transcription instruction after its server-side text-only and audio controls succeeded.
- Added opt-in-only reconciliation D using the shared Gemini File and candidate outputs; it is disabled by default and does not run unless explicitly enabled.
- Added temporary benchmark output sections showing model, language configuration, status, raw transcript, and processing time independently for each backend.
- Added independent benchmark orchestration and state tests, including provider failure isolation, shared Gemini upload cleanup, Cloud configuration failure, and reconciliation gating.

## Current architecture

```text
src/app/index.tsx
        │
        ▼
useRecordingSession
        ├── useAudioRecorder (single local recorder)
        │       ├── local file
        │       └── raw PCM stream callback
        ├── LiveTranscriptionSessionManager
        │       ├── GeminiTokenClient → server/index.ts → GEMINI_API_KEY
        │       ├── GeminiLiveTranscription → constrained Live WebSocket
        │       ├── reconnect/backoff and bounded chunk queue
        │       └── 8.5-minute session rotation
        ├── TranscriptAccumulator
        └── bookmarkService
```

After local capture finalizes:

```text
Stopped screen
        ├── existing live finalized transcript
        └── asynchronous RefinedTranscriptionClient → server/index.ts /transcribe
                ├── temporary local WAV
                ├── Gemini Files API upload
                ├── gemini-3.5-transcribe Interactions request
                ├── best-effort Gemini File deletion
                └── temporary local WAV cleanup
```

The mobile app is responsible for recording state, the elapsed timer, UI state, and the one audio source. The manager is responsible for Gemini connection lifecycle only. The token server is intentionally a replaceable boundary: a future deployed service can preserve the mobile `/token` contract without moving the Gemini API key into the app.

Phase 0.6 benchmark execution uses one request and one shared Gemini upload:

```text
mobile saved WAV → server /benchmark → temporary local WAV
                  ├── Gemini File → gemini-3.5-transcribe (A)
                  ├── raw WAV → Cloud Speech-to-Text V2 Recognize, chirp_3 + ar-MA (B)
                  ├── same Gemini File → gemini-3.7-flash audio understanding (C)
                  ├── same Gemini File → gemini-3.5-flash-lite audio understanding (C2)
                  └── same Gemini File + A/B/C candidates → optional reconciliation (D)
```

## Important implementation decisions

1. Local audio is the durable source of truth. Live transcription is best effort and can be unavailable without stopping the recorder.
2. PCM configuration is kept in one `AUDIO_CONFIG` object and passed to the same `@siteed/audio-studio` recording pipeline that emits the local file.
3. Interim text is held separately from finalized segments. Final segments are structural records with IDs, elapsed timestamps, finalized status, session generation, and connection ID.
4. A connection generation and overall-recording offset are attached to every transcript event. Rotation therefore does not reset the user's elapsed timeline.
5. Rotation happens before Gemini's documented 10-minute maximum. The replacement connection is established before the previous connection is retired when possible.
6. The mobile client connects directly to Gemini with a short-lived token. The long-lived key exists only in the local Node server environment.
7. Reconnect buffering is bounded so a long outage cannot grow memory without limit. Dropped chunks affect live transcription only; local recording continues.
8. The visual layer uses a small token module with warm neutral surfaces, dark ink, restrained accent color, serif display type, generous spacing, and intentionally minimal components.
9. Refinement is deliberately a separate result. The live transcript is never overwritten, and local capture success does not depend on the refinement request.
10. The server accepts bounded raw request bodies for this spike, treats MIME as advisory, validates the RIFF/WAVE PCM16 structure from the bytes, and keeps the raw bytes only in a temporary directory while the Gemini request runs. Common WAV MIME variants, Android-style `application/octet-stream`, and missing MIME are accepted when the bytes are valid WAV; invalid bytes, unsupported transport with invalid bytes, and bodies over 50 MB are rejected.
11. The refinement request uses the current JavaScript `@google/genai` Files API followed by `interactions.create` with `gemini-3.5-transcribe`, `language_codes: []`, and verbatim mode. Custom vocabulary is an empty-by-default request seam, not a Darija dictionary or correction pass.
12. The server attempts to delete the temporary Gemini File resource after success or failure. If that remote deletion fails, it logs only a generic cleanup error and the resource follows Gemini's service lifecycle; the server's local copy is still removed.
13. Phase 0.6 keeps the Phase 0.5 Gemini Transcribe adapter/configuration as baseline A and adds Cloud and audio-understanding adapters beside it rather than replacing it.
14. Chirp 3 uses Cloud Speech-to-Text V2 `Recognize` with `model: 'chirp_3'`, `languageCodes: ['ar-MA']`, `autoDecodingConfig: {}`, the `us` regional endpoint by default, and ADC. Project/billing/API/auth setup is intentionally external to the mobile app.
15. Gemini A, C, C2, and optional D reuse a single uploaded Gemini File per benchmark request. The server deletes that remote file best-effort and always removes its local temporary directory.
16. Reconciliation is disabled by default and is only attempted when explicitly enabled after A, B, and C have all independently succeeded. C2 is a separate comparison result and does not silently replace C. No automatic script normalization, translation, scoring, or reference correction is performed.

## Validation status

Passed in the current workspace:

- `npm run typecheck`
- `npm run server:check`
- `npm test` — 13 files, 65 tests
- `npm run lint`
- `npx expo-doctor` — 16/18 checks; the existing warnings are the intentionally committed native project containing app.json Prebuild-managed fields and patch-version mismatches in the Expo SDK 57 dependency set.
- `npx expo prebuild --no-install` — Android native project generated
- Generated Android manifest contains `android.permission.RECORD_AUDIO`.
- Phase 0 physical result — Test B English passed with live interim/final transcription.
- Phase 0 physical result — Test C French passed.
- Phase 0 physical result — Test D English/French code-switching passed.
- Phase 0 physical result — Darija/French/English code-switching was partially successful and inconsistent: Darija sometimes omitted words or changed script, while English/French/Spanish switching was substantially more reliable.
- Phase 0.5/0.6 static result — `npm run typecheck`, `npm run server:check`, `npm test` (13 files, 65 tests), and `npm run lint` passed. `npx expo-doctor` reports 16/18 checks passed; its existing warnings are the committed native project containing app.json Prebuild-managed fields and patch-version mismatches in the Expo SDK 57 dependency set.

Runtime verification attempted on Windows:

- Node `v22.12.0` and npm `10.9.0` are active from `C:\Program Files\nodejs`.
- NVM for Windows is not installed. The official Node download page currently lists Node `v24.20.0` as the latest LTS and Node `v22.23.2` as an LTS maintenance line.
- At the initial environment check, the project `.env` was empty (0 bytes). No `GEMINI_API_KEY`, `TOKEN_SERVER_PORT`, or `EXPO_PUBLIC_TOKEN_SERVER_URL` assignment was present at that time. No credential value was printed.
- `npm run server` correctly exits with `GEMINI_API_KEY is required`; no token server listener is running, so a positive `/token` check is pending a real key.
- Dependencies are installed, including `@siteed/audio-studio@3.2.1`, `@google/genai@2.19.0`, and the Expo SDK 57 dependency set.
- The Android SDK exists at `C:\Users\Mouhssine\AppData\Local\Android\Sdk`, but the current `ANDROID_HOME` points to a nonexistent SYSTEM profile path. The SDK's `adb` is available by absolute path and reports version 36.0.0.
- `adb devices -l` returned no devices. The emulator binary exists, but no AVD definitions were found. No Android Studio command was detected.
- `npx expo run:android` stopped before building because no Android device or emulator was available.
- A direct Gradle `assembleDebug` attempt failed before compilation with `Unable to establish loopback connection`, both with the active Java 25 runtime and with the installed Java 17 runtime. This is an environment/toolchain issue, not a reported Recall source error.

Runtime verification update — physical Android device:

- The real Android SDK was configured for the verification shell at `C:\Users\Mouhssine\AppData\Local\Android\Sdk`, including `platform-tools`, `emulator`, and command-line tools.
- `adb devices -l` shows the authorized physical device `SM_X516B` with state `device`.
- The active LAN IPv4 address was used to configure the non-secret `EXPO_PUBLIC_TOKEN_SERVER_URL` in the project `.env`; the machine-specific value and local Gemini credential are intentionally not committed or documented.
- The incomplete Android NDK/API 36 SDK installation was repaired using the official command-line tools. The incomplete NDK directory was moved to `runtime-recovery` as a recoverable local backup; no application code or dependency versions were changed.
- Gradle completed successfully with Java 17 and a short temporary directory (`C:\tmp`) in the verification shell. Expo installed the debug development build and opened Recall on `SM_X516B`; Metro bundled the application successfully.
- Test A — PASSED on the physical device. Microphone permission was granted, recording ran for `00:10`, one bookmark was created, stopping produced the local URI `file:/data/user/0/com.mouhssineee.recall/files/4f244962-71b0-474b-939d-7d0c8e4d3208.wav`, and the stopped screen reported 43 live-transcription chunks dropped while unavailable. `adb` verified the file exists and is 321,964 bytes. The first 44 bytes are a consistent RIFF/WAVE PCM header: mono, 16,000 Hz, 16-bit, with matching data length. This validates local recording independently of Gemini.
- Test B — FAILED on the physical device before this protocol hardening pass. Local recording ran for approximately seven seconds with generation 1, zero reconnect attempts, zero dropped chunks, and zero finalized transcript segments. The failure was consistent with the client treating WebSocket `onopen` as Gemini readiness, allowing the manager to send audio before the server's `setupComplete` response. The prior parser could also discard a final transcription when the same message contained both interim and final fields, and shutdown used a fixed 350 ms sleep rather than a protocol completion signal.
- Gemini Live protocol hardening is now implemented: the connection resolves only after `setupComplete`, audio is gated until setup, current camelCase interim/final fields are emitted independently, and stop/rotation send `audioStreamEnd` then wait for `turnComplete` with a bounded timeout and a short late-final drain.
- Controlled handshake diagnosis — `@google/genai` 2.19.0's installed source selects `BidiGenerateContentConstrained` for `auth_tokens/...` credentials and documents its ephemeral-token support as `v1alpha` only. Current Google documentation describes raw ephemeral-token connections on `v1beta`; fresh minimal-token official-SDK connections succeeded on both versions, as did raw Node WebSocket connections on both versions. A token issued by the existing server, including `lockAdditionalFields`, also completed setup successfully. No API-version or token-configuration change was justified.
- React Native handshake diagnosis — a temporary development-only app probe completed the direct mobile handshake without audio and recorded `socketOpened=true`, `setupSent=true`, `setupComplete=true`, one server message, and `arrayBuffer` as the message data type. The prior adapter discarded non-string WebSocket frames before counting or parsing them. The adapter now decodes supported text, `ArrayBuffer`, and `Blob` frames and records token/setup/timeout/message-type diagnostics. The disposable probe was removed and is not committed.
- Phase 0 physical results — Test B English, Test C French, and Test D English/French code-switching passed. Live interim and finalized transcription worked, and local recording remained reliable.
- Phase 0 physical result — Test E natural Darija/French/English switching was partially successful and inconsistent. Darija sometimes missed words or changed between Arabic and Latin script; English/French/Spanish switching was substantially more reliable.
- Phase 0 physical result — Test F confirmed local audio capture survives Gemini unavailability.
- Phase 0.5 physical benchmark — the first natural Darija/French/English LIVE-vs-REFINED comparison completed. Live transcription worked technically; `gemini-3.5-transcribe` was visibly better than Live at recovering French/English code-switching but remained below acceptable Darija accuracy. Raw output remains a manual benchmark artifact; no normalization or automatic scoring was applied.
- Phase 0.5 physical result — the Android WAV refinement transport now succeeds through `/transcribe`; the English LIVE-vs-REFINED path was validated, while Darija quality remained the unresolved benchmark question.
- Phase 0.5 physical test reached `/transcribe` after successful local stops, but every refinement attempt initially returned HTTP 415 before Gemini transcription. Refined output was therefore not evaluated in that run.
- The previous 415 came from the server requiring an exact `Content-Type: audio/wav` before inspecting the body. React Native Android's Blob request handling can use the Blob's own MIME metadata or fall back to `application/octet-stream`, overriding the caller's header. The exact header from the failed physical request was not captured before this diagnostic was added.
- `/transcribe` now logs only the normalized incoming Content-Type and Content-Length, then validates the raw bytes as RIFF/WAVE PCM16. The server accepts `audio/wav`, `audio/x-wav`, `audio/wave`, `audio/vnd.wave`, `application/octet-stream`, missing MIME, and any other transport MIME when the bytes themselves are a valid WAV. Invalid bytes remain rejected, and the 50 MB limit remains enforced.
- Refinement failures now use non-secret error codes for missing audio, unsupported transport, invalid WAV, oversized upload, Gemini Files upload failure, and Gemini transcription failure. The mobile client maps these to concise messages without exposing server internals.
- Retry refinement now has an explicit in-flight controller: a retry enters `Refining transcript…`, blocks duplicate requests, and transitions to either succeeded or failed. The Retry button is not shown while a request is active.
- The existing Android development build was reloaded through Metro after the transport fix. No native rebuild or dependency/configuration change was required. `adb reverse` remains configured for ports 8081 and 8787. No new physical recording has been performed after the fix; the next recording should capture the server's non-sensitive Content-Type diagnostic.
- Phase 0.6 backend benchmark implementation is complete in the workspace. No Phase 0.6 physical A/B/C recording has been performed by the coding session.
- Current documented model/configuration findings: Gemini 3.5 Transcribe remains automatic-detection/verbatim for A; Cloud Chirp 3 B is explicitly `ar-MA`; Gemini audio understanding C is `gemini-3.7-flash` with the strict raw-transcription instruction. Gemini API credentials remain server-only; Cloud ADC remains server-only.
- Phase 0.6 physical sanity test — LIVE succeeded; A (`gemini-3.5-transcribe`) succeeded in approximately 2.9 seconds; B (Chirp 3 `ar-MA`) failed as intentionally expected because Google Cloud is not configured; C (`gemini-3.7-flash`) failed after approximately 33 seconds with only the prior generic UI error.
- Phase 0.6 C control matrix — using the latest saved valid mono 16 kHz PCM16 WAV (250,284 bytes) and installed `@google/genai` 2.19.0, C0 text-only, C1 File URI with the official text-first request, C2 with the existing Darija prompt, and C3 inline base64 audio were all rejected by Google with HTTP 429 quota errors for `generate_content_free_tier_requests` on `gemini-3.7-flash`. The one permitted raw REST C1 comparison returned the same HTTP 429 with provider code `too_many_requests`. C4 sequential/parallel comparison was blocked because C1 did not succeed.
- The control matrix therefore identifies an account/model quota blocker, not an audio-format, File URI, text/audio ordering, shared-file concurrency, or React Native issue. The installed SDK's default Interactions API version is `v1beta`, matching the current official audio-understanding examples; no SDK upgrade or API-version change was justified. Recall C now matches the official text-first/audio-second order.
- Backend C now preserves non-secret diagnostics for model, stage, provider code, and HTTP status in server logs and exposes only compact stage/code/status metadata to the temporary benchmark UI. Provider messages redact URIs, bearer values, and query credentials; API keys, tokens, audio, and transcript output are never logged.

Version control:

- Recall has its own Git repository at the project root on `main`; it is separate from the unrelated parent repository under `C:\Users\Mouhssine`.
- The public remote is `https://github.com/MouhssineElBoumshouli/recall.git`. The first milestone commit contains the Phase 0 source, documentation, tests, and reproducible Android native project while excluding local credentials, recordings, dependencies, and build output.

Not yet validated here:

- Native microphone permission prompt and denial flow.
- Actual PCM callback payload and local-file finalization from Android/iOS hardware.
- Phase 0.6 A/B/C provider comparison against a fresh physical WAV on Android.
- Remote Gemini File deletion behavior under an actual refinement request; the cleanup path is unit-tested and logs no secret or audio content.
- App backgrounding, OS interruptions, Bluetooth routes, phone calls, and low-storage behavior.

## Known issues and limits

- The current development environment is Node `22.12.0`, while installed React Native tooling reports a preference for Node `22.13.0` or newer. Upgrade the Node patch version if native tooling behaves unexpectedly.
- `@siteed/audio-studio` is a native module and requires a development build. Expo Go is not the target for this spike.
- iOS native builds require macOS/Xcode; the current workspace is being developed on Windows.
- The token endpoint is intentionally local, unauthenticated, and permissive-CORS. It is not deployable as-is.
- The fallback timestamp is based on when a Gemini event is received, not word-level audio timing.
- During a connection outage, only a small bounded number of chunks are held for replay. A prolonged outage may produce gaps in the live transcript while the source recording remains intact.
- There is no local session database, playback control, transcript export, or durable refinement history.
- The current UI is a Phase 0 validation surface, not the final Recall navigation or accessibility pass.
- Phase 0.5 refinement has now been benchmarked on one physical natural Darija/French/English sample, with meaningful but insufficient Darija improvement. Results remain current-session only.
- Phase 0.6 benchmark results are current-session only; A/B/C/C2 remain raw independent outputs, and D is opt-in experimental only.
- The first Phase 0.6 C control matrix could not evaluate audio understanding because the configured Gemini account returned HTTP 429 free-tier quota exhaustion for `gemini-3.7-flash` on text-only, File URI, inline-audio, SDK, and raw REST requests. Restore eligible quota or billing/access before attempting another C benchmark; do not treat this as a Darija-quality result.
- Phase 0.6 C2 control — `gemini-3.5-flash-lite` text-only invocation succeeded, a temporary Gemini File upload succeeded, and the same strict Darija/French/English audio request succeeded. The output was intentionally not printed or benchmarked for quality during this control.
- Chirp 3 cannot be considered tested until a Cloud project, billing, Speech-to-Text API V2, and ADC are configured. The official Cloud documentation lists Moroccan Arabic `ar-MA` for Chirp 3 as Preview.
- The local `/transcribe` endpoint is intentionally unauthenticated and accepts raw audio only for this development spike. It must not be exposed beyond the trusted development network.

## Exact next steps

1. If Chirp 3 is required, enable Cloud Speech-to-Text V2, billing, and ADC as documented in `README.md`, set the local server variables, and restart the server.
2. After Gemini 3.7 Flash quota/access is restored, reload the existing Android development build through Metro and run one fresh 20–30 second natural Darija/French/English sample to compare LIVE, A, B, C, and C2 without normalization. C2 is now available for comparison, but no new sample is needed until the next benchmark run is desired.
3. Record duration, date, local WAV URI, backend/model/configuration, raw output, status, and processing time for each result. Add a manually corrected REFERENCE only later; do not score automatically yet.
4. Leave D disabled until A, B, and C have each succeeded independently on real samples.
5. Keep real 8.5-minute rotation and iOS verification as later Phase 0 validation work; do not treat this benchmark as a broader product milestone.
