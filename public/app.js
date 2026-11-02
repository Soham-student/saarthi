const micButton = document.querySelector('#micButton');
const micLabel = document.querySelector('#micLabel');
const assistantPanel = document.querySelector('#assistantPanel');
const voiceState = document.querySelector('#voiceState');
const voiceHint = document.querySelector('#voiceHint');
const recordingTime = document.querySelector('#recordingTime');
const inputQuality = document.querySelector('#inputQuality');
const vadLabel = document.querySelector('#vadLabel');
const waveform = document.querySelector('#waveform');
const conversation = document.querySelector('#conversation');
const transcriptText = document.querySelector('#transcriptText');
const answerText = document.querySelector('#answerText');
const detectedLanguage = document.querySelector('#detectedLanguage');
const replyLanguage = document.querySelector('#replyLanguage');
const confidenceValue = document.querySelector('#confidenceValue');
const confidenceBar = document.querySelector('#confidenceBar');
const answerAudio = document.querySelector('#answerAudio');
const speedSlider = document.querySelector('#speedSlider');
const speedValue = document.querySelector('#speedValue');
const alertList = document.querySelector('#alertList');
const tirePanel = document.querySelector('#tirePanel');
const tireAlert = document.querySelector('#tireAlert');
const videoApp = document.querySelector('#youtubeVideoButton');
const videoAppState = document.querySelector('#videoAppState');
const videoNotice = document.querySelector('#videoNotice');
const MAX_RECORDING_MS = 20_000;
const NO_SPEECH_TIMEOUT_MS = 8_000;
const SILENCE_TIMEOUT_MS = 1_350;

let recorder;
let microphoneStream;
let audioContext;
let audioChunks = [];
let meterFrame;
let recordingStartedAt = 0;
let speechStartedAt = 0;
let lastVoiceAt = 0;
let noSpeechTimer;
let maxDurationTimer;
let clockTimer;
let noiseFloor = 0;
let noiseSamples = 0;
let loudFrames = 0;
let pendingDiscard = false;
let conversationHistory = [];
let simulatedSpeed = 0;
let speedAlertActive = false;
let simulatedTirePressure = { FL: 34, FR: 34, RL: 33, RR: 33 };
let demoAlerts = [];
let alertAudio;
let alertRequestNumber = 0;
let toastTimer;
let demoPlayerTimer;
let demoPlayerProgress = 8;

for (let index = 0; index < 31; index += 1) {
  const bar = document.createElement('span');
  bar.style.setProperty('--bar-height', `${3 + ((index * 7) % 7)}px`);
  waveform.append(bar);
}
const waveformBars = [...waveform.children];

function updateStatus(title, detail = '', mode = 'idle') {
  voiceState.textContent = title;
  voiceHint.textContent = detail;
  assistantPanel.classList.toggle('processing', mode === 'processing');
  assistantPanel.classList.toggle('error', mode === 'error');
}

function showToast(title, message, severity = 'info') {
  let toast = document.querySelector('.alert-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'alert-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.className = `alert-toast ${severity}`;
  toast.innerHTML = '';
  const heading = document.createElement('b');
  const content = document.createElement('span');
  heading.textContent = title;
  content.textContent = message;
  toast.append(heading, content);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 6500);
}

function localVoiceFallback(text, severity) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-IN';
  utterance.rate = severity === 'critical' ? 0.98 : 1;
  utterance.volume = Number(document.querySelector('#volumeSlider').value) / 100;
  window.speechSynthesis.speak(utterance);
}

