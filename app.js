/* VoicePad — голосовой блокнот
   Распознавание речи: Whisper (ONNX) прямо в браузере, локально, без сервера */
'use strict';

const TARGET_RATE = 16000;        // Whisper принимает 16 кГц
const CHUNK_SEC = 8;              // длина аудио-чанка для распознавания
const CHUNK_SAMPLES = TARGET_RATE * CHUNK_SEC;

/* ---------- Состояние ---------- */

let notes = [];
let activeId = null;
let lang = localStorage.getItem('voicepad.lang') || 'ru';
let sortMode = localStorage.getItem('voicepad.sort') || 'date_desc';
let modelChoice = localStorage.getItem('voicepad.model') || 'base';

const $ = id => document.getElementById(id);
const els = {
  notes: $('notes'), search: $('search'), sort: $('sort'),
  title: $('title'), text: $('text'), stats: $('stats'),
  btnNew: $('btnNew'), btnExport: $('btnExport'), btnExportAll: $('btnExportAll'),
  btnDelete: $('btnDelete'), btnRecord: $('btnRecord'), recLabel: $('recLabel'),
  recTimer: $('recTimer'), recStatus: $('recStatus'),
  burger: $('burger'), sidebar: $('sidebar'), overlay: $('overlay'),
  splash: $('splash'), splashFill: $('splashFill'), splashStatus: $('splashStatus'),
  splashRetry: $('splashRetry'),
  modelSel: $('modelSel'), modelStatus: $('modelStatus'), btnReloadModel: $('btnReloadModel'),
};

function load() {
  try { notes = JSON.parse(localStorage.getItem('voicepad.notes')) || []; }
  catch { notes = []; }
  if (!Array.isArray(notes)) notes = [];
}

function save() {
  localStorage.setItem('voicepad.notes', JSON.stringify(notes));
}

function activeNote() { return notes.find(n => n.id === activeId) || null; }

function newNote() {
  const n = { id: Date.now(), title: '', text: '', updated: Date.now() };
  notes.unshift(n);
  activeId = n.id;
  save();
  renderAll();
  els.title.focus();
  return n;
}

function touch() {
  const n = activeNote();
  if (n) { n.updated = Date.now(); save(); }
}

/* ---------- Рендер ---------- */

function fmtDate(ts) {
  const d = new Date(ts);
  const p = x => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderList() {
  const q = els.search.value.trim().toLowerCase();
  let list = notes.filter(n =>
    !q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));

  if (sortMode === 'date_desc') list = [...list].sort((a, b) => b.updated - a.updated);
  if (sortMode === 'date_asc')  list = [...list].sort((a, b) => a.updated - b.updated);
  if (sortMode === 'title')     list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ru'));

  els.notes.innerHTML = '';
  if (!list.length) {
    els.notes.innerHTML = '<div class="notes-empty">Заметок нет. Нажмите «＋».</div>';
    return;
  }
  for (const n of list) {
    const div = document.createElement('div');
    div.className = 'note-item' + (n.id === activeId ? ' active' : '');
    const t = document.createElement('div');
    t.className = 'n-title';
    t.textContent = n.title || 'Без названия';
    const p = document.createElement('div');
    p.className = 'n-preview';
    p.textContent = n.text.replace(/\s+/g, ' ').trim() || '—';
    const d = document.createElement('div');
    d.className = 'n-date';
    d.textContent = fmtDate(n.updated);
    div.append(t, p, d);
    div.onclick = () => { activeId = n.id; renderAll(); closeSidebar(); };
    els.notes.appendChild(div);
  }
}

function renderEditor() {
  const n = activeNote();
  els.title.value = n ? n.title : '';
  els.text.value = n ? n.text : '';
  els.title.disabled = els.text.disabled = !n;
  updateStats();
}

function updateStats() {
  const n = activeNote();
  if (!n) { els.stats.textContent = ''; return; }
  const words = n.text.trim() ? n.text.trim().split(/\s+/).length : 0;
  els.stats.textContent = `${words} слов · ${n.text.length} символов`;
}

function renderAll() { renderList(); renderEditor(); }

/* ---------- Язык ---------- */

function renderLang() {
  document.querySelectorAll('.lang').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === lang));
}

document.querySelectorAll('.lang').forEach(b => b.onclick = () => {
  lang = b.dataset.lang;
  localStorage.setItem('voicepad.lang', lang);
  renderLang();
});

/* ---------- Автосохранение ---------- */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const n = activeNote();
    if (!n) return;
    n.title = els.title.value;
    n.text = els.text.value;
    touch();
    renderList();
    updateStats();
  }, 300);
}

els.title.addEventListener('input', scheduleSave);
els.text.addEventListener('input', scheduleSave);

