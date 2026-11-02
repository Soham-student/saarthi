# Saarthi — multilingual car voice assistant prototype

Saarthi is a full-stack JavaScript cockpit dashboard that demonstrates a voice conversation loop:

1. The browser asks for mono microphone input with echo cancellation, noise suppression, and automatic gain control.
2. A live RMS voice activity detector estimates the room noise floor, shows the input level, and ends capture after speech followed by silence. It also supports manual stop and has an 8-second no-speech timeout and 20-second recording cap.
3. The Node server sends the audio to Sarvam Saaras v4 for speech recognition and language detection. Vehicle and EV keyterms bias recognition toward likely in-car vocabulary.
4. Sarvam-105B Conversations replies in the detected language, with the previous four turns sent as context.
5. Sarvam Bulbul v3 speaks the answer back when a matching TTS voice is available.

The API key stays in the server environment. The browser never receives it.

## Run it

```powershell
npm install
npm start
```

Open <http://localhost:3000> and allow microphone access. Tap the mic to start, then pause naturally after speaking; voice activity detection will submit after silence. You can also tap again to submit manually. For a quick API round trip without the browser, run:

```powershell
npm run voice:smoke
```

The smoke command synthesizes a short sample, transcribes it, and sends the transcript to chat. It reports only success or status, not the API key or response body.

## Language coverage

Saaras v4 speech recognition supports 22 Indic languages plus English. Bulbul v3 speech output supports 10 Indic languages plus English. When the detected language has no Bulbul v3 voice, the chat is asked to answer in English so the spoken response matches its voice; the original transcription remains available in the UI. The dashboard displays Sarvam's language identification confidence when provided. This measures language detection confidence, not word-by-word transcription accuracy. Sarvam's language and voice availability can change, so check its current API docs when extending language handling.

## Vehicle scope

The dashboard includes a demo map and sample route picker, a four-wheel TPMS view, simulated speed and safety-alert controls, a speaker control panel, system information, and mock media app tiles. The speed slider triggers a spoken reminder above a demo threshold and locks the video tile while moving. Speed-aware chat replies are kept short. The route picker, player, tire values, alerts, and vehicle readings are simulated; no map, music, video, speaker balance, or vehicle-control integration is connected.

Demo safety alerts cover a low-pressure tire, driver fatigue, impact signal, and sensor fault. They appear in the alert center and use Sarvam text-to-speech with a browser speech fallback. This is only an interaction preview: the app has no camera, accelerometer, TPMS, GPS, OBD, airbag, or emergency-service connection, so it cannot detect fatigue or a collision and cannot contact emergency services. Do not use it as a safety monitor. A production system needs validated vehicle signals and OEM-approved integration; urgent alerts should remain available locally when network or cloud services fail.

The alert wording reflects current safety guidance: TPMS is only a warning aid and does not replace regular pressure checks; use the pressure placard/manual for the vehicle. Drowsiness warnings cannot replace rest. Video playback is parked-only in Android Automotive guidance, so this demo disables the YouTube video tile whenever simulated speed is above zero. See [NHTSA tire guidance](https://www.nhtsa.gov/vehicle-safety/tires), [NHTSA drowsy-driving guidance](https://www.nhtsa.gov/risky-driving/drowsy-driving), [NHTSA driver-assistance and automatic crash notification overview](https://www.nhtsa.gov/vehicle-safety/driver-assistance-technologies), and [Android for Cars parked video guidance](https://developer.android.com/design/ui/cars/guides/ux-requirements/adapt-parked-apps).

## API endpoints

- `POST /api/voice` — transcription, conversation, and spoken answer
- `POST /api/alert-audio` — Sarvam TTS for short demo alert announcements
- `GET /api/health` — reports whether a key is configured (never returns the key)

Sarvam references: [Speech to Text](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe), [Chat Completion](https://docs.sarvam.ai/api/token-factory/chat-completions), and [Text to Speech](https://docs.sarvam.ai/api-reference/text-to-speech/convert).