async function speakAlert(text, severity = 'warning') {
  const requestNumber = ++alertRequestNumber;
  const fallbackDelay = severity === 'critical' ? 800 : 3500;
  let spoken = false;
  if (alertAudio) {
    alertAudio.pause();
    alertAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const fallbackTimer = setTimeout(() => {
    if (requestNumber === alertRequestNumber && !spoken) {
      spoken = true;
      localVoiceFallback(text, severity);
    }
  }, fallbackDelay);

  try {
    const response = await fetch('/api/alert-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, languageCode: 'en-IN' }),
      signal: AbortSignal.timeout(7000),
    });
    const result = await response.json();
    if (!response.ok || !result.audio || requestNumber !== alertRequestNumber || spoken) return;
    clearTimeout(fallbackTimer);
    alertAudio = new Audio(result.audio);
    alertAudio.volume = Number(document.querySelector('#volumeSlider').value) / 100;
    try {
      await alertAudio.play();
      spoken = true;
    } catch {
      if (!spoken && requestNumber === alertRequestNumber) {
        spoken = true;
        localVoiceFallback(text, severity);
      }
    }
  } catch {
    if (!spoken && requestNumber === alertRequestNumber) {
      clearTimeout(fallbackTimer);
      spoken = true;
      localVoiceFallback(text, severity);
    }
  }
}

function renderAlerts() {
  alertList.replaceChildren();
  if (!demoAlerts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-alert';
    empty.innerHTML = '<span>✓</span><div><b>No active demo alerts</b><small>Simulate a vehicle signal below to preview spoken alerts.</small></div>';
    alertList.append(empty);
    return;
  }
  demoAlerts.slice(0, 5).forEach((alert) => {
    const item = document.createElement('div');
    item.className = `alert-item ${alert.severity}`;
    const mark = document.createElement('span');
    mark.className = 'alert-mark';
    mark.textContent = alert.severity === 'critical' ? '!' : alert.severity === 'warning' ? '⚠' : 'i';
    const body = document.createElement('span');
    body.className = 'alert-content';
    const title = document.createElement('b');
    const description = document.createElement('small');
    title.textContent = alert.title;
    description.textContent = alert.message;
    body.append(title, description);
    const time = document.createElement('span');
    time.className = 'alert-time';
    time.textContent = alert.time;
    item.append(mark, body, time);
    alertList.append(item);
  });
}

function triggerAlert(title, message, severity = 'warning') {
  const timestamp = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  demoAlerts.unshift({ title, message, severity, time: timestamp });
  demoAlerts = demoAlerts.slice(0, 8);
  renderAlerts();
  showToast(title, message, severity);
  speakAlert(message, severity);
}

function updateSpeed(speed) {
  const previous = simulatedSpeed;
  simulatedSpeed = Number(speed);
  speedValue.textContent = String(simulatedSpeed);
  const moving = simulatedSpeed > 0;
  videoApp.classList.toggle('locked', moving);
  videoApp.disabled = moving;
  videoAppState.textContent = moving ? 'LOCKED WHILE MOVING' : 'PARKED ONLY';
  videoNotice.textContent = moving
    ? 'Vehicle moving in demo: video is locked. Audio apps and voice controls stay available.'
    : 'Video content is parked-only. Connect an approved app to play actual media.';
  if (!speedAlertActive && previous < 90 && simulatedSpeed >= 90) {
    speedAlertActive = true;
    triggerAlert('Speed threshold reached · demo', 'Demo speed alert. Speed crossed the configured 90 kilometer-per-hour threshold. Keep attention on the road.', 'warning');
  } else if (simulatedSpeed < 80) {
    speedAlertActive = false;
  }
}

