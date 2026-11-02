const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const micButton = $('#micButton');
const micLabel = $('#micLabel');
const voiceState = $('#voiceState');
const voiceHint = $('#voiceHint');
const recordingTime = $('#recordingTime');
const waveform = $('#waveform');
const conversation = $('#conversation');
const transcriptText = $('#transcriptText');
const answerText = $('#answerText');
const detectedLanguage = $('#detectedLanguage');
const replyLanguage = $('#replyLanguage');
const confidenceValue = $('#confidenceValue');
const confidenceBar = $('#confidenceBar');
const answerAudio = $('#answerAudio');
const speedSlider = $('#speedSlider');
const videoButton = $('#youtubeVideoButton');
const assistantLanguage = $('#assistantLanguage');
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
let catalog = null;
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
  $('#voiceCard').classList.toggle('processing', mode === 'processing');
  $('#voiceCard').classList.toggle('error', mode === 'error');
}

function showToast(title, message, severity = 'info') {
  let toast = $('.alert-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'alert-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.className = `alert-toast ${severity}`;
  toast.replaceChildren();
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
  utterance.volume = Number($('#volumeSlider').value) / 100;
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
    alertAudio.volume = Number($('#volumeSlider').value) / 100;
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

function alertNode(alert) {
  const item = document.createElement('article');
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
  const time = document.createElement('time');
  time.className = 'alert-time';
  time.textContent = alert.time;
  item.append(mark, body, time);
  return item;
}

function renderAlerts() {
  const recent = $('#recentAlerts');
  const feed = $('#alertFeed');
  recent.replaceChildren();
  feed.replaceChildren();
  $('#alertCount').textContent = String(demoAlerts.length);
  if (!demoAlerts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-alert';
    empty.textContent = 'No simulated alerts yet. Choose one in Alert simulator.';
    recent.append(empty.cloneNode(true));
    feed.append(empty);
    return;
  }
  demoAlerts.slice(0, 4).forEach((alert) => recent.append(alertNode(alert)));
  demoAlerts.forEach((alert) => feed.append(alertNode(alert)));
}

function triggerAlert(title, message, severity = 'warning', shouldSpeak = true) {
  const timestamp = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  demoAlerts.unshift({ title, message, severity, time: timestamp });
  demoAlerts = demoAlerts.slice(0, 20);
  renderAlerts();
  showToast(title, message, severity);
  if (shouldSpeak) speakAlert(message, severity);
}

function updateSpeed(speed) {
  const previous = simulatedSpeed;
  simulatedSpeed = Number(speed);
  $('#speedValue').textContent = String(simulatedSpeed);
  $('#speedReadout').textContent = String(simulatedSpeed);
  $('.gear-badge').textContent = simulatedSpeed > 0 ? 'D' : 'P';
  $('#driveHeading').dataset.status = simulatedSpeed > 0 ? 'moving' : 'parked';
  $('.eyebrow i').title = simulatedSpeed > 0 ? 'Simulated movement' : 'Simulated parked state';
  $('.speed-arc').style.setProperty('--speed-progress', `${Math.min(100, simulatedSpeed / 120 * 100)}%`);
  const moving = simulatedSpeed > 0;
  videoButton.classList.toggle('locked', moving);
  videoButton.disabled = moving;
  $('#videoAppState').textContent = moving ? 'Locked while simulated speed is above 0' : 'Parked-only placeholder';
  $('#videoLock').textContent = moving ? 'LOCKED' : 'PARKED ONLY';
  $('#videoShortcut').disabled = moving;
  $('#videoShortcut').classList.toggle('locked', moving);
  if (!speedAlertActive && previous < 90 && simulatedSpeed >= 90) {
    speedAlertActive = true;
    triggerAlert('Speed threshold reached · demo', 'Demo speed alert. The simulated speed crossed the configured 90 kilometer-per-hour threshold. Keep attention on the road.', 'warning');
  } else if (simulatedSpeed < 80) {
    speedAlertActive = false;
  }
}

function renderCatalog() {
  const filter = $('#categoryFilter');
  const selector = $('#alertSignalSelect');
  filter.replaceChildren(new Option('All groups', 'all'));
  selector.replaceChildren(new Option('Choose an alertable signal…', ''));
  let total = 0;
  for (const category of catalog.categories) {
    total += category.signals.length;
    filter.add(new Option(category.name, category.id));
    const group = document.createElement('optgroup');
    group.label = category.name;
    category.signals.filter((signal) => signal.alertRule.alertable).forEach((signal) => {
      group.append(new Option(`${signal.name} · ${signal.alertRule.severity}`, String(signal.id)));
    });
    if (group.children.length) selector.append(group);
  }
  $('#catalogCount').textContent = String(total);
  $('#categoryCount').textContent = String(catalog.categories.length);
  renderSensors();
  renderSources();
  renderSelectedRule();
}

function renderSensors() {
  const container = $('#sensorList');
  const search = $('#sensorSearch').value.trim().toLowerCase();
  const groupId = $('#categoryFilter').value;
  container.replaceChildren();
  let shown = 0;
  for (const category of catalog.categories) {
    if (groupId !== 'all' && groupId !== category.id) continue;
    const signals = category.signals.filter((signal) => !search || `${signal.name} ${signal.source} ${signal.alertRule.trigger}`.toLowerCase().includes(search));
    if (!signals.length) continue;
    shown += signals.length;
    const section = document.createElement('details');
    section.className = 'sensor-group';
    section.open = Boolean(search || groupId !== 'all');
    const summary = document.createElement('summary');
    const title = document.createElement('b');
    const count = document.createElement('span');
    const source = document.createElement('small');
    title.textContent = category.name;
    count.textContent = `${signals.length} signals`;
    source.textContent = category.source;
    summary.append(title, count, source);
    section.append(summary);
    const grid = document.createElement('div');
    grid.className = 'sensor-grid';
    signals.forEach((signal) => {
      const card = document.createElement('article');
      card.className = 'sensor-row';
      const top = document.createElement('div');
      top.className = 'sensor-top';
      const name = document.createElement('b');
      const value = document.createElement('strong');
      name.textContent = signal.name;
      value.textContent = `${signal.sample.value} ${signal.sample.unit}`;
      top.append(name, value);
      const tag = document.createElement('span');
      tag.className = `sensor-rule ${signal.alertRule.alertable ? signal.alertRule.severity : 'info'}`;
      tag.textContent = signal.alertRule.alertable ? `${signal.alertRule.severity} rule available` : 'No standalone alert';
      const explanation = document.createElement('p');
      explanation.textContent = signal.alertRule.trigger;
      const meta = document.createElement('small');
      meta.textContent = `${signal.source} · ${signal.availability}`;
      card.append(top, tag, explanation, meta);
      grid.append(card);
    });
    section.append(grid);
    container.append(section);
  }
  $('#resultCount').textContent = `${shown} of ${catalog.count} signals`;
  if (!shown) {
    const empty = document.createElement('p');
    empty.className = 'empty-alert';
    empty.textContent = 'No vehicle data matches that search.';
    container.append(empty);
  }
}

function renderSources() {
  const list = $('#sourceList');
  list.replaceChildren();
  catalog.collectionMethods.forEach((method) => {
    const item = document.createElement('article');
    const name = document.createElement('b');
    const provides = document.createElement('p');
    const caveat = document.createElement('small');
    name.textContent = method.name;
    provides.textContent = method.provides;
    caveat.textContent = method.caveat;
    item.append(name, provides, caveat);
    list.append(item);
  });
}

function getSelectedSignal() {
  const selectedId = Number($('#alertSignalSelect').value);
  return catalog?.categories.flatMap((category) => category.signals).find((signal) => signal.id === selectedId);
}

function renderSelectedRule() {
  const box = $('#selectedRule');
  box.replaceChildren();
  if (!catalog) return;
  const signal = getSelectedSignal();
  if (!signal) {
    box.textContent = 'Select a signal to view its sample alert rule.';
    return;
  }
  const severity = document.createElement('b');
  severity.textContent = `${signal.alertRule.severity.toUpperCase()} · ${signal.name}`;
  const rule = document.createElement('p');
  rule.textContent = signal.alertRule.trigger;
  const sample = document.createElement('small');
  sample.textContent = `Sample reading: ${signal.sample.value} ${signal.sample.unit}. Simulation only.`;
  box.append(severity, rule, sample);
}

function simulateSelectedSignal() {
  const signal = getSelectedSignal();
  if (!signal) {
    showToast('Choose a signal', 'Select a vehicle data signal before simulating an alert.');
    return;
  }
  const severity = signal.alertRule.severity;
  let message;
  if (/collision|impact|airbag|rollover|crash/i.test(signal.name)) {
    message = `Demo impact signal for ${signal.name}. This app cannot confirm a crash or call emergency services. Use the vehicle’s own SOS service if help is needed.`;
  } else if (/drows|fatigue|eye movement|distraction/i.test(signal.name)) {
    message = `Demo driver attention alert for ${signal.name}. If sleepy, stop somewhere safe and rest. Do not rely on this app to keep you awake.`;
  } else {
    message = `Demo ${signal.name} alert. ${severity === 'critical' ? 'Follow the vehicle’s own warning and get to safety.' : 'Check the vehicle manual and its own warning threshold when safely parked.'}`;
  }
  triggerAlert(`${signal.name} · simulated`, message, severity);
}

function applyPreset(name) {
  const presets = {
    tyre: ['Low tyre pressure · demo', 'Demo low-pressure signal on the front-left tyre. Stop safely and check pressure against the vehicle placard; readings here are simulated.', 'warning'],
    fatigue: ['Driver fatigue alert · demo', 'Drowsiness signal simulated. If you feel sleepy, pull over somewhere safe and rest. Do not rely on this assistant to keep you awake.', 'critical'],
    impact: ['Possible impact signal · demo', 'Impact signal simulated. Check occupants when safe and use the vehicle SOS service if help is needed. Saarthi cannot contact emergency services.', 'critical'],
    sensor: ['Sensor unavailable · demo', 'A simulated tyre-sensor fault means pressure readings may be unreliable. Check the vehicle display and arrange an inspection when safe.', 'warning'],
  };
  const preset = presets[name];
  if (preset) triggerAlert(...preset);
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
  $('#voiceCard').classList.remove('recording');
  $('#voiceCard').classList.toggle('processing', !discard);
  micButton.setAttribute('aria-label', 'Start voice assistant');
  micLabel.textContent = discard ? 'TAP TO TRY AGAIN' : 'PROCESSING VOICE';
  if (discard) {
    updateStatus('I didn’t hear speech', 'Move closer to the microphone and try once more.', 'error');
  } else {
    updateStatus('Processing your voice…', reason === 'silence'
      ? 'Speech captured. Recognizing words and language, then preparing a spoken reply.'
      : 'Recognizing speech, checking the language, and understanding the request.', 'processing');
  }
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  if (recorder.state !== 'inactive') recorder.stop();
  stopMicTracks();
}

async function startVoiceDetection(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
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
      if (elapsed < 500 && rms < 0.04) {
        noiseFloor += rms;
        noiseSamples += 1;
      }
      const measuredNoise = noiseSamples ? noiseFloor / noiseSamples : 0;
      const threshold = Math.max(0.014, Math.min(0.05, measuredNoise * 2.4 + 0.007));
      const level = Math.max(0, Math.min(1, (rms - threshold) / 0.16));
      waveformBars.forEach((bar, index) => {
        const shape = 0.38 + 0.62 * Math.abs(Math.sin((index + elapsed / 80) * 0.48));
        bar.style.setProperty('--bar-height', `${Math.round(3 + level * shape * 28)}px`);
      });
      if (elapsed < 650) voiceHint.textContent = 'Calibrating cabin noise and microphone level…';
      else if (speechStartedAt) voiceHint.textContent = 'Voice detected. Pause naturally to send; background noise is filtered.';
      else voiceHint.textContent = 'Listening for your voice. Pause naturally when you finish.';
      if (rms > threshold) {
        loudFrames += 1;
        if (loudFrames >= 2) {
          if (!speechStartedAt) {
            speechStartedAt = now;
            updateStatus('Listening to your voice…', 'Voice detected. Pause naturally when you finish.');
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
    return false;
  }
}

async function beginRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    updateStatus('Microphone unavailable', 'Open this app on localhost or HTTPS in a current browser.', 'error');
    return;
  }
  micButton.disabled = true;
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
      $('#voiceCard').classList.remove('recording');
      updateStatus('Microphone recording failed', 'Check microphone permissions, then try again.', 'error');
      micButton.disabled = false;
    }, { once: true });
    recordingStartedAt = performance.now();
    recorder.start(200);
    $('#voiceCard').classList.add('recording');
    $('#voiceCard').classList.remove('error');
    micButton.setAttribute('aria-label', 'Stop listening and send your voice request');
    micLabel.textContent = 'TAP TO SEND';
    updateStatus('Calibrating microphone…', 'Automatic gain, noise filtering, and silence detection are active.');
    const voiceMeterReady = await startVoiceDetection(microphoneStream);
    if (voiceMeterReady) {
      noSpeechTimer = setTimeout(() => {
        if (!speechStartedAt) finishRecording({ discard: true, reason: 'no-speech' });
      }, NO_SPEECH_TIMEOUT_MS);
    } else {
      updateStatus('Listening… tap when done', 'Live voice activity detection is unavailable; the recording stops at 20 seconds.');
    }
    clockTimer = setInterval(() => {
      recordingTime.textContent = formatDuration(performance.now() - recordingStartedAt);
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
  } finally {
    micButton.disabled = false;
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
  form.append('preferredLanguage', assistantLanguage.value);
  try {
    const response = await fetch('/api/voice', { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Voice request failed.');
    transcriptText.textContent = result.transcript;
    answerText.textContent = result.answer;
    detectedLanguage.textContent = `${result.detectedLanguage || 'Language detected'}${Number.isFinite(result.languageConfidence) ? ` · ${Math.round(result.languageConfidence * 100)}%` : ''}`;
    replyLanguage.textContent = `SPOKEN ${result.spokenLanguage || 'en-IN'}`;
    if (Number.isFinite(result.languageConfidence)) {
      const percent = Math.max(0, Math.min(100, Math.round(result.languageConfidence * 100)));
      confidenceValue.textContent = `LANGUAGE CONFIDENCE · ${percent}%`;
      confidenceBar.style.width = `${percent}%`;
    } else {
      confidenceValue.textContent = 'LANGUAGE CONFIDENCE · NOT PROVIDED';
      confidenceBar.style.width = '0%';
    }
    conversation.hidden = false;
    conversationHistory.push({ role: 'user', content: result.transcript }, { role: 'assistant', content: result.answer });
    conversationHistory = conversationHistory.slice(-8);
    if (result.audio) {
      answerAudio.src = result.audio;
      answerAudio.hidden = false;
      answerAudio.volume = Number($('#volumeSlider').value) / 100;
      await answerAudio.play().catch(() => {});
      updateStatus('Reply ready', `Recognized ${result.detectedLanguage || 'your language'} · spoken in ${result.spokenLanguage || 'English'}.`);
    } else {
      answerAudio.hidden = true;
      updateStatus('Text reply ready', 'Speech generation did not return audio. You can try again.');
    }
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'Sarvam took too long to respond. Try a shorter voice request.'
      : error.message || 'Check your connection and try again.';
    updateStatus('Voice request did not complete', message, 'error');
  } finally {
    micLabel.textContent = 'TAP TO SPEAK';
    micButton.setAttribute('aria-label', 'Start voice assistant');
    micButton.disabled = false;
    recordingTime.textContent = '00:00';
  }
}

function setDestination(value) {
  const destination = value.trim().slice(0, 60);
  if (!destination) return;
  $('#destinationInput').value = destination;
  $('#mapDestinationInput').value = destination;
  $('#mapLabel').textContent = destination.toUpperCase().slice(0, 20);
  $('#mapLabelLarge').textContent = destination.toUpperCase().slice(0, 24);
  $('#routeSummary').textContent = `SAMPLE ROUTE · GPS OFFLINE · ${destination}`;
  $('#mapRouteSummary').textContent = `SAMPLE ROUTE · ${destination} · no live directions`;
}

function openScreen(name) {
  $$('.screen').forEach((screen) => {
    const active = screen.id === `screen-${name}`;
    screen.hidden = !active;
    screen.classList.toggle('active', active);
  });
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.screen === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

micButton.addEventListener('click', () => {
  if (recorder?.state === 'recording') finishRecording({ reason: 'manual' });
  else beginRecording();
});
speedSlider.addEventListener('input', (event) => updateSpeed(event.target.value));
$('#sensorSearch').addEventListener('input', renderSensors);
$('#categoryFilter').addEventListener('change', renderSensors);
$('#alertSignalSelect').addEventListener('change', renderSelectedRule);
$('#simulateAlertButton').addEventListener('click', simulateSelectedSignal);
$('#clearAlertsButton').addEventListener('click', () => {
  demoAlerts = [];
  renderAlerts();
  alertRequestNumber += 1;
  if (alertAudio) alertAudio.pause();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
});
$$('[data-alert-preset]').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.alertPreset)));
$$('[data-screen]').forEach((button) => button.addEventListener('click', () => openScreen(button.dataset.screen)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => openScreen(button.dataset.go)));
$$('[data-destination]').forEach((button) => button.addEventListener('click', () => setDestination(button.dataset.destination)));
$('#routeButton').addEventListener('click', () => setDestination($('#destinationInput').value));
$('#destinationInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') setDestination(event.currentTarget.value); });
$('#mapRouteButton').addEventListener('click', () => setDestination($('#mapDestinationInput').value));
$('#mapDestinationInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') setDestination(event.currentTarget.value); });
$('#mapsButton').addEventListener('click', () => openScreen('maps'));
$('#youtubeMusicButton').addEventListener('click', () => showToast('YouTube Music preview', 'Audio-only app tile preview. A real account and media service are not connected.'));
$('#videoShortcut').addEventListener('click', () => {
  if (simulatedSpeed > 0) return;
  showToast('Parked video preview', 'Video is limited to parked mode in this prototype. No video service is connected.');
});
$('#youtubeVideoButton').addEventListener('click', () => {
  if (simulatedSpeed === 0) showToast('Parked video preview', 'No video service is connected. Use an approved in-car app integration.');
});

