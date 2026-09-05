# Recall — Phase 2

Recall is a mobile-first multilingual memory and transcription prototype for worldwide lecture, meeting, interview, study, conversation, and brainstorming capture. Phase 0 validated continuous local recording and live transcription. Phase 0.5 added post-recording file transcription, Phase 0.6 added controlled backend comparisons, and Phase 0.7 added an optional language-agnostic, audio-grounded repair pass. Phase 1 turns the transient spike into persistent local sessions. Moroccan Darija remains a difficult stress-test benchmark, not Recall's target language.

## What this prototype proves

- Microphone permission can be requested and handled.
- One `@siteed/audio-studio` recorder produces both the durable local recording and raw PCM stream chunks.
- Audio is configured as mono, signed 16-bit PCM, 16 kHz, with approximately 100 ms chunks where the native platform supports it.
- The app can connect directly to Gemini 3.5 Transcribe Live using a short-lived server-issued token.
- Interim and finalized multilingual/code-switched transcription are rendered separately.
- The local recording remains the priority when the token server, network, or Gemini connection is unavailable.
- Bookmarks retain elapsed timestamps from the beginning of the application-level recording.
- Gemini connections reconnect and rotate around 8.5 minutes while the local recording and elapsed timer continue.
- After recording stops, the saved WAV can be refined asynchronously through the local server while the live transcript and local audio remain available immediately.
- The same saved WAV can be compared across Gemini Transcribe, Cloud Speech-to-Text V2 Chirp 3 (`ar-MA`), Gemini 3.7 Flash audio understanding, the temporary Gemini 3.5 Flash-Lite comparison, and a separate audio-grounded repair of A without overwriting any output.
- The repair layer is language-agnostic by default. Optional session language/locale hints are advisory and preserve code-switching rather than forcing a locale or script.
- Recordings, bookmarks, and transcript layers persist in a versioned local SQLite database across app restarts.
- After transcript processing, the preferred transcript can generate locally persisted structured intelligence: a concise summary, key points, explicit action items, and logical chapters.
- Each saved WAV is copied into an app-owned `document/sessions/<session-id>/audio.wav` directory before the session is inserted into SQLite.
- The home screen lists saved sessions offline. Session detail supports local playback, seeking, bookmarks, rename, and delete without Gemini or the token server.
- Normal session processing runs only the product A → D2 path through `POST /process`; the Phase 0 benchmark matrix remains separate development tooling and is not shown in the normal UI.

This is deliberately not the full Recall product. There is no login, cloud persistence, embeddings, search, cross-session Q&A, sharing, subscriptions, payments, diarization, or settings system.

## Requirements

- Node.js compatible with the Expo SDK 57 toolchain. The current environment is Node `22.12.0`; npm reports that some React Native packages prefer `22.13.0` or newer, so use a newer Node 22 patch release when possible.
- Android Studio and an Android emulator or physical Android device for Android development.
- macOS with Xcode for an iOS native development build. The iOS native build cannot be produced from Windows.
- A Gemini API key with access to the Live API model used by this spike.
- Optional Google Cloud project with Speech-to-Text API V2 enabled and Application Default Credentials for the Chirp 3 comparison.

## Install

```bash
npm install
```

Copy the environment template:

PowerShell:

```powershell
Copy-Item .env.example .env
```

Then set `GEMINI_API_KEY` in `.env`. The `.env` file is ignored by git and must never be placed in the React Native bundle.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | token server only | Long-lived Gemini credential used to mint ephemeral Live API tokens. |
| `TOKEN_SERVER_PORT` | token server | Local HTTP port; defaults to `8787`. |
| `EXPO_PUBLIC_TOKEN_SERVER_URL` | mobile app | URL reachable from the simulator/device, for example `http://10.0.2.2:8787` for the Android emulator. |
| `GOOGLE_CLOUD_PROJECT_ID` | token server only | Optional Google Cloud project ID used to build the V2 recognizer resource path. Leave blank to mark Chirp 3 unavailable. |
| `GOOGLE_CLOUD_SPEECH_LOCATION` | token server only | Optional Cloud Speech-to-Text location; defaults to `us`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | token server only | Optional path used by Google Application Default Credentials. Never commit the credential file. User ADC is also supported. |
| `RECALL_ENABLE_RECONCILIATION` | token server only | Must be `true` to run experimental reconciliation D; defaults to `false` and should remain false until A/B/C work independently. |
| `RECALL_BENCHMARK_LANGUAGE_MODE` | token server only | `hinted` (default) adds the current benchmark's advisory context; `auto` sends empty language context. |