function setTirePressure(position, pressure) {
  simulatedTirePressure[position] = pressure;
  document.querySelector(`#pressure-${position}`).textContent = String(pressure);
  const wheel = document.querySelector(`[data-wheel="${position}"]`);
  wheel.classList.toggle('low', pressure < 29);
  const lowPosition = Object.entries(simulatedTirePressure).find(([, value]) => value < 29)?.[0];
  if (lowPosition) {
    tirePanel.classList.add('has-tire-alert');
    tireAlert.hidden = false;
    const tireNames = { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' };
    document.querySelector('#tireAlertText').textContent = `${tireNames[lowPosition]} is ${simulatedTirePressure[lowPosition]} PSI in the demo. Check your vehicle placard and tire when safely parked.`;
    document.querySelector('.tire-normal').innerHTML = '<i></i> LOW PRESSURE SIMULATED';
  } else {
    tirePanel.classList.remove('has-tire-alert');
    tireAlert.hidden = true;
    document.querySelector('.tire-normal').innerHTML = '<i></i> DEMO VALUES NORMAL';
  }
}

function chooseRecordingType() {
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function formatDuration(milliseconds) {
  const seconds = Math.min(59, Math.floor(milliseconds / 1000));
  return `00:${String(seconds).padStart(2, '0')}`;
}

function stopMicTracks() {
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = null;
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
  audioContext = null;
}

function finishRecording({ discard = false, reason = 'manual' } = {}) {
  if (!recorder || recorder.state === 'inactive') return;
  pendingDiscard = discard;
  clearTimeout(noSpeechTimer);
  clearTimeout(maxDurationTimer);
  cancelAnimationFrame(meterFrame);
  assistantPanel.classList.remove('recording');
  assistantPanel.classList.toggle('processing', !discard);
  micButton.setAttribute('aria-label', 'Start voice assistant');
  micLabel.textContent = discard ? 'TAP TO TRY AGAIN' : 'PROCESSING VOICE';
  if (discard) {
    vadLabel.textContent = 'NO VOICE DETECTED';
    updateStatus('I didn’t hear speech', 'Move closer to the microphone and try once more.', 'error');
  } else {
    vadLabel.textContent = reason === 'silence' ? 'SPEECH CAPTURED · SENDING' : 'SENDING FOR RECOGNITION';
    updateStatus('Processing your voice…', 'Recognizing speech, checking the language, and understanding the request.', 'processing');
  }
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  if (recorder.state !== 'inactive') recorder.stop();
  stopMicTracks();
}

async function startVoiceDetection(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    inputQuality.textContent = 'VOICE METER UNAVAILABLE';
    return false;
  }
  try {
    audioContext = new AudioContextClass();
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.25;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

  const inspectAudio = () => {
    if (!recorder || recorder.state !== 'recording') return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = performance.now();
    const elapsed = now - recordingStartedAt;

    if (elapsed < 400 && rms < 0.04) {
      noiseFloor += rms;
      noiseSamples += 1;
    }
    const measuredNoise = noiseSamples ? noiseFloor / noiseSamples : 0;
    const threshold = Math.max(0.014, Math.min(0.05, measuredNoise * 2.4 + 0.007));
    const level = Math.max(0, Math.min(1, (rms - threshold) / 0.16));
    waveformBars.forEach((bar, index) => {
      const shape = 0.38 + 0.62 * Math.abs(Math.sin((index + elapsed / 80) * 0.48));
      const height = Math.round(3 + level * shape * 28);
      bar.style.setProperty('--bar-height', `${height}px`);
    });

    if (elapsed < 650) {
      inputQuality.textContent = 'CALIBRATING ROOM NOISE';
    } else if (level > 0.15) {
      inputQuality.textContent = level > 0.55 ? 'SIGNAL STRONG' : 'SIGNAL CLEAR';
    } else {
      inputQuality.textContent = 'MIC LISTENING';
    }

    if (rms > threshold) {
      loudFrames += 1;
      if (loudFrames >= 2) {
        if (!speechStartedAt) {
          speechStartedAt = now;
          vadLabel.textContent = 'VOICE ACTIVITY DETECTED';
          updateStatus('Listening to your voice…', 'Speech detected. Pause naturally when you finish.');
        }
        lastVoiceAt = now;
      }
    } else {
      loudFrames = Math.max(0, loudFrames - 1);
      if (speechStartedAt && now - lastVoiceAt > SILENCE_TIMEOUT_MS) {
        finishRecording({ reason: 'silence' });
        return;
      }
    }
    meterFrame = requestAnimationFrame(inspectAudio);
  };
    meterFrame = requestAnimationFrame(inspectAudio);
    return true;
  } catch {
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
    audioContext = null;
    inputQuality.textContent = 'VOICE METER UNAVAILABLE';
    return false;
  }
}

async function beginRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    updateStatus('Microphone unavailable', 'Open this app on localhost or HTTPS in a current browser.', 'error');
    return;
  }
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 16_000 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    });
    audioChunks = [];
    speechStartedAt = 0;
    lastVoiceAt = 0;
    noiseFloor = 0;
    noiseSamples = 0;
    loudFrames = 0;
    pendingDiscard = false;
    const mimeType = chooseRecordingType();
    recorder = new MediaRecorder(microphoneStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 96_000,
    });
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) audioChunks.push(event.data);
    });
    recorder.addEventListener('stop', sendRecording, { once: true });
    recorder.addEventListener('error', () => {
      stopMicTracks();
      assistantPanel.classList.remove('recording');
      updateStatus('Microphone recording failed', 'Check your browser microphone permissions, then try again.', 'error');
      micButton.disabled = false;
    }, { once: true });
    recordingStartedAt = performance.now();
    recorder.start(200);
    assistantPanel.classList.add('recording');
    assistantPanel.classList.remove('error');
    micButton.setAttribute('aria-label', 'Stop listening and send your voice request');
    micLabel.textContent = 'TAP TO SEND';
    vadLabel.textContent = 'WAITING FOR SPEECH';
    updateStatus('Calibrating microphone…', 'Automatic noise filtering and silence detection are active.');
    const voiceMeterReady = await startVoiceDetection(microphoneStream);
    if (voiceMeterReady) {
      noSpeechTimer = setTimeout(() => {
        if (!speechStartedAt) finishRecording({ discard: true, reason: 'no-speech' });
      }, NO_SPEECH_TIMEOUT_MS);
    } else {
      updateStatus('Listening… tap when you’re done', 'Live voice detection is unavailable; recording will stop at the 20-second limit.');
    }
    clockTimer = setInterval(() => {
      const elapsed = performance.now() - recordingStartedAt;
      recordingTime.textContent = formatDuration(elapsed);
    }, 150);
    maxDurationTimer = setTimeout(() => {
      if (recorder?.state === 'recording') finishRecording({ reason: 'limit' });
    }, MAX_RECORDING_MS);
  } catch (error) {
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    updateStatus(denied ? 'Microphone permission needed' : 'Could not open microphone', denied
      ? 'Allow microphone access in your browser and tap to try again.'
      : 'Check that a microphone is connected and not being used by another app.', 'error');
  }
}