/* ---------- Экспорт ---------- */

function download(name, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function safeName(s) {
  return (s || 'заметка').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || 'заметка';
}

els.btnExport.onclick = () => {
  const n = activeNote();
  if (n) download(safeName(n.title) + '.txt', n.text);
};

els.btnExportAll.onclick = () => {
  if (!notes.length) return;
  const parts = [...notes]
    .sort((a, b) => b.updated - a.updated)
    .map(n => `${'='.repeat(40)}\n${n.title || 'Без названия'}\n${fmtDate(n.updated)}\n${'='.repeat(40)}\n\n${n.text.trim()}\n`);
  download('voicepad-all.txt', parts.join('\n\n'));
};

els.btnDelete.onclick = () => {
  const n = activeNote();
  if (!n) return;
  if (!confirm(`Удалить заметку «${n.title || 'Без названия'}»?`)) return;
  notes = notes.filter(x => x.id !== n.id);
  activeId = notes.length ? notes[0].id : null;
  save();
  renderAll();
};

/* ---------- Whisper: воркер и модель ---------- */

let worker = null;
let whisperReady = false;
let whisperIniting = false;

function setModelStatus(text, cls) {
  els.modelStatus.textContent = text;
  els.modelStatus.className = cls || '';
}

function setSplash(pct, text) {
  els.splashFill.style.width = pct + '%';
  if (text) els.splashStatus.textContent = text;
}

function hideSplash() {
  els.splash.classList.add('done');
  setTimeout(() => { els.splash.style.display = 'none'; }, 600);
}

function initWhisper() {
  if (whisperIniting) return;
  whisperIniting = true;
  whisperReady = false;

  if (worker) worker.terminate();
  worker = new Worker('whisper-worker.js', { type: 'module' });

  setModelStatus('загружается…', 'warn');
  setSplash(5, 'Загрузка модели распознавания…');

  worker.onmessage = (e) => {
    const d = e.data || {};
    if (d.type === 'progress') {
      setSplash(5 + (d.progress || 0) * 90,
        `Загрузка модели: ${Math.round((d.progress || 0) * 100)}%`);
      return;
    }
    if (d.type === 'ready') {
      whisperReady = true;
      whisperIniting = false;
      if (d.fallback) {
        setModelStatus(`tiny · WASM (медленно)`, 'warn');
        setSplash(100, d.warning || 'Готово (режим совместимости)');
      } else {
        setModelStatus(`${d.model} · готово`, 'ok');
        setSplash(100, 'Готово!');
      }
      setTimeout(hideSplash, 400);
      return;
    }
    if (d.type === 'error') {
      whisperIniting = false;
      setModelStatus('ошибка загрузки', 'err');
      setSplash(0, 'Ошибка: ' + d.error);
      els.splashRetry.classList.remove('hidden');
      els.splash.style.display = 'flex';
      els.splash.classList.remove('done');
    }
  };

  worker.onerror = (err) => {
    whisperIniting = false;
    setModelStatus('ошибка', 'err');
    setSplash(0, 'Не удалось запустить распознавание: ' + (err.message || 'ошибка воркера'));
    els.splashRetry.classList.remove('hidden');
    els.splash.style.display = 'flex';
    els.splash.classList.remove('done');
  };

  worker.postMessage({ type: 'init', model: modelChoice });
}

els.splashRetry.onclick = () => {
  els.splashRetry.classList.add('hidden');
  initWhisper();
};

els.btnReloadModel.onclick = () => {
  if (recording) return;
  els.splash.style.display = 'flex';
  els.splash.classList.remove('done');
  els.splashRetry.classList.add('hidden');
  setSplash(0, 'Перезагрузка модели…');
  initWhisper();
};

els.modelSel.onchange = () => {
  modelChoice = els.modelSel.value;
  localStorage.setItem('voicepad.model', modelChoice);
  if (!recording) els.btnReloadModel.onclick();
};

function transcribe(audio, language) {
  return new Promise((resolve, reject) => {
    if (!whisperReady || !worker) { reject(new Error('Модель не готова')); return; }
    const requestId = 'stt-' + Date.now() + '-' + Math.random();
    const handler = (e) => {
      const d = e.data || {};
      if (d.requestId !== requestId) return;
      worker.removeEventListener('message', handler);
      if (d.type === 'result') resolve(d.text);
      else reject(new Error(d.error || 'Ошибка распознавания'));
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ type: 'transcribe', audio, language, requestId }, [audio.buffer]);
  });
}

/* ---------- Запись аудио ---------- */

let recording = false;
let mediaStream = null, audioCtx = null, processor = null;
let samples = [];                 // накопленные сэмплы (частота AudioContext)
let inRate = TARGET_RATE;
let sendChain = Promise.resolve();
let recStartTime = 0, timerInt = null;
let wakeLock = null;

