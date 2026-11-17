import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { SarvamAIClient } from 'sarvamai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
const ttsLanguages = new Set(['bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN']);
const carKeyterms = [
  'Saarthi', 'EV', 'electric vehicle', 'charging station', 'Supercharger', 'battery range',
  'regenerative braking', 'climate control', 'cabin temperature', 'seat heater', 'navigation',
  'cruise control', 'ADAS', 'Sentry Mode', 'Pet Mode', 'Android Auto', 'Apple CarPlay',
  'Bluetooth', 'defogger', 'windshield wipers', 'voice assistant', 'charging port',
];

const assistantInstructions = `You are Saarthi, a calm, concise multilingual voice assistant for a connected vehicle. Help the driver with vehicle status, battery level, driving range, tyre pressures, navigation requests, climate, and vehicle features. Reply naturally in the language the driver used. Keep spoken answers short, helpful, and direct (1-2 sentences). When asked about vehicle readings (such as battery, range, or tyre pressures), provide the current simulated values from the vehicle snapshot (battery is 86%, range is 412 km, tyre pressures are 33 to 34 PSI). Never encourage the driver to type or look at a screen while moving.`;

const getClient = () => {
  if (!process.env.SARVAM_API_KEY) {
    const error = new Error('SARVAM_API_KEY is missing');
    error.status = 503;
    throw error;
  }
  return new SarvamAIClient();
};

app.use(express.static(path.join(currentDir, 'public')));
app.use(express.json({ limit: '4kb' }));

app.get('/api/health', (_req, res) => res.json({ ready: Boolean(process.env.SARVAM_API_KEY) }));

