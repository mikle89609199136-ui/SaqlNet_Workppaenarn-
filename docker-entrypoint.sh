#!/bin/sh
set -e

# Generate encryption secret if not provided
if [ -z "$CRYPTO_ENCRYPTION_SECRET" ]; then
  export CRYPTO_ENCRYPTION_SECRET=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
fi

echo "[entrypoint] CRANE_BUILD=csp-v3"
echo "[entrypoint] running migrations..."
cd /app && /usr/local/bin/migrate

echo "[entrypoint] starting services..."
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
