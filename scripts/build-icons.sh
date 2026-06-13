#!/usr/bin/env bash
# Перегенерація icon.ico з assets/icon.png (потрібен ImageMagick: magick або convert).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/assets/icon.png"
ICO="$ROOT/assets/icon.ico"

if [[ ! -f "$SRC" ]]; then
    echo "Немає $SRC" >&2
    exit 1
fi

if command -v magick >/dev/null 2>&1; then
    magick "$SRC" -resize 512x512^ -gravity center -extent 512x512 "$SRC"
    magick "$SRC" -define icon:auto-resize=256,128,64,48,32,16 "$ICO"
elif command -v convert >/dev/null 2>&1; then
    convert "$SRC" -resize 512x512^ -gravity center -extent 512x512 "$SRC"
    convert "$SRC" -define icon:auto-resize=256,128,64,48,32,16 "$ICO"
else
    echo "ImageMagick не знайдено (magick/convert). Залишено лише icon.png." >&2
    exit 1
fi

echo "OK: $SRC, $ICO"
