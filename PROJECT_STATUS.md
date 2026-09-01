# Recall — Phase 0 project status

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

The mobile app is responsible for recording state, the elapsed timer, UI state, and the one audio source. The manager is responsible for Gemini connection lifecycle only. The token server is intentionally a replaceable boundary: a future deployed service can preserve the mobile `/token` contract without moving the Gemini API key into the app.

## Important implementation decisions

1. Local audio is the durable source of truth. Live transcription is best effort and can be unavailable without stopping the recorder.
2. PCM configuration is kept in one `AUDIO_CONFIG` object and passed to the same `@siteed/audio-studio` recording pipeline that emits the local file.
3. Interim text is held separately from finalized segments. Final segments are structural records with IDs, elapsed timestamps, finalized status, session generation, and connection ID.
4. A connection generation and overall-recording offset are attached to every transcript event. Rotation therefore does not reset the user's elapsed timeline.
5. Rotation happens before Gemini's documented 10-minute maximum. The replacement connection is established before the previous connection is retired when possible.
6. The mobile client connects directly to Gemini with a short-lived token. The long-lived key exists only in the local Node server environment.
7. Reconnect buffering is bounded so a long outage cannot grow memory without limit. Dropped chunks affect live transcription only; local recording continues.
8. The visual layer uses a small token module with warm neutral surfaces, dark ink, restrained accent color, serif display type, generous spacing, and intentionally minimal components.

## Validation status

Passed in the current workspace:

- `npm run typecheck`
- `npm run server:check`
- `npm test` — 6 files, 20 tests
- `npm run lint`
- `npx expo-doctor` — 17/18 checks; the remaining warning is that the intentionally committed native project contains app.json Prebuild-managed fields that must be synchronized by running Prebuild in a native build pipeline.
- `npx expo prebuild --no-install` — Android native project generated
- Generated Android manifest contains `android.permission.RECORD_AUDIO`.

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
- Tests C–F have not yet been run. Full physical-device retesting remains pending after the development build reload.

Version control:

- Recall has its own Git repository at the project root on `main`; it is separate from the unrelated parent repository under `C:\Users\Mouhssine`.
- The public remote is `https://github.com/MouhssineElBoumshouli/recall.git`. The first milestone commit contains the Phase 0 source, documentation, tests, and reproducible Android native project while excluding local credentials, recordings, dependencies, and build output.

Not yet validated here:

- Native microphone permission prompt and denial flow.
- Actual PCM callback payload and local-file finalization from Android/iOS hardware.
- Reachability of the token server from an emulator or physical device.
- Gemini ephemeral-token issuance with a real key.
- Direct Gemini WebSocket setup, interim/final event shape, multilingual transcription, disconnect/reconnect, and real 8.5-minute rotation.
- Audio preservation when the network or Gemini is disabled.
- App backgrounding, OS interruptions, Bluetooth routes, phone calls, and low-storage behavior.

## Known issues and limits

- The current development environment is Node `22.12.0`, while installed React Native tooling reports a preference for Node `22.13.0` or newer. Upgrade the Node patch version if native tooling behaves unexpectedly.
- `@siteed/audio-studio` is a native module and requires a development build. Expo Go is not the target for this spike.
- iOS native builds require macOS/Xcode; the current workspace is being developed on Windows.
- The token endpoint is intentionally local, unauthenticated, and permissive-CORS. It is not deployable as-is.
- The fallback timestamp is based on when a Gemini event is received, not word-level audio timing.
- During a connection outage, only a small bounded number of chunks are held for replay. A prolonged outage may produce gaps in the live transcript while the source recording remains intact.
- There is no local session database, playback control, upload, transcript export, or retry UI beyond connection/debug state.
- The current UI is a Phase 0 validation surface, not the final Recall navigation or accessibility pass.

## Exact next steps

1. Reload the existing Android development build and repeat Test B against the hardened React Native WebSocket frame handling.
2. If Test B passes, verify Tests C–F on the physical device, including the non-destructive transcription-unavailable case.
3. Upgrade Node to a supported 22.x patch if native build tooling reports engine problems.
4. On macOS, build and verify the equivalent iOS development client and permission flow.
5. Add deterministic integration seams for forced connection failure and shortened rotation tests on device builds, without adding a fake microphone end-to-end test.
6. Harden the token server boundary (authentication, rate limiting, HTTPS, origin policy, and deployment) before any shared or production use.
7. Only after the capture/transcription spike is reliable, add local session persistence and playback as the next product milestone.
