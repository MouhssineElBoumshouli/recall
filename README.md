# Recall — Phase 0.6

Recall is a mobile-first multilingual memory and transcription prototype. Phase 0 validated the continuous local recording and live transcription pipeline. Phase 0.5 added post-recording file transcription. Phase 0.6 adds a controlled Darija backend benchmark using the same saved WAV.

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
- The same saved WAV can be compared across Gemini Transcribe, Cloud Speech-to-Text V2 Chirp 3 (`ar-MA`), Gemini 3.7 Flash audio understanding, and the temporary Gemini 3.5 Flash-Lite comparison without overwriting any output.

This is deliberately not the full Recall product. There is no login, cloud persistence, playback screen, summarization, embeddings, search, cross-session Q&A, sharing, or settings system.

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

The expected response is `{"ok":true}`. `POST /token` mints a single-use ephemeral token constrained to the transcribe-live model and text transcription configuration. `POST /transcribe` remains the Phase 0.5 single-backend endpoint. `POST /benchmark` accepts one raw WAV body and runs the Phase 0.6 comparison; both endpoints are local-development-only and do not retain uploaded audio on the server.

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

If this setup is absent, the benchmark still runs A and C; B is returned as `failed` with a configuration message. That is an untested/unavailable backend, not a successful Chirp result.

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

Phase 0.6 benchmark:

local WAV → POST /benchmark → one temporary server file
          ├→ shared Gemini File → gemini-3.5-transcribe (A)
          ├→ Cloud Speech-to-Text V2 Recognize → chirp_3 + ar-MA (B)
          ├→ shared Gemini File → gemini-3.7-flash + strict transcription instruction (C)
          ├→ shared Gemini File → gemini-3.5-flash-lite + the same strict instruction (C2)
          └→ optional shared Gemini File → gemini-3.7-flash reconciliation (D, opt-in only)
```

The mobile app never receives or stores the long-lived Gemini API key. `GeminiTokenClient` talks to the small `/token` boundary, and `GeminiLiveTranscription` uses the returned ephemeral token for a direct WebSocket connection. The session manager owns connection state, reconnect backoff, connection IDs, generation numbers, and timestamp conversion. The recording hook owns application recording state and starts/stops only one native recorder.

The refinement and benchmark paths are separate from live transcription. After capture stops, the mobile app posts the finalized local WAV once to `/benchmark`. The server validates the WAV, writes it to a temporary directory, shares one `ai.files.upload` result between Gemini A/C/C2/D, calls Cloud V2 directly for B, attempts to delete the temporary Gemini File, and removes its local temporary directory in a `finally` block. Results are returned independently with status, model, language configuration, raw transcript, and processing time. The client does not receive the long-lived Gemini key or Cloud credentials.

## Project structure

- `src/app/index.tsx` — minimal IDLE, RECORDING, and stopped-result UI.
- `src/hooks/useRecordingSession.ts` — one-source-of-truth audio recording hook and screen-facing state.
- `src/services/liveTranscriptionSessionManager.ts` — reconnect/rotation/session lifecycle.
- `src/services/geminiLiveTranscription.ts` — constrained Gemini Live WebSocket adapter.
- `src/services/geminiTokenClient.ts` — mobile client for the token server.
- `src/services/refinedTranscriptionClient.ts` — posts a saved WAV to the refinement boundary without credentials.
- `src/services/refinementState.ts` — pure refinement status transitions and retry eligibility.
- `src/services/benchmarkClient.ts` — posts one saved WAV to the Phase 0.6 benchmark boundary without credentials.
- `src/services/benchmarkState.ts` — pure benchmark status and independent backend-result state.
- `src/services/transcriptAccumulator.ts` — structured finalized/interim transcript accumulation and duplicate handling.
- `src/services/sessionTiming.ts` — rotation timing and overall-recording timestamp conversion.
- `src/services/connectionState.ts` — pure connection state transition logic.
- `src/services/bookmarkService.ts` — timestamped bookmark creation.
- `src/types/` — transcript, bookmark, and stopped-recording types.
- `src/design/tokens.ts` — small warm/editorial visual token layer.
- `server/index.ts` — local Node/TypeScript token and post-recording refinement server.
- `server/transcriptionService.ts` — current @google/genai Files API and Interactions adapter for `gemini-3.5-transcribe`.
- `server/chirp3TranscriptionService.ts` — optional Cloud Speech-to-Text V2 `Recognize` adapter for `chirp_3` + `ar-MA`.
- `server/benchmarkService.ts` — independent A/B/C/C2 orchestration and opt-in D reconciliation.
- `server/wavValidation.ts` — bounded RIFF/WAVE PCM16 validation and metadata extraction.
- `tests/` — hardware-independent logic tests.

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
- No local recording playback or durable session index has been added yet.
- Phase 0.5 refinement is current-session only; there is no durable transcript/refinement database or upload history.
- Phase 0.6 benchmark results are current-session only and intentionally unscored. A/B/C/C2 outputs remain raw and separate; no Arabic/Latin normalization or automatic reference scoring is performed.
- Chirp 3 requires a Google Cloud project, billing, enabled Speech-to-Text API, and ADC. Its `ar-MA` support is documented as Preview and must be manually validated against the same samples.
- Reconciliation D is disabled by default because it is an experimental LLM comparison layer and may hallucinate; it is never run unless `RECALL_ENABLE_RECONCILIATION=true`.
- If remote Gemini File deletion fails, the uploaded resource remains subject to the Gemini service's normal lifecycle; the local temporary WAV is still removed.
- The local token endpoint uses permissive CORS and has no user authentication; it is for development only.
- The UI is intentionally functional and lightly styled. Accessibility, error copy, and visual polish need a dedicated pass after the native pipeline is proven.

## Phase 0.6 benchmark

With the existing Android development build and token server running, make one fresh 20–30 second natural Moroccan Darija/French/English recording first. Compare the separate outputs shown after stop:

1. `LIVE TRANSCRIPT` — existing live output.
2. `GEMINI TRANSCRIBE · A` — `gemini-3.5-transcribe`, automatic detection, verbatim.
3. `CHIRP 3 ar-MA · B` — Cloud V2 `chirp_3`, explicitly `ar-MA`, or a clear configuration failure if Cloud is not enabled.
4. `GEMINI AUDIO UNDERSTANDING · C` — `gemini-3.7-flash` with the strict no-translation transcription instruction.
5. `GEMINI FLASH-LITE · C2` — `gemini-3.5-flash-lite` with the same strict instruction.
6. `RECONCILED · D` — only when explicitly enabled after A/B/C have independently succeeded.

Record the duration, recording date, local file URI, backend/model/configuration, raw output, status, and processing time for each. No locale/script normalization, translation, correction, or automatic scoring is applied.