async function sendRecording() {
  micButton.disabled = true;
  if (pendingDiscard) {
    micButton.disabled = false;
    return;
  }
  const type = recorder?.mimeType || 'audio/webm';
  const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'mp4' : type.includes('wav') ? 'wav' : 'webm';
  const recording = new Blob(audioChunks, { type });
  recordingTime.textContent = formatDuration(performance.now() - recordingStartedAt);
  if (!recording.size) {
    updateStatus('No audio captured', 'Tap the microphone and try again.', 'error');
    micButton.disabled = false;
    return;
  }

  const form = new FormData();
  form.append('audio', recording, `saarthi-voice.${extension}`);
  form.append('history', JSON.stringify(conversationHistory.slice(-8)));
  form.append('speed', String(simulatedSpeed));
  try {
    const response = await fetch('/api/voice', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Voice request failed.');

    transcriptText.textContent = result.transcript;
    answerText.textContent = result.answer;
    detectedLanguage.textContent = `${result.detectedLanguage || 'Language detected'}${Number.isFinite(result.languageConfidence) ? ` · ${Math.round(result.languageConfidence * 100)}%` : ''}`;
    replyLanguage.textContent = `SPOKEN ${result.spokenLanguage || 'en-IN'}`;
    if (Number.isFinite(result.languageConfidence)) {
      const percent = Math.max(0, Math.min(100, Math.round(result.languageConfidence * 100)));
      confidenceValue.textContent = `${percent}%`;
      confidenceBar.style.width = `${percent}%`;
    } else {
      confidenceValue.textContent = 'DETECTED';
      confidenceBar.style.width = '72%';
    }
    conversation.hidden = false;
    conversationHistory.push({ role: 'user', content: result.transcript }, { role: 'assistant', content: result.answer });
    conversationHistory = conversationHistory.slice(-8);
    if (result.audio) {
      answerAudio.src = result.audio;
      answerAudio.hidden = false;
      await answerAudio.play().catch(() => {});
      updateStatus('Reply ready', `Recognized ${result.detectedLanguage || 'your language'} · spoken in ${result.spokenLanguage || 'English'}.`);
      vadLabel.textContent = 'VOICE RESPONSE READY';
    } else {
      answerAudio.hidden = true;
      updateStatus('Text reply ready', 'Speech generation did not return audio. You can try again.');
    }
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'Sarvam took too long to respond. Try a shorter voice request.'
      : error.message || 'Check your connection and try again.';
    updateStatus('Voice request did not complete', message, 'error');
    vadLabel.textContent = 'REQUEST FAILED · RETRY';
  } finally {
    micLabel.textContent = 'TAP TO SPEAK';
    micButton.setAttribute('aria-label', 'Start voice assistant');
    micButton.disabled = false;
  }
}

micButton.addEventListener('click', () => {
  if (recorder?.state === 'recording') finishRecording({ reason: 'manual' });
  else beginRecording();
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#assistantPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateStatus(`Try saying: “${button.dataset.prompt}”`, 'Tap the microphone to ask aloud. This example will not call any vehicle controls.');
  });
});

