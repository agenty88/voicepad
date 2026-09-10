#!/data/data/com.termux/files/usr/bin/sh
# Запуск локального Whisper-сервера (порт 8080)
cd ~/whisper.cpp || exit 1

termux-wake-lock   # не дает Android усыпить процесс

BIN=""
for c in build/bin/whisper-server build/bin/server; do
  [ -x "$c" ] && BIN="$c" && break
done
if [ -z "$BIN" ]; then
  echo "Сервер не найден. Сначала выполните: bash install.sh"
  exit 1
fi

echo "Запуск: $BIN"
exec "$BIN" \
  -m models/ggml-base.bin \
  --host 127.0.0.1 \
  --port 8080 \
  --allow-origin '*' \
  -t "$(nproc)"
