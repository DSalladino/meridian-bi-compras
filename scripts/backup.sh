#!/usr/bin/env bash
# Backup do Meridian BI: PostgreSQL (se configurado) + data/config/logs.
#
# Uso:
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/meridian ./scripts/backup.sh
#
# Agende no cron (diário, 02:30):
#   30 2 * * * cd /opt/meridian && DATABASE_URL=... BACKUP_DIR=/var/backups/meridian ./scripts/backup.sh >> /var/log/meridian-backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$DEST/meridian-backup-$STAMP"

mkdir -p "$WORK"

echo "  ▸ backup $STAMP"
echo "    origem  $ROOT"
echo "    destino $WORK"

if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  echo "    PostgreSQL: pg_dump"
  pg_dump --format=custom --no-owner --no-privileges --file "$WORK/meridian.dump" "$DATABASE_URL"
else
  echo "    PostgreSQL: ignorado (DATABASE_URL ausente ou pg_dump não instalado)"
fi

echo "    arquivos: data/config/logs"
tar --exclude='data/backups' --exclude='logs/*.tmp' \
  -czf "$WORK/arquivos.tar.gz" -C "$ROOT" data config logs 2>/dev/null \
  || tar --exclude='data/backups' -czf "$WORK/arquivos.tar.gz" -C "$ROOT" data config 2>/dev/null \
  || true

if [ -f "$WORK/arquivos.tar.gz" ]; then
  (cd "$WORK" && sha256sum arquivos.tar.gz > arquivos.sha256)
fi
if [ -f "$WORK/meridian.dump" ]; then
  (cd "$WORK" && sha256sum meridian.dump > meridian.sha256)
fi

cat > "$WORK/manifest.txt" <<EOF
Meridian BI backup
data: $(date -u +%Y-%m-%dT%H:%M:%SZ)
host: $(hostname)
git: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "n/d")
postgres: $([ -f "$WORK/meridian.dump" ] && echo sim || echo nao)
EOF

# Retenção local (o ideal é também replicar para storage externo).
if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  find "$DEST" -maxdepth 1 -type d -name 'meridian-backup-*' -mtime +"$KEEP" -print -exec rm -rf {} \;
fi

echo "    concluído: $(du -sh "$WORK" | cut -f1)"
