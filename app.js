/* VoicePad — голосовой блокнот (PWA + локальный whisper.cpp в Termux) */
'use strict';

const WHISPER_URL = localStorage.getItem('voicepad.url') || 'http://127.0.0.1:8080';
const TARGET_RATE = 16000;        // Whisper принимает 16 кГц
const CHUNK_SEC = 4;              // длина аудио-чанка для распознавания
const CHUNK_SAMPLES = TARGET_RATE * CHUNK_SEC;

/* ---------- Состояние ---------- */

let notes = [];
let activeId = null;
let lang = localStorage.getItem('voicepad.lang') || 'ru';
let sortMode = localStorage.getItem('voicepad.sort') || 'date_desc';

const $ = id => document.getElementById(id);
const els = {
  notes: $('notes'), search: $('search'), sort: $('sort'),
  title: $('title'), text: $('text'), stats: $('stats'),
  btnNew: $('btnNew'), btnExport: $('btnExport'), btnExportAll: $('btnExportAll'),
  btnDelete: $('btnDelete'), btnRecord: $('btnRecord'), recLabel: $('recLabel'),
  recTimer: $('recTimer'), recStatus: $('recStatus'), banner: $('serverBanner'),
  burger: $('burger'), sidebar: $('sidebar'), overlay: $('overlay'),
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
  const blob = new Blob(['\ufeff' + content], { type: 'text/plain;charset=utf-8' });
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

/* ---------- Запись и распознавание ---------- */

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

function encodeWAV(float32) {
  const buf = new ArrayBuffer(44 + float32.length * 2);
  const v = new DataView(buf);
  const wstr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + float32.length * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // mono
  v.setUint32(24, TARGET_RATE, true);
  v.setUint32(28, TARGET_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, float32.length * 2, true);
  let off = 44;
  for (let i = 0; i < float32.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function setStatus(t) { els.recStatus.textContent = t; }

function flushChunks() {
  while (samples.length >= CHUNK_SAMPLES) {
    const raw = samples.slice(0, CHUNK_SAMPLES);
    samples = samples.slice(CHUNK_SAMPLES);
    const pcm16 = resample(raw, inRate, TARGET_RATE);
    enqueueSend(encodeWAV(pcm16));
  }
}

function enqueueSend(blob) {
  sendChain = sendChain.then(() => sendChunk(blob)).catch(() => {});
}

async function sendChunk(blob) {
  if (!recording) return;
  setStatus('Распознаю…');
  const fd = new FormData();
  fd.append('file', blob, 'chunk.wav');
  fd.append('language', lang);
  fd.append('response-format', 'json');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(WHISPER_URL + '/inference', { method: 'POST', body: fd, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const text = (data.text || '').trim();
    if (text) appendText(text);
    setStatus(recording ? 'Слушаю…' : '');
  } catch (e) {
    clearTimeout(t);
    if (recording) setStatus('Нет связи с Whisper, повторяю…');
    throw e;
  }
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
  if (!activeNote()) newNote();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch {
    setStatus('Нет доступа к микрофону — разрешите его в настройках Brave.');
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
    enqueueSend(encodeWAV(pcm16));
  }
  setStatus('Распознаю…');
  await sendChain.catch(() => {});
  setStatus('');
}

els.btnRecord.onclick = () => recording ? stopRec() : startRec();

/* ---------- Проверка сервера ---------- */

async function pingServer() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(WHISPER_URL + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    els.banner.classList.toggle('hidden', r.ok);
  } catch {
    els.banner.classList.remove('hidden');
  }
}
setInterval(pingServer, 15000);
pingServer();

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

load();
if (!notes.length) {
  notes.push({
    id: Date.now(),
    title: 'Добро пожаловать!',
    text: 'Нажмите большую красную кнопку и начните диктовать.\n\nF2 — старт/стоп диктовки, Esc — остановить.\nЯзык переключается кнопками RU / UA / EN.\n\nДля распознавания речи приложение обращается к локальному серверу Whisper (Termux). Если внизу появляется предупреждение — запустите сервер: bash ~/start-whisper.sh',
    updated: Date.now(),
  });
  save();
}
activeId = notes[0].id;
renderLang();
renderAll();