Common local values:

- Android emulator: `EXPO_PUBLIC_TOKEN_SERVER_URL=http://10.0.2.2:8787`
- iOS simulator: `EXPO_PUBLIC_TOKEN_SERVER_URL=http://127.0.0.1:8787`
- Physical device: use the computer's LAN address, for example `http://192.168.1.20:8787`, and keep the device and computer on the same network.

The server listens on `0.0.0.0` for local-device testing. Do not expose this development endpoint publicly without adding authentication, rate limiting, and HTTPS.

## Run the token server

In one terminal:

```bash
npm run server
```

Verify it locally with:

```bash
curl http://127.0.0.1:8787/health
```

The expected response is `{"ok":true}`. `POST /token` mints a single-use ephemeral token constrained to the transcribe-live model and text transcription configuration. `POST /process` is the normal Phase 1 post-recording path for A → D2 processing, and `POST /intelligence` accepts the resolved preferred transcript for Phase 2 structured notes. `POST /transcribe` remains the Phase 0.5 single-backend endpoint, and `POST /benchmark` accepts one raw WAV body for the Phase 0.6/0.7 comparison; all audio-processing/intelligence endpoints are local-development-only and do not retain uploaded audio on the server.

### Optional Chirp 3 setup

The adapter uses the current `@google-cloud/speech` V2 client and Application Default Credentials. It is server-only; no Cloud credential is sent to the mobile app.

1. Select or create a Google Cloud project and enable billing.
2. Enable Speech-to-Text:

```bash
gcloud services enable speech.googleapis.com --project=YOUR_PROJECT_ID
```

3. Configure ADC on the development machine, either with a user login:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

or by setting `GOOGLE_APPLICATION_CREDENTIALS` to an uncommitted service-account JSON path with permission to use Speech-to-Text. Do not put that JSON in this repository.

4. Set `GOOGLE_CLOUD_PROJECT_ID=YOUR_PROJECT_ID` in the local `.env`, then restart the token server. The adapter uses V2 `Recognize`, location `us` by default, model `chirp_3`, and `languageCodes: ['ar-MA']`.

If this setup is absent, the benchmark still runs A, C, C2, and D2; B is returned as `failed` with a configuration message. That is an untested/unavailable backend, not a successful Chirp result.

## Run the Expo app

`@siteed/audio-studio` is a native module, so use a development build rather than relying on Expo Go.

Generate native projects and build a local Android development client:

```bash
npx expo prebuild
npx expo run:android
```

On macOS, the iOS equivalent is:

```bash
npx expo run:ios
```

After the development client is installed, start Metro in another terminal:

```bash
npx expo start --dev-client
```

If native projects already exist and app config changes, rerun `npx expo prebuild` before rebuilding. The audio plugin adds the microphone permission and native configuration during prebuild.

## Android emulator development

The Windows development machine has a local AVD named `Recall_Test` using the stable Android 15/API 35 Google Play x86_64 image. The AVD is local machine state under the Android user profile and must not be committed.

Set the SDK for each new PowerShell session, then launch the emulator with moderate resource use:

```powershell
$sdk = 'C:\Users\Mouhssine\AppData\Local\Android\Sdk'
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$sdk\platform-tools;$sdk\emulator;$sdk\cmdline-tools\latest\bin;$env:Path"
& "$sdk\emulator\emulator.exe" -avd Recall_Test -no-snapshot -no-boot-anim -memory 2048 -gpu auto
```

Keep Metro on an IPv4/LAN-compatible binding. The local server is started separately from the project root using the local `.env`:

```powershell
npm run server
npx expo start --dev-client --host lan --port 8081
```

With both the physical tablet and emulator connected, first list devices and then use the emulator serial explicitly for device operations. The current emulator normally appears as `emulator-5554`; use the serial actually returned by `adb devices -l`.

```powershell
& adb devices -l
& adb -s <emulator-serial> reverse tcp:8081 tcp:8081
& adb -s <emulator-serial> reverse tcp:8787 tcp:8787
```

For a new development-client install, run `npx expo run:android --device` and choose `Recall_Test` in Expo's device picker. If Metro is already running, use `--no-bundler`. Do not pass the physical tablet's serial by accident. After a force-stop, launch through Expo or select the saved Metro project in the development client. If the client has no selected project, this explicit reversed-localhost deep link reloads the existing bundle:

```powershell
& adb -s <emulator-serial> shell am force-stop com.mouhssineee.recall
& adb -s <emulator-serial> shell am start -a android.intent.action.VIEW -d 'exp+recall://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

The emulator is suitable for autonomous checks of startup/relaunch, route navigation, SQLite repository persistence, session loading/error states, rename/delete behavior on emulator-only data, and offline playback with a known local WAV. It is also useful for inspecting logcat and screenshots. A host/emulator microphone can verify permission and native capture plumbing, but it is not equivalent to physical hardware for microphone quality, routing, live latency, or natural speech. Human multilingual/code-switched speech, real device audio paths, interruptions, Bluetooth/phone-call behavior, and final hardware validation still require the Galaxy tablet (or another physical device).

No additional UI automation framework is installed at this stage. ADB, `uiautomator`, screenshots, and the existing Vitest/repository tests cover the current workflow with low setup cost. Maestro can be reconsidered when the navigation and product screens stabilize; it is not needed for this Phase 1 emulator sanity pass.

## Architecture

```text
@siteed/audio-studio recorder
        ├── durable local recording
        └── raw PCM chunks
                │
                ▼
LiveTranscriptionSessionManager
        ├── token request → local Node token server → Gemini API key
        ├── direct constrained Gemini Live WebSocket
        ├── bounded buffering while reconnecting
        └── pre-10-minute session rotation
                │
                ▼
TranscriptAccumulator → finalized segments + separate interim transcript

After stop:

local WAV → POST /transcribe → temporary server file → Gemini Files API
         → gemini-3.5-transcribe (automatic language detection, verbatim)
         → refined transcript → mobile app

Phase 0.6/0.7 benchmark:

local WAV → POST /benchmark → one temporary server file
          ├→ shared Gemini File → gemini-3.5-transcribe (A)
          ├→ Cloud Speech-to-Text V2 Recognize → chirp_3 + ar-MA (B)
          ├→ shared Gemini File → gemini-3.7-flash + strict transcription instruction (C)
          ├→ shared Gemini File → gemini-3.5-flash-lite + the same strict instruction (C2)
          ├→ same shared Gemini File + A transcript → gemini-3.5-flash-lite audio-grounded repair (D2)
          └→ optional shared Gemini File → gemini-3.7-flash reconciliation (D, opt-in only)
