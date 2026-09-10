#!/data/data/com.termux/files/usr/bin/sh
# Установка whisper.cpp + модели base в Termux (один раз)
set -e

echo "==> Обновление пакетов Termux"
pkg update -y && pkg upgrade -y
pkg install -y git cmake clang wget termux-api

cd ~

if [ ! -d whisper.cpp ]; then
  echo "==> Клонирование whisper.cpp"
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp
fi
cd whisper.cpp

echo "==> Сборка (это займет 5-15 минут)"
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j"$(nproc)"

echo "==> Загрузка модели base (~150 МБ)"
mkdir -p models
wget -c -O models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

echo "==> Установка скрипта запуска"
cp "$(dirname "$0")/start-whisper.sh" ~/start-whisper.sh 2>/dev/null || true

echo "==> Готово! Запуск сервера:  bash ~/start-whisper.sh"
