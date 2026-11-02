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

const assistantInstructions = `You are Saarthi, a calm, concise multilingual voice assistant prototype for a car. Help with common in-car topics: navigation requests, EV charging and range questions, climate, media, calls, settings, and understanding vehicle features. Reply naturally in the language the driver used. Keep spoken answers short, ideally one or two sentences. This prototype is not connected to a vehicle and cannot execute controls, place calls, play media, or navigate; never claim that an action was completed. When asked to change a setting, explain that this demo can only answer questions. Never encourage the driver to type, look at a screen, or do anything that distracts them while driving. For urgent mechanical or safety issues, advise stopping somewhere safe and consulting the vehicle manual, roadside assistance, or emergency services as appropriate.`;

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
  if (!req.file) return res.status(400).json({ error: 'Record a short voice message first.' });
  if (!req.file.mimetype?.startsWith('audio/')) {
    return res.status(415).json({ error: 'Please send an audio recording from your microphone.' });
  }

  try {
    const client = getClient();
    const transcriptResult = await client.speechToText.transcribe({
      file: { data: req.file.buffer, filename: req.file.originalname || 'voice-message.webm', contentType: req.file.mimetype || 'audio/webm' },
      model: 'saaras:v4',
      language_code: 'unknown',
      keyterms: carKeyterms,
    });
    const transcript = transcriptResult.transcript?.trim();
    if (!transcript) return res.status(422).json({ error: 'I could not hear that clearly. Try again.' });

    const detectedLanguage = transcriptResult.language_code || 'en-IN';
    const responseLanguage = ttsLanguages.has(detectedLanguage) ? detectedLanguage : 'en-IN';
    const rawSpeed = Number(req.body?.speed || 0);
    const reportedSpeed = Number.isFinite(rawSpeed) ? Math.max(0, Math.min(300, rawSpeed)) : 0;
    const drivingContext = reportedSpeed >= 90
      ? `The dashboard reports a simulated speed of ${Math.round(reportedSpeed)} km/h. Use one very short, safety-first sentence. Defer nonessential details and do not ask the driver to look at or touch a screen.`
      : reportedSpeed >= 50
        ? `The dashboard reports a simulated speed of ${Math.round(reportedSpeed)} km/h. Keep the answer to one short, speech-friendly sentence and defer nonessential detail. Do not ask the driver to look at or touch a screen.`
        : reportedSpeed > 0
          ? `The dashboard reports a simulated speed of ${Math.round(reportedSpeed)} km/h. Keep the reply concise and audio-friendly. Never ask the driver to look at or touch a screen.`
          : 'The dashboard reports the vehicle parked in this demo. Keep the answer concise and suitable to hear aloud.';
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
    const languageInstruction = responseLanguage === detectedLanguage
      ? `The driver spoke ${detectedLanguage}. Reply in that language.`
      : `The driver spoke ${detectedLanguage}, which this speech voice cannot read aloud. Reply in English so the spoken response matches its voice.`;
    const chatResult = await client.chat.completions({
      model: 'sarvam-105b-conversations',
      messages: [
        { role: 'system', content: `${assistantInstructions}\n\n${languageInstruction}\n\n${drivingContext}` },
        ...history,
        { role: 'user', content: transcript },
      ],
      reasoning_effort: null,
      max_tokens: 180,
      temperature: 0.4,
    });
    const answer = chatResult.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('Empty chat response');

    const speechResult = await client.textToSpeech.convert({
      text: answer.slice(0, 2500),
      model: 'bulbul:v3',
      language_code: responseLanguage,
      output_audio_codec: 'wav',
    });

    return res.json({
      transcript,
      answer,
      detectedLanguage,
      languageConfidence: transcriptResult.language_probability ?? null,
      spokenLanguage: responseLanguage,
      audio: speechResult.audios?.[0] ? `data:audio/wav;base64,${speechResult.audios[0]}` : null,
    });
  } catch (error) {
    const status = error.status || error.statusCode || 502;
    console.error(`Sarvam voice request failed (${status}).`);
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      error: status === 403
        ? 'Sarvam rejected the API key. Check the key in your local .env file.'
        : status === 429
          ? 'Sarvam is busy or the account limit was reached. Try again shortly.'
          : 'The voice request did not complete. Check the server and Sarvam account, then try again.',
    });
  }
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

app.listen(port, () => console.log(`Saarthi voice assistant is ready at http://localhost:${port}`));
