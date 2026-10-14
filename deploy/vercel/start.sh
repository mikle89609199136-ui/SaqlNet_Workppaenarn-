#!/bin/sh
set -eu

# Fail before exposing the gateway; print missing names, never secret values.
required="DATABASE_URL REDIS_URL NATS_URL ALLOWED_ORIGINS CRYPTO_SIGNING_SECRET CRYPTO_ENCRYPTION_SECRET MEDIA_BUCKET MAX_FILE_SIZE"
case "${STORAGE_PROVIDER:-minio}" in
    minio) required="$required MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_REGION" ;;
    vercel_blob) required="$required BLOB_READ_WRITE_TOKEN" ;;
    *) echo "STORAGE_PROVIDER must be minio or vercel_blob" >&2; exit 1 ;;
esac
for name in $required; do
    value=$(printenv "$name" || true)
    if [ -z "$value" ]; then
        echo "Missing required environment variable: $name" >&2
        exit 1
    fi
done

export CRANE_ENV=production
export PORT="${PORT:-80}"
export EDGE_ADDR="0.0.0.0:$PORT"
export AUTH_ADDR=127.0.0.1:8081 USER_ADDR=127.0.0.1:8082
export CHAT_ADDR=127.0.0.1:8083 MEDIA_ADDR=127.0.0.1:8084 ADMIN_ADDR=127.0.0.1:8085
export AUTH_URL=http://127.0.0.1:8081 USER_URL=http://127.0.0.1:8082
export CHAT_URL=http://127.0.0.1:8083 MEDIA_URL=http://127.0.0.1:8084 ADMIN_URL=http://127.0.0.1:8085
export CRYPTO_URL=http://127.0.0.1:5005 CRYPTO_PORT=5005
export AUTH_LOGOUT_ALL_GENERATION_ENABLED="${AUTH_LOGOUT_ALL_GENERATION_ENABLED:-false}"

# Migrations are a separate release step, never run on every cold start.
exec /usr/bin/supervisord -c /etc/craneapp-supervisord.conf