document.querySelector('#navVoice').addEventListener('click', () => {
  document.querySelector('#assistantPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  micButton.focus({ preventScroll: true });
});

speedSlider.addEventListener('input', (event) => updateSpeed(event.target.value));

document.querySelector('#lowTireButton').addEventListener('click', () => {
  setTirePressure('FL', 24);
  triggerAlert('Tyre pressure low · demo', 'Demo low-pressure signal on the front left tyre. Avoid abrupt braking or cornering and stop safely to check the pressure against the vehicle placard.', 'warning');
});

document.querySelector('#fatigueButton').addEventListener('click', () => {
  triggerAlert('Driver fatigue alert · demo', 'Drowsiness signal simulated. If you feel sleepy, pull over somewhere safe and rest. Do not rely on this assistant to keep you awake.', 'critical');
});

document.querySelector('#impactButton').addEventListener('click', () => {
  triggerAlert('Possible impact signal · demo', 'Impact signal simulated. Check occupants when safe and use the vehicle SOS service if help is needed. Saarthi cannot contact emergency services.', 'critical');
});

document.querySelector('#systemFaultButton').addEventListener('click', () => {
  triggerAlert('Sensor unavailable · demo', 'A simulated tyre sensor fault means pressure readings may be unreliable. Check the vehicle display and arrange an inspection when safe.', 'warning');
});

document.querySelector('#resetSignalsButton').addEventListener('click', () => {
  speedSlider.value = '0';
  updateSpeed(0);
  speedAlertActive = false;
  Object.entries({ FL: 34, FR: 34, RL: 33, RR: 33 }).forEach(([position, pressure]) => setTirePressure(position, pressure));
  demoAlerts = [];
  renderAlerts();
  alertRequestNumber += 1;
  if (alertAudio) alertAudio.pause();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  showToast('Demo signals reset', 'Simulated speed and tyre readings are back to normal.');
});

function setDestination(name) {
  const destination = name.trim().slice(0, 60);
  if (!destination) return;
  document.querySelector('#destinationInput').value = destination;
  document.querySelector('#mapDestinationLabel').textContent = destination.toUpperCase().slice(0, 20);
  document.querySelector('#routeSummary').textContent = 'SAMPLE ROUTE · GPS OFFLINE';
  speakAlert(`Demo route selected for ${destination}. This preview has no live GPS or turn-by-turn directions.`, 'info');
}

document.querySelector('#routeButton').addEventListener('click', () => setDestination(document.querySelector('#destinationInput').value));
document.querySelector('#destinationInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') setDestination(event.currentTarget.value);
});
document.querySelectorAll('[data-destination]').forEach((button) => {
  button.addEventListener('click', () => setDestination(button.dataset.destination));
});

