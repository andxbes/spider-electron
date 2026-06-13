#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="spider-electron"
INSTALL_DIR="${SPIDER_INSTALL_DIR:-$HOME/.local/opt/$APP_NAME}"
BIN_DIR="${SPIDER_BIN_DIR:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$DATA_HOME/applications"
PIXMAP_DIR="$DATA_HOME/pixmaps"
ICON_THEME_ROOT="$DATA_HOME/icons/hicolor"
SOURCE=""

for candidate in \
    "$ROOT/out/${APP_NAME}-linux-x64" \
    "$ROOT/out/${APP_NAME}-linux-arm64"; do
    if [[ -x "$candidate/$APP_NAME" ]]; then
        SOURCE="$candidate"
        break
    fi
done

if [[ -z "$SOURCE" ]]; then
    match="$(find "$ROOT/out" -maxdepth 1 -type d -name "${APP_NAME}-linux-*" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$match" && -x "$match/$APP_NAME" ]]; then
        SOURCE="$match"
    fi
fi

if [[ -z "$SOURCE" ]]; then
    echo "Не знайдено збірку Linux. Спочатку: npm run make:linux" >&2
    echo "Очікується каталог out/${APP_NAME}-linux-x64/ з виконуваним $APP_NAME" >&2
    exit 1
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$PIXMAP_DIR"

if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$SOURCE/" "$INSTALL_DIR/"
else
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    cp -a "$SOURCE/." "$INSTALL_DIR/"
fi

ln -sfn "$INSTALL_DIR/$APP_NAME" "$BIN_DIR/$APP_NAME"

install_icon() {
    local src="$1"
    local dest="$2"
    if [[ ! -f "$src" ]]; then
        return 1
    fi
    if command -v magick >/dev/null 2>&1; then
        magick "$src" -resize 512x512^ -gravity center -extent 512x512 "$dest"
    else
        cp "$src" "$dest"
    fi
}

ICON_FILE=""
if [[ -f "$INSTALL_DIR/resources/icon.png" ]]; then
    ICON_FILE="$INSTALL_DIR/resources/icon.png"
elif [[ -f "$ROOT/assets/icon.png" ]]; then
    ICON_FILE="$ROOT/assets/icon.png"
fi

if [[ -n "$ICON_FILE" ]]; then
    mkdir -p "$ICON_THEME_ROOT/512x512/apps"
    install_icon "$ICON_FILE" "$ICON_THEME_ROOT/512x512/apps/${APP_NAME}.png"
    install_icon "$ICON_FILE" "$PIXMAP_DIR/${APP_NAME}.png"

    if command -v magick >/dev/null 2>&1; then
        for size in 256 128 64 48 32; do
            mkdir -p "$ICON_THEME_ROOT/${size}x${size}/apps"
            magick "$ICON_FILE" -resize "${size}x${size}" "$ICON_THEME_ROOT/${size}x${size}/apps/${APP_NAME}.png"
        done
    fi

    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t "$ICON_THEME_ROOT" 2>/dev/null || true
    fi
fi

DESKTOP_ICON="$PIXMAP_DIR/${APP_NAME}.png"
if [[ ! -f "$DESKTOP_ICON" && -f "$INSTALL_DIR/resources/icon.png" ]]; then
    DESKTOP_ICON="$INSTALL_DIR/resources/icon.png"
fi

cat > "$DESKTOP_DIR/${APP_NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Spider Electron
GenericName=Web Spider
Comment=Desktop web spider
Exec=$INSTALL_DIR/$APP_NAME
Icon=$DESKTOP_ICON
Terminal=false
Categories=Development;Network;
StartupWMClass=spider-electron
EOF

chmod +x "$INSTALL_DIR/$APP_NAME"
chmod 644 "$DESKTOP_DIR/${APP_NAME}.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

echo "Встановлено: $INSTALL_DIR"
echo "Команда в PATH: $BIN_DIR/$APP_NAME"
echo "Меню: $DESKTOP_DIR/${APP_NAME}.desktop"
if [[ -f "$DESKTOP_ICON" ]]; then
    echo "Іконка: $DESKTOP_ICON"
fi
echo "Повторний запуск цього скрипта оновлює встановлену копію."