function toggleDemoPlayer() {
  const player = $('#mediaPlayer');
  const playing = player.classList.toggle('playing');
  $('#playPauseButton').textContent = playing ? 'Ⅱ' : '▶';
  $('#musicState').textContent = playing ? 'PREVIEW PLAYING' : 'PAUSED';
  if (demoPlayerTimer) clearInterval(demoPlayerTimer);
  if (playing) {
    demoPlayerTimer = setInterval(() => {
      demoPlayerProgress = demoPlayerProgress >= 95 ? 8 : demoPlayerProgress + 1;
      $('#trackProgress').style.width = `${demoPlayerProgress}%`;
    }, 1100);
    showToast('Player preview', 'This is a simulated player interface. It does not play audio.');
  }
}
$('#musicButton').addEventListener('click', toggleDemoPlayer);
$('#playPauseButton').addEventListener('click', toggleDemoPlayer);
$('#volumeSlider').addEventListener('input', (event) => {
  const volume = Number(event.target.value);
  $('#volumeValue').textContent = String(volume);
  answerAudio.volume = volume / 100;
  if (alertAudio) alertAudio.volume = volume / 100;
});

function updateClock() {
  $('#clock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

renderAlerts();
updateSpeed(0);
answerAudio.volume = Number($('#volumeSlider').value) / 100;
updateClock();
setInterval(updateClock, 30_000);

fetch('/data/sensor-catalog.json')
  .then((response) => {
    if (!response.ok) throw new Error('Sample catalogue could not be loaded.');
    return response.json();
  })
  .then((data) => {
    catalog = data;
    renderCatalog();
  })
  .catch(() => {
    $('#sensorList').textContent = 'Sample data is unavailable. Restart the server and reload this page.';
    $('#resultCount').textContent = 'Catalogue unavailable';
  });

fetch('/api/health')
  .then((response) => response.json())
  .then((status) => {
    if (!status.ready) updateStatus('Add your Sarvam API key', 'Set SARVAM_API_KEY in your local .env file.', 'error');
  })
  .catch(() => updateStatus('Start the local server', 'Run npm start to open the voice assistant.', 'error'));
