#!/bin/sh
# Semeia volumes vazios com o dataset/perfil demo e garante permissões do node.
set -eu

mkdir -p /app/data /app/config /app/logs /app/.secrets

if [ -z "$(ls -A /app/data 2>/dev/null || true)" ]; then
  echo "  ▸ volume de dados vazio: semeando dataset demo"
  cp -a /app/seed-data/. /app/data/
fi

if [ -f /app/seed-config/empresa.example.json ] && [ ! -f /app/config/empresa.example.json ]; then
  cp /app/seed-config/empresa.example.json /app/config/empresa.example.json
fi
if [ ! -f /app/config/empresa.json ]; then
  cp /app/config/empresa.example.json /app/config/empresa.json
fi

chown -R node:node /app/data /app/config /app/logs /app/.secrets
exec su-exec node "$@"
