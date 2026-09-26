#!/bin/sh
set -e

MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-craneapp}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-craneapp2024}"
MEDIA_BUCKET="${MEDIA_BUCKET:-crane-media}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:9000}"
MINIO_REGION="${MINIO_REGION:-us-east-1}"
LEGACY_UPLOADS_DIR="${LEGACY_UPLOADS_DIR:-/data/legacy-uploads}"
AUTH_LOGOUT_ALL_GENERATION_ENABLED="${AUTH_LOGOUT_ALL_GENERATION_ENABLED:-false}"

export MINIO_ACCESS_KEY MINIO_SECRET_KEY MEDIA_BUCKET MINIO_ENDPOINT MINIO_REGION LEGACY_UPLOADS_DIR AUTH_LOGOUT_ALL_GENERATION_ENABLED

# Generate encryption secret if not provided
if [ -z "$CRYPTO_ENCRYPTION_SECRET" ]; then
  export CRYPTO_ENCRYPTION_SECRET=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
fi

# Allow all origins if ALLOWED_ORIGINS is not set (WebSocket is token-protected)
if [ -z "$ALLOWED_ORIGINS" ]; then
  export ALLOWED_ORIGINS="*"
fi

echo "[entrypoint] CRANE_BUILD=csp-v3"
echo "[entrypoint] running migrations..."
cd /app && /usr/local/bin/migrate

LEGACY_MIGRATION_MARKER="/data/.legacy-v2-migration-complete"
if [ "${RUN_LEGACY_MIGRATION:-false}" = "true" ] && [ ! -f "$LEGACY_MIGRATION_MARKER" ]; then
  echo "[entrypoint] starting temporary MinIO for legacy migration..."
  MINIO_ROOT_USER="$MINIO_ACCESS_KEY" MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
    /usr/local/bin/minio server /data/minio --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 &
  MIGRATION_MINIO_PID=$!

  cleanup_migration_minio() {
    kill "$MIGRATION_MINIO_PID" 2>/dev/null || true
    wait "$MIGRATION_MINIO_PID" 2>/dev/null || true
  }
  trap cleanup_migration_minio EXIT INT TERM

  echo "[entrypoint] migrating legacy data into backend v2..."
  cd /app && /usr/local/bin/migrate-legacy --domain all --apply
  touch "$LEGACY_MIGRATION_MARKER"
  echo "[entrypoint] legacy migration completed"

  cleanup_migration_minio
  trap - EXIT INT TERM
fi

echo "[entrypoint] starting services..."
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