```

The mobile app never receives or stores the long-lived Gemini API key. `GeminiTokenClient` talks to the small `/token` boundary, and `GeminiLiveTranscription` uses the returned ephemeral token for a direct WebSocket connection. The session manager owns connection state, reconnect backoff, connection IDs, generation numbers, and timestamp conversion. The recording hook owns application recording state and starts/stops only one native recorder.

The product session path is separate from live transcription. After capture stops, the app first copies the finalized WAV into its session directory and inserts the session plus bookmarks into SQLite. It then posts that durable WAV to `/process`. The server validates the WAV, uses one temporary Gemini File for A (`gemini-3.5-transcribe`) and D2 (`gemini-3.5-flash-lite` repair), deletes the remote File best-effort, and removes its local temporary directory in a `finally` block. The live, raw-final A, and repaired D2 transcript layers are persisted separately. Recall exposes a preferred transcript for downstream product use, currently preferring repaired D2, then A, then live finalized text. That is a replaceable default preference, not a ground-truth claim; the client does not receive the long-lived Gemini key or Cloud credentials.

When a usable preferred transcript is available, the app asynchronously posts only that resolved transcript and optional session language context to `/intelligence`. The server uses `gemini-3.5-flash-lite` with structured JSON output for a concise summary, key points, explicit action items, and logical chapters. The result is stored locally in the one-to-one `session_intelligence` table and is independent of the audio/transcript save path. Intelligence generation is transcript-grounded, does not silently turn a transcript into polished prose, and can be replaced by another provider later. If the preferred transcript changes, the stored source fingerprint makes the intelligence stale; Recall does not regenerate automatically yet.

The Phase 0.6/0.7 benchmark remains available through `POST /benchmark` and its client/service modules for controlled research runs. It is intentionally not part of the normal session history or product presentation.

## Project structure

- `src/app/index.tsx` — offline home/history screen.
- `src/app/record.tsx` — recording route.
- `src/app/session/[id].tsx` — persistent session detail, offline player, transcript, bookmarks, rename, and delete.
- `src/components/RecordingFlow.tsx` — one-source-of-truth recording UI and stop handoff.
- `src/hooks/useRecordingSession.ts` — one-source-of-truth audio recording hook and session persistence handoff.
- `src/providers/SessionProvider.tsx` — app-wide local session repository access and history refresh.
- `src/services/sessionRepository.ts` — SQLite schema, migration, mapping, and repository seam.
- `src/services/sqliteSessionRepository.ts` — Expo SQLite database adapter.
- `src/services/sessionAudioStorage.ts` — durable app-owned WAV copy and target-directory cleanup.
- `src/services/sessionFactory.ts` — session/title/bookmark creation from a completed recording.
- `src/services/sessionProcessingClient.ts` — client for the narrow A → D2 `/process` endpoint.
- `src/services/sessionSnapshot.ts` — ordered local-repository initialization and history snapshot loading.
- `src/services/transcriptPreference.ts` — preferred transcript resolution and the downstream accessor for the replaceable D2 > A > live default.
- `src/services/transcriptFingerprint.ts` — stable preferred-transcript fingerprinting for intelligence staleness checks.
- `src/services/sessionIntelligenceClient.ts` — credential-free mobile client for the `/intelligence` boundary.
- `src/services/sessionIntelligenceWorkflow.ts` — preferred-transcript-gated generation, persistence, retry isolation, and duplicate-run guard.
- `src/services/sessionIntelligenceState.ts` — stale intelligence detection.
- `src/types/intelligence.ts` — structured summary, key-point, action-item, and chapter types.
- `src/types/session.ts` — persistent session, bookmark, status, and transcript-layer types.
- `src/services/liveTranscriptionSessionManager.ts` — reconnect/rotation/session lifecycle.
- `src/services/geminiLiveTranscription.ts` — constrained Gemini Live WebSocket adapter.
- `src/services/geminiTokenClient.ts` — mobile client for the token server.
- `src/services/refinedTranscriptionClient.ts` — posts a saved WAV to the refinement boundary without credentials.
- `src/services/refinementState.ts` — pure refinement status transitions and retry eligibility.
- `src/services/benchmarkClient.ts` — posts one saved WAV to the Phase 0.6 benchmark boundary without credentials.
- `src/services/benchmarkState.ts` — pure benchmark status and independent backend-result state.
- `src/types/languageContext.ts` — optional advisory session language/locale context.
- `src/services/transcriptAccumulator.ts` — structured finalized/interim transcript accumulation and duplicate handling.
- `src/services/sessionTiming.ts` — rotation timing and overall-recording timestamp conversion.
- `src/services/connectionState.ts` — pure connection state transition logic.
- `src/services/bookmarkService.ts` — timestamped bookmark creation.
- `src/types/` — transcript, bookmark, and stopped-recording types.
- `src/design/tokens.ts` — small warm/editorial visual token layer.
- `server/index.ts` — local Node/TypeScript token, session-processing, intelligence, refinement, and benchmark server.
- `server/sessionIntelligenceService.ts` — replaceable-provider boundary and Gemini structured-output adapter for Phase 2.
- `server/transcriptionService.ts` — current @google/genai Files API and Interactions adapters for A and audio-grounded repair D2.
- `server/chirp3TranscriptionService.ts` — optional Cloud Speech-to-Text V2 `Recognize` adapter for `chirp_3` + `ar-MA`.
- `server/benchmarkService.ts` — independent A/B/C/C2/D2 orchestration and opt-in D reconciliation.
- `server/wavValidation.ts` — bounded RIFF/WAVE PCM16 validation and metadata extraction.
- `tests/` — hardware-independent logic, repository, transcript preference, intelligence, and provider tests.

## Checks

```bash
npm run typecheck
npm run server:check
npm test
npm run lint
npx expo-doctor
```

These validate TypeScript, server TypeScript, pure session/transcript/bookmark/refinement/benchmark behavior, ESLint, and Expo dependency/project health. They do not validate microphone hardware, native permissions, codec output, the network route from a device to the token server, Cloud ADC/project setup, or live provider access.

## Known limitations

- Physical Android/iOS recording and the complete live Gemini path still require device or simulator verification with a real API key.
- The current environment's Node `22.12.0` is slightly below the engine range preferred by some installed React Native packages.
- Reconnect buffering is intentionally bounded. Chunks dropped while Gemini is unavailable are not replayed; the local audio file continues to capture.
- Transcript timestamps are receive-time/utterance-level approximations because live transcription events do not currently expose a complete word-level audio timeline in this adapter.
- SQLite stores one local database with sessions and bookmarks; cloud sync and multi-device history are not implemented.
- Phase 2 intelligence is stored locally alongside each session and currently uses `gemini-3.5-flash-lite` server-side. It consumes the centralized preferred transcript, keeps summary/key points/action items/chapters structured, and does not claim that the preferred layer is ground truth.
- Intelligence generation is asynchronous and remains usable while the detail screen is open or the user navigates away, but it is not a background job: terminating the app process can interrupt an in-flight request. A failed generation leaves the saved audio, transcript layers, and session intact and can be retried.
- The current preference order is repaired D2 > raw-final A > live finalized transcript. It is a replaceable downstream preference; a user-selected source and quality-based selection are future seams, not Phase 2 behavior.
- Durable local audio and metadata are product-session scoped, while remote processing/upload history is intentionally not retained on the server.
- Phase 0.6/0.7 benchmark results are current-session only and intentionally unscored. A/B/C/C2 outputs remain raw and separate; D2 is a separate repair of A, not a replacement for it. No script normalization, translation, prose cleanup, or automatic reference scoring is performed.
- D2 uses a generic audio-grounded repair instruction with empty/unknown language context by default in the provider seam. The local benchmark server defaults to advisory hinted context only to evaluate the current difficult multilingual sample; set `RECALL_BENCHMARK_LANGUAGE_MODE=auto` for the no-hints comparison.
- Chirp 3 requires a Google Cloud project, billing, enabled Speech-to-Text API, and ADC. Its `ar-MA` support is documented as Preview and must be manually validated against the same samples.
- Reconciliation D is disabled by default because it is an experimental LLM comparison layer and may hallucinate; it is never run unless `RECALL_ENABLE_RECONCILIATION=true`.
- If remote Gemini File deletion fails, the uploaded resource remains subject to the Gemini service's normal lifecycle; the local temporary WAV is still removed.
- The local token endpoint uses permissive CORS and has no user authentication; it is for development only.
- The UI is intentionally functional and lightly styled. Accessibility, error copy, and visual polish need a dedicated pass after the native pipeline is proven.

## Phase 1 local-session verification

The first physical-device verification should use the connected Android development build and no network dependency for browsing:

1. Start Metro and the local token server only if testing a new recording or post-recording processing.
2. Open Recall and tap `New recording`.
3. Record 10–15 seconds, place a bookmark, and stop. The WAV is finalized and copied before the session is inserted into SQLite.
4. Confirm the session appears on the home history. Processing may still be shown as pending while A → D2 runs.
5. Close and reopen the app. The session should remain visible without the server.
6. Open it, play/pause, tap the timeline to seek, tap a bookmark, and read the saved preferred transcript.
7. Rename the session, close/reopen, then delete it and close/reopen again to confirm deletion persists.

The local `expo-sqlite`, `expo-file-system`, `expo-audio`, and `expo-asset` modules are native dependencies. Changes to their installation or app configuration require `npx expo prebuild` followed by a new development-client build; JavaScript-only changes can use Metro reload after the client is installed.

During development, the recording route includes a compact DEV-only live diagnostic panel showing token/socket/setup milestones and safe audio/transcript event counts. It is not rendered in production builds. If a development client opens to a blank native surface, verify that Metro is running with a device-reachable host and that adb reverse still maps port 8081; the local session database itself does not require Metro or the token server once JavaScript has loaded.

## Phase 0.7 benchmark

With the existing Android development build and token server running, make one fresh 20–30 second multilingual recording. For the current difficult benchmark, a natural Moroccan Darija/French/English sample is useful, but it is not a product-language requirement. Compare the separate outputs shown after stop:

1. `LIVE TRANSCRIPT` — existing live output.
2. `GEMINI TRANSCRIBE · A` — `gemini-3.5-transcribe`, automatic detection, verbatim.
3. `CHIRP 3 ar-MA · B` — Cloud V2 `chirp_3`, explicitly `ar-MA`, or a clear configuration failure if Cloud is not enabled.
4. `GEMINI AUDIO UNDERSTANDING · C` — `gemini-3.7-flash` with the strict no-translation transcription instruction.
5. `GEMINI FLASH-LITE · C2` — `gemini-3.5-flash-lite` with the same strict instruction.
6. `AUDIO-GROUNDED REPAIR · D2` — `gemini-3.5-flash-lite` checks A against the original audio. The result shows `AUTO LANGUAGE CONTEXT` or the benchmark's `HINTED` context.
7. `RECONCILED · D` — only when explicitly enabled after A/B/C have independently succeeded; it remains disabled for this experiment.

Record the duration, recording date, local file URI, backend/model/configuration, raw output, status, and processing time for each. D2 may correct only clearly audio-verifiable recognition errors; it must not translate, summarize, paraphrase, standardize dialect, or make a good transcript prettier. No locale/script normalization, translation, or automatic scoring is applied.
