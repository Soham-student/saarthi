# Saarthi — multilingual car voice-assistant cockpit demo

Saarthi is a responsive, full-stack JavaScript prototype for a car dashboard. It combines a multilingual Sarvam voice conversation with a searchable catalogue of vehicle signals, a sample map, mock infotainment controls, and a per-signal alert simulator.

## Run locally

```powershell
npm install
npm start
```

Open <http://localhost:3000>. Allow microphone access to speak. Saarthi estimates cabin noise, filters short spikes, detects speech, and sends the recording after about 1.35 seconds of silence. You can tap the mic to stop manually. Recordings have an 8-second no-speech timeout and a 20-second maximum.

The server reads `SARVAM_API_KEY` from `.env`. `.env` is ignored by Git. Start with the blank `.env.example`, then add your own key locally. Never put a real key in source files, browser code, or Git.

## Voice and languages

The browser records microphone audio and applies echo cancellation, noise suppression, and automatic gain control where supported. A local audio-level detector estimates the noise floor and ends capture after speech followed by silence. The server uses Sarvam Saaras v4 for transcription and automatic language detection, Sarvam-105B Conversations for a short reply, and Bulbul v3 for spoken output. The browser lets you choose Auto or a Bulbul v3 voice language.

Saaras v4 supports English and 22 Indic languages. Bulbul v3 supports 10 Indic languages and English. The app can transcribe languages beyond the text-to-speech voice set; when the selected or detected language has no supported Bulbul voice, the spoken reply falls back to English. The interface is English; the voice conversation is multilingual.

## Cockpit screens

- **Drive:** simulated speed, range, battery, a four-wheel tyre-pressure snapshot, route preview, voice assistant, recent alerts, and app shortcuts.
- **Maps:** a drawn sample route with destination presets. There is no live GPS, traffic, or turn-by-turn navigation.
- **Vehicle data:** all 211 items from the supplied vehicle-sensor list in 15 categories. Search by signal, source, or alert guidance; open each group to see the sample value, possible alert rule, collection source, and hardware availability note.
- **Alerts:** select any signal with an applicable alert rule, view its conditions, and preview the alert by voice. Presets demonstrate tyre pressure, fatigue, possible impact, and sensor-fault wording.
- **Apps & audio:** simulated music and map tiles, a parked-only video placeholder, voice playback volume, and system details.

Every sensor entry contains a synthetic sample value and an alert rule. Some values are context only and have no standalone alert. Rules describe when an OEM-approved system might alert; they are not universal thresholds. They do not mark the sample as faulty. The samples are illustrative and may not describe one physically coherent vehicle, since the input list covers both combustion vehicles and EVs.

To rebuild the catalogue from the original text list:

```powershell
npm run catalog:build -- "C:\path\to\sensor-list.txt"
```

## Safety and integration boundary

This project is a browser demo. It is not connected to a car, OBD-II adapter, TPMS, camera, IMU, GPS receiver, airbag module, emergency service, music account, or physical cabin speakers. The displayed vehicle values, route, speed, sensor faults, crash, and fatigue signals are simulated. The alert simulator demonstrates wording only and cannot detect an emergency or contact anyone. Do not use this app as a safety monitor.

Real sensor coverage and diagnostic meanings vary by manufacturer and model. Follow the vehicle's own alerts, manual, tire-pressure placard, and service guidance. TPMS is not a substitute for regular pressure checks. A fatigue message cannot replace rest. Vehicle video should follow the platform's parked-use restrictions; this demo disables its video placeholder when simulated speed is above zero.

References: [NHTSA tire and TPMS guidance](https://www.nhtsa.gov/vehicle-safety/tires), [NHTSA drowsy-driving guidance](https://www.nhtsa.gov/risky-driving/drowsy-driving), [NHTSA driver-assistance technologies and automatic crash notification](https://www.nhtsa.gov/vehicle-safety/driver-assistance-technologies), and [Android for Cars parked-app guidance](https://developer.android.com/design/ui/cars/guides/ux-requirements/adapt-parked-apps).

## API routes

- `GET /api/health` — says whether a key is configured; never returns the key.
- `POST /api/voice` — transcribes audio, sends a brief chat turn, and returns spoken audio.
- `POST /api/alert-audio` — creates short Sarvam TTS audio for demo alerts.
- `GET /data/sensor-catalog.json` — static catalogue of synthetic readings and rule guidance.

## Repositories and secrets

Keep `.env` private and ignored. The tracked `.env.example` intentionally contains only an empty `SARVAM_API_KEY=` entry. Do not paste the key into issues, commits, screenshots, or logs.