function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0];
    const b = input[i0 + 1] !== undefined ? input[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function setStatus(t) { els.recStatus.textContent = t; }

function flushChunks() {
  while (samples.length >= CHUNK_SAMPLES) {
    const raw = samples.slice(0, CHUNK_SAMPLES);
    samples = samples.slice(CHUNK_SAMPLES);
    const pcm16 = resample(raw, inRate, TARGET_RATE);
    enqueueSend(pcm16);
  }
}

function enqueueSend(pcm16) {
  const copy = new Float32Array(pcm16); // передаём буфером в воркер
  sendChain = sendChain.then(() => sendChunk(copy)).catch(() => {});
}

async function sendChunk(pcm16) {
  setStatus('Распознаю…');
  try {
    const text = await transcribe(pcm16, lang);
    if (text) appendText(text);
  } catch (e) {
    if (whisperReady) setStatus('Ошибка: ' + e.message);
  }
  if (recording) setStatus('Слушаю…');
}

function appendText(t) {
  const n = activeNote();
  if (!n) return;
  const cur = els.text.value;
  els.text.value = cur ? cur.replace(/\s+$/, '') + ' ' + t : t;
  els.text.scrollTop = els.text.scrollHeight;
  scheduleSave();
}

function fmtTimer(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startTimer() {
  recStartTime = Date.now();
  timerInt = setInterval(() =>
    els.recTimer.textContent = fmtTimer(Math.floor((Date.now() - recStartTime) / 1000)), 500);
}

async function startRec() {
  if (!whisperReady) {
    setStatus('Модель ещё загружается — подождите…');
    return;
  }
  if (!activeNote()) newNote();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch {
    setStatus('Нет доступа к микрофону — разрешите его в настройках браузера.');
    return;
  }
  recording = true;
  samples = [];
  sendChain = Promise.resolve();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  inRate = audioCtx.sampleRate;
  const src = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = e => {
    samples.push(...e.inputBuffer.getChannelData(0));
    flushChunks();
  };
  src.connect(processor);
  processor.connect(audioCtx.destination);

  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}

  els.btnRecord.classList.add('recording');
  els.recLabel.textContent = 'Стоп';
  startTimer();
  setStatus('Слушаю…');
}

async function stopRec() {
  recording = false;
  if (processor) { processor.disconnect(); processor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  clearInterval(timerInt);
  els.recTimer.textContent = '';
  els.btnRecord.classList.remove('recording');
  els.recLabel.textContent = 'Диктовать';

  // добрать хвост (< CHUNK_SEC) и дождаться очереди
  const rest = samples; samples = [];
  if (rest.length > TARGET_RATE / 4) {
    const pcm16 = resample(rest, inRate, TARGET_RATE);
    enqueueSend(pcm16);
  }
  setStatus('Распознаю…');
  await sendChain.catch(() => {});
  setStatus('');
}

els.btnRecord.onclick = () => recording ? stopRec() : startRec();

/* ---------- Горячие клавиши ---------- */

document.addEventListener('keydown', e => {
  if (e.key === 'F2') { e.preventDefault(); recording ? stopRec() : startRec(); }
  if (e.key === 'Escape' && recording) stopRec();
  if (e.key === '/' && document.activeElement !== els.text && document.activeElement !== els.title) {
    e.preventDefault();
    els.search.focus();
  }
});

/* ---------- Мобильное меню ---------- */

function closeSidebar() {
  els.sidebar.classList.remove('open');
  els.overlay.classList.remove('show');
}
els.burger.onclick = () => {
  els.sidebar.classList.add('open');
  els.overlay.classList.add('show');
};
els.overlay.onclick = closeSidebar;

/* ---------- Сервис-воркер (PWA) ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- Старт ---------- */

els.btnNew.onclick = newNote;
els.search.oninput = renderList;
els.sort.onchange = () => {
  sortMode = els.sort.value;
  localStorage.setItem('voicepad.sort', sortMode);
  renderList();
};
els.sort.value = sortMode;
els.modelSel.value = modelChoice;

load();
if (!notes.length) {
  notes.push({
    id: Date.now(),
    title: 'Добро пожаловать!',
    text: 'Нажмите большую красную кнопку и начните диктовать.\n\nF2 — старт/стоп диктовки, Esc — остановить.\nЯзык переключается кнопками RU / UA / EN.\n\nРаспознавание работает локально на устройстве. При первом запуске модель скачивается один раз (~90 МБ), дальше приложение работает офлайн. Если распознавание кажется медленным — в меню слева переключите модель на tiny.',
    updated: Date.now(),
  });
  save();
}
activeId = notes[0].id;
renderLang();
renderAll();
initWhisper();
