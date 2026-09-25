#!/usr/bin/env bash
# Publica la app en un paso: revisa el HTML, sube el código a Apps Script, actualiza la implementación
# (misma URL de la API) y sube a GitHub (GitHub Pages). Uso: bash tools/publicar.sh "Descripción"
set -euo pipefail
cd "$(dirname "$0")/.."
DEPLOY_ID=AKfycbxEY9ZVcTbfzaIAUq2RZ9rxCzOClJ5bFNlilWnQVq-SLQydVvBnqoFzTkwgi0yiTq_J
DESC="${1:-Publicación $(date +%F)}"

rama=$(git branch --show-current)
if [ "$rama" != "main" ]; then echo "Publica desde main (estás en $rama)."; exit 1; fi
if [ -n "$(git status --porcelain -- index.html Code.gs sw.js manifest.webmanifest)" ]; then
  echo "Hay cambios sin commit en la app. Haz commit antes de publicar."; exit 1
fi

node tools/revisar-html.js index.html
clasp push --force
clasp deploy -i "$DEPLOY_ID" -d "$DESC"
GCM_INTERACTIVE=always git push
echo "Listo: API actualizada y GitHub Pages publicará en 1-2 minutos."
