// whisper-worker.js — локальное распознавание речи в браузере
// Whisper (ONNX, 4-бит) через @huggingface/transformers: WebGPU, fallback — WASM
'use strict';

import { pipeline } from "https://esm.run/@huggingface/transformers";

const MODELS = {
  base: "onnx-community/whisper-base",   // точнее, для RU/UK рекомендуется
  tiny: "onnx-community/whisper-tiny",   // быстрее, для слабых устройств
};

const LANGUAGES = {
  ru: "russian",
  uk: "ukrainian",
  en: "english",
};

let transcriber = null;
let activeModel = null;

async function build(modelKey, device) {
  return pipeline("automatic-speech-recognition", MODELS[modelKey], {
    device,
    dtype: "q4",
    progress_callback: (p) => {
      if (p && typeof p.progress === "number") {
        self.postMessage({ type: "progress", progress: p.progress });
      }
    },
  });
}

self.onmessage = async (e) => {
  const { type, audio, language, model, requestId } = e.data || {};

  /* ---------- Инициализация ---------- */
  if (type === "init") {
    const want = MODELS[model] ? model : "base";
    try {
      transcriber = await build(want, "webgpu");
      activeModel = want;
      self.postMessage({ type: "ready", model: activeModel, fallback: false, requestId });
      return;
    } catch (err) {
      // WebGPU недоступен — пробуем WASM с маленькой моделью
      try {
        transcriber = await build("tiny", "wasm");
        activeModel = "tiny";
        self.postMessage({
          type: "ready", model: activeModel, fallback: true,
          warning: "WebGPU недоступен: включена модель tiny (медленнее)",
          requestId,
        });
        return;
      } catch (err2) {
        transcriber = null;
        activeModel = null;
        self.postMessage({ type: "error", error: String(err2.message || err2), requestId });
        return;
      }
    }
  }

  /* ---------- Распознавание ---------- */
  if (type === "transcribe") {
    if (!transcriber) {
      self.postMessage({ type: "error", error: "Модель не загружена", requestId });
      return;
    }
    try {
      const result = await transcriber(audio, {
        language: LANGUAGES[language] || null,
        return_timestamps: false,
        max_new_tokens: 128,
      });
      self.postMessage({
        type: "result",
        text: (result && result.text ? result.text : "").trim(),
        requestId,
      });
    } catch (err) {
      self.postMessage({ type: "error", error: String(err.message || err), requestId });
    }
  }
};
