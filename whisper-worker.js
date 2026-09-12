// whisper-worker.js — локальное распознавание речи в браузере
// Whisper (ONNX, 4-бит) через @huggingface/transformers: WebGPU, fallback — WASM
'use strict';

import { pipeline } from "https://esm.run/@huggingface/transformers";

const MODELS = {
  large: "onnx-community/whisper-large-v3-turbo", // лучшее качество, ~500 МБ
  small: "onnx-community/whisper-small",          // баланс качества и скорости
  base: "onnx-community/whisper-base",            // легче, среднее качество
  tiny: "onnx-community/whisper-tiny",            // для слабых устройств
};

const LANGUAGES = {
  ru: "russian",
  uk: "ukrainian",
  en: "english",
};

let transcriber = null;
let activeModel = null;

async function build(modelKey, device) {
  const opts = {
    device,
    progress_callback: (p) => {
      if (p && typeof p.progress === "number") {
        self.postMessage({ type: "progress", progress: p.progress });
      }
    },
  };
  try {
    // на GPU считаем в fp16 — точнее и быстрее; на WASM только q4
    return await pipeline("automatic-speech-recognition", MODELS[modelKey], {
      ...opts, dtype: device === "webgpu" ? "q4f16" : "q4",
    });
  } catch (e) {
    // если q4f16 недоступна для этой модели — берём обычную q4
    return await pipeline("automatic-speech-recognition", MODELS[modelKey], {
      ...opts, dtype: "q4",
    });
  }
}

self.onmessage = async (e) => {
  const { type, audio, language, model, requestId } = e.data || {};

  /* ---------- Инициализация ---------- */
  if (type === "init") {
    const want = MODELS[model] ? model : "small";
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