document.querySelector('#mapsButton').addEventListener('click', () => {
  document.querySelector('#navigationPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelector('#destinationInput').focus({ preventScroll: true });
});

document.querySelector('#youtubeMusicButton').addEventListener('click', () => {
  showToast('YouTube Music preview', 'Audio-only app tile is ready; a real YouTube Music connection is not configured.');
});

videoApp.addEventListener('click', () => {
  if (simulatedSpeed > 0) return;
  showToast('Parked video preview', 'Video is limited to parked mode here. Connect an approved video app to provide playback.');
});

const mediaPlayer = document.querySelector('#mediaPlayer');
const musicButton = document.querySelector('#musicButton');
const playPauseButton = document.querySelector('#playPauseButton');
function toggleDemoPlayer() {
  const playing = mediaPlayer.classList.toggle('playing');
  playPauseButton.textContent = playing ? 'Ⅱ' : '▶';
  playPauseButton.setAttribute('aria-label', playing ? 'Pause player preview' : 'Play player preview');
  document.querySelector('#musicState').textContent = playing ? 'PLAYER UI PREVIEW' : 'PLAYER UI PREVIEW';
  if (demoPlayerTimer) clearInterval(demoPlayerTimer);
  if (playing) {
    demoPlayerTimer = setInterval(() => {
      demoPlayerProgress = demoPlayerProgress >= 95 ? 8 : demoPlayerProgress + 1;
      document.querySelector('#trackProgress').style.width = `${demoPlayerProgress}%`;
    }, 1100);
    showToast('Music player preview', 'This is a simulated player. A real music service is not connected.');
  }
}
musicButton.addEventListener('click', toggleDemoPlayer);
playPauseButton.addEventListener('click', toggleDemoPlayer);

document.querySelector('#volumeSlider').addEventListener('input', (event) => {
  const volume = Number(event.target.value);
  document.querySelector('#volumeValue').textContent = String(volume);
  answerAudio.volume = volume / 100;
  if (alertAudio) alertAudio.volume = volume / 100;
});
document.querySelector('#balanceSlider').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  document.querySelector('#balanceValue').textContent = value === 0 ? 'CENTER' : value < 0 ? `LEFT ${Math.abs(value)}` : `RIGHT ${value}`;
});

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const targetId = item.id === 'navVoice' ? 'assistantPanel'
      : item.getAttribute('aria-label') === 'Cockpit overview' ? 'assistantPanel'
        : item.getAttribute('aria-label') === 'Vehicle systems' ? 'tirePanel'
          : item.getAttribute('aria-label') === 'Settings' ? 'systemPanel' : 'assistantPanel';
    document.querySelector(`#${targetId}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.toggle('active', navItem === item));
  });
});

renderAlerts();
updateSpeed(0);
answerAudio.volume = Number(document.querySelector('#volumeSlider').value) / 100;

function updateClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}
updateClock();
setInterval(updateClock, 30_000);

fetch('/api/health')
  .then((response) => response.json())
  .then((status) => {
    if (!status.ready) updateStatus('Add your Sarvam API key', 'Set SARVAM_API_KEY in the local .env file.', 'error');
  })
  .catch(() => updateStatus('Start the local server', 'Run npm start to open the voice assistant.', 'error'));
