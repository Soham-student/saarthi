import 'dotenv/config';
import { SarvamAIClient } from 'sarvamai';

if (!process.env.SARVAM_API_KEY) {
  console.error('SARVAM_API_KEY is missing from .env');
  process.exit(1);
}

const client = new SarvamAIClient();

try {
  const speech = await client.textToSpeech.convert({
    text: 'Hello. Your multilingual car assistant is ready.',
    model: 'bulbul:v3',
    language_code: 'en-IN',
    output_audio_codec: 'wav',
  });
  const audio = Buffer.from(speech.audios[0], 'base64');
  const transcript = await client.speechToText.transcribe({
    file: { data: audio, filename: 'saarthi-greeting.wav', contentType: 'audio/wav' },
    model: 'saaras:v4',
    language_code: 'unknown',
  });
  const reply = await client.chat.completions({
    model: 'sarvam-105b-conversations',
    messages: [
      { role: 'system', content: 'Reply in one short sentence in the same language as the user.' },
      { role: 'user', content: transcript.transcript },
    ],
    reasoning_effort: null,
    max_tokens: 100,
  });
  if (!transcript.transcript || !reply.choices?.[0]?.message?.content?.trim()) {
    throw new Error('The voice round trip returned an empty result.');
  }
  console.log('Sarvam voice round trip succeeded.');
  console.log(`Recognized language: ${transcript.language_code || 'unknown'}`);
  console.log('Speech-to-text, chat, and text-to-speech calls all returned successfully.');
} catch (error) {
  const status = error.status || error.statusCode || 'unknown';
  console.error(`Sarvam API call failed (status: ${status}). Check key validity, credits, and API access.`);
  process.exitCode = 1;
}
