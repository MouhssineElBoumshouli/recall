# Recall — Phase 0.5

Recall is a mobile-first multilingual memory and transcription prototype. Phase 0 validated the continuous local recording and live transcription pipeline. Phase 0.5 adds a post-recording refined transcript benchmark using the saved WAV and `gemini-3.5-transcribe`.

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

This is deliberately not the full Recall product. There is no login, cloud persistence, playback screen, summarization, embeddings, search, cross-session Q&A, sharing, or settings system.

## Requirements

- Node.js compatible with the Expo SDK 57 toolchain. The current environment is Node `22.12.0`; npm reports that some React Native packages prefer `22.13.0` or newer, so use a newer Node 22 patch release when possible.
- Android Studio and an Android emulator or physical Android device for Android development.
- macOS with Xcode for an iOS native development build. The iOS native build cannot be produced from Windows.
- A Gemini API key with access to the Live API model used by this spike.

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

The expected response is `{"ok":true}`. `POST /token` mints a single-use ephemeral token constrained to the transcribe-live model and text transcription configuration. `POST /transcribe` accepts a raw `audio/wav` body for Phase 0.5 refinement; the endpoint is local-development-only and does not retain the uploaded audio on the server.

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
```

The mobile app never receives or stores the long-lived Gemini API key. `GeminiTokenClient` talks to the small `/token` boundary, and `GeminiLiveTranscription` uses the returned ephemeral token for a direct WebSocket connection. The session manager owns connection state, reconnect backoff, connection IDs, generation numbers, and timestamp conversion. The recording hook owns application recording state and starts/stops only one native recorder.

The refinement path is separate from live transcription. The mobile app posts the finalized local WAV to `/transcribe` only after capture has stopped. The server validates the WAV, writes it to a temporary directory, uploads it with `ai.files.upload`, calls `ai.interactions.create` with `gemini-3.5-transcribe`, attempts to delete the temporary Gemini File resource, and removes its local temporary directory in a `finally` block. It returns only the refined text and model name. The client does not receive the long-lived key.

## Project structure

- `src/app/index.tsx` — minimal IDLE, RECORDING, and stopped-result UI.
- `src/hooks/useRecordingSession.ts` — one-source-of-truth audio recording hook and screen-facing state.
- `src/services/liveTranscriptionSessionManager.ts` — reconnect/rotation/session lifecycle.
- `src/services/geminiLiveTranscription.ts` — constrained Gemini Live WebSocket adapter.
- `src/services/geminiTokenClient.ts` — mobile client for the token server.
- `src/services/refinedTranscriptionClient.ts` — posts a saved WAV to the refinement boundary without credentials.
- `src/services/refinementState.ts` — pure refinement status transitions and retry eligibility.
- `src/services/transcriptAccumulator.ts` — structured finalized/interim transcript accumulation and duplicate handling.
- `src/services/sessionTiming.ts` — rotation timing and overall-recording timestamp conversion.
- `src/services/connectionState.ts` — pure connection state transition logic.
- `src/services/bookmarkService.ts` — timestamped bookmark creation.
- `src/types/` — transcript, bookmark, and stopped-recording types.
- `src/design/tokens.ts` — small warm/editorial visual token layer.
- `server/index.ts` — local Node/TypeScript token and post-recording refinement server.
- `server/transcriptionService.ts` — current @google/genai Files API and Interactions adapter for `gemini-3.5-transcribe`.
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

These validate TypeScript, server TypeScript, pure session/transcript/bookmark/refinement behavior, ESLint, and Expo dependency/project health. They do not validate microphone hardware, native permissions, codec output, the network route from a device to the token server, or live Gemini account/model access.

## Known limitations

- Physical Android/iOS recording and the complete live Gemini path still require device or simulator verification with a real API key.
- The current environment's Node `22.12.0` is slightly below the engine range preferred by some installed React Native packages.
- Reconnect buffering is intentionally bounded. Chunks dropped while Gemini is unavailable are not replayed; the local audio file continues to capture.
- Transcript timestamps are receive-time/utterance-level approximations because live transcription events do not currently expose a complete word-level audio timeline in this adapter.
- No local recording playback or durable session index has been added yet.
- Phase 0.5 refinement is current-session only; there is no durable transcript/refinement database or upload history.
- If remote Gemini File deletion fails, the uploaded resource remains subject to the Gemini service's normal lifecycle; the local temporary WAV is still removed.
- The local token endpoint uses permissive CORS and has no user authentication; it is for development only.
- The UI is intentionally functional and lightly styled. Accessibility, error copy, and visual polish need a dedicated pass after the native pipeline is proven.

## Phase 0.5 benchmark

With the existing Android development build and token server running, make four manual recordings and compare the two unmodified outputs shown after each stop:

1. English
2. French
3. English/French code-switching
4. Natural Moroccan Darija/French/English code-switching

Record the duration, live transcript, refined transcript, local file URI, and refinement status for each. No locale is forced and no Arabic/Latin script normalization or correction is applied.