app.post('/api/voice', upload.single('audio'), async (req, res) => {
  let transcript = '';
  let detectedLanguage = 'en-IN';
  let languageConfidence = 0.98;

  if (req.file && req.file.mimetype?.startsWith('audio/')) {
    try {
      const client = getClient();
      const transcriptResult = await client.speechToText.transcribe({
        file: { data: req.file.buffer, filename: req.file.originalname || 'voice-message.webm', contentType: req.file.mimetype || 'audio/webm' },
        model: 'saaras:v4',
        language_code: 'unknown',
        keyterms: carKeyterms,
      });
      transcript = transcriptResult.transcript?.trim();
      if (transcript) {
        detectedLanguage = transcriptResult.language_code || 'en-IN';
        languageConfidence = transcriptResult.language_probability ?? 0.95;
      }
    } catch (err) {
      console.warn('Sarvam STT failed or no API key, falling back to text/simulation:', err.message);
    }
  }

  if (!transcript && typeof req.body?.text === 'string' && req.body.text.trim()) {
    transcript = req.body.text.trim();
    detectedLanguage = typeof req.body?.language === 'string' ? req.body.language : 'en-IN';
  }

  if (!transcript) {
    return res.status(400).json({ error: 'Record a short voice message or type your request.' });
  }

  const preferredLanguage = typeof req.body?.preferredLanguage === 'string' ? req.body.preferredLanguage : 'auto';
  const responseLanguage = ttsLanguages.has(preferredLanguage)
    ? preferredLanguage
    : ttsLanguages.has(detectedLanguage) ? detectedLanguage : 'en-IN';
  const rawSpeed = Number(req.body?.speed || 0);
  const reportedSpeed = Number.isFinite(rawSpeed) ? Math.max(0, Math.min(300, rawSpeed)) : 0;

  let answer = '';
  let audioData = null;

  try {
    const client = getClient();
    const drivingContext = reportedSpeed >= 90
      ? `The dashboard reports a simulated speed of ${Math.round(reportedSpeed)} km/h. Use one very short, safety-first sentence.`
      : 'The dashboard reports the vehicle parked in this demo. Keep the answer concise.';
    
    let history = [];
    try {
      const parsedHistory = JSON.parse(req.body?.history || '[]');
      if (Array.isArray(parsedHistory)) {
        history = parsedHistory
          .filter((turn) => ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string')
          .slice(-8)
          .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 700) }));
      }
    } catch {
      history = [];
    }

    const chatResult = await client.chat.completions({
      model: 'sarvam-105b-conversations',
      messages: [
        { role: 'system', content: `${assistantInstructions}\n\n${drivingContext}` },
        ...history,
        { role: 'user', content: transcript },
      ],
      max_tokens: 180,
      temperature: 0.4,
    });
    answer = chatResult.choices?.[0]?.message?.content?.trim();

    if (answer) {
      try {
        const speechResult = await client.textToSpeech.convert({
          text: answer.slice(0, 2500),
          model: 'bulbul:v3',
          language_code: responseLanguage,
          output_audio_codec: 'wav',
        });
        if (speechResult.audios?.[0]) {
          audioData = `data:audio/wav;base64,${speechResult.audios[0]}`;
        }
      } catch (ttsErr) {
        console.warn('Sarvam TTS failed:', ttsErr.message);
      }
    }
  } catch (apiErr) {
    console.warn('Sarvam API unavailable or key missing, using intelligent local simulation:', apiErr.message);
  }

  if (!answer) {
    const lower = transcript.toLowerCase();
    if (lower.includes('range') || lower.includes('battery') || lower.includes('fuel')) {
      answer = `Your battery is at 86%, giving you an estimated range of 412 kilometers.`;
    } else if (lower.includes('tyre') || lower.includes('tire') || lower.includes('pressure')) {
      answer = `All tyre pressures are normal, reading between 33 and 34 PSI across all four wheels.`;
    } else if (lower.includes('navigate') || lower.includes('charging') || lower.includes('hub') || lower.includes('destination') || lower.includes('route')) {
      answer = `Route preview updated toward the central charging hub. Safe travels.`;
    } else if (lower.includes('speed') || lower.includes('fast')) {
      answer = reportedSpeed > 0
        ? `The dashboard reports a simulated speed of ${Math.round(reportedSpeed)} kilometers per hour.`
        : `The vehicle is currently parked with zero speed.`;
    } else if (lower.includes('status')) {
      answer = reportedSpeed > 0
        ? `The vehicle is moving in drive mode at ${Math.round(reportedSpeed)} km/h with all systems normal.`
        : `The vehicle is parked with all doors closed and all systems operating normally.`;
    } else if (lower.includes('climate') || lower.includes('ac') || lower.includes('temperature')) {
      answer = `Cabin temperature is set to 22.5 degrees Celsius with AC operating normally.`;
    } else {
      answer = `I am Saarthi, your vehicle assistant. All simulated vehicle metrics are operating normally.`;
    }
  }

  return res.json({
    transcript,
    answer,
    detectedLanguage,
    languageConfidence,
    spokenLanguage: responseLanguage,
    audio: audioData,
  });
});

app.post('/api/alert-audio', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const requestedLanguage = typeof req.body?.languageCode === 'string' ? req.body.languageCode : 'en-IN';
  if (!text || text.length > 260) {
    return res.status(400).json({ error: 'Alert text must be between 1 and 260 characters.' });
  }
  const languageCode = ttsLanguages.has(requestedLanguage) ? requestedLanguage : 'en-IN';

  try {
    const client = getClient();
    const speechResult = await client.textToSpeech.convert({
      text,
      model: 'bulbul:v3',
      language_code: languageCode,
      output_audio_codec: 'wav',
    });
    return res.json({
      spokenLanguage: languageCode,
      audio: speechResult.audios?.[0] ? `data:audio/wav;base64,${speechResult.audios[0]}` : null,
    });
  } catch (error) {
    const status = error.status || error.statusCode || 502;
    console.error(`Sarvam alert speech failed (${status}).`);
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      error: 'Sarvam alert audio is unavailable; use the local voice fallback in this demo.',
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That recording is too long. Keep it under 12 MB.' });
  }
  return res.status(400).json({ error: 'The voice recording could not be uploaded.' });
});

app.listen(port, '0.0.0.0', () => console.log(`Saarthi voice assistant is ready at http://0.0.0.0:${port}`));
