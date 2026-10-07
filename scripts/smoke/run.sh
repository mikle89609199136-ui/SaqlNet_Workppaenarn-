#!/usr/bin/env bash
# orchestration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/auth.sh"
source "$SCRIPT_DIR/chat.sh"
source "$SCRIPT_DIR/media.sh"
source "$SCRIPT_DIR/websocket.sh"

BASE_URL="${1:-http://127.0.0.1:3000}"
COOKIE_JAR=$(mktemp)
COOKIE_JAR_B=$(mktemp)
trap 'rm -f "$COOKIE_JAR" "$COOKIE_JAR_B"' EXIT

# source "$(dirname "$0")/websocket.sh"

echo ""
echo "══════════════════════════════════════════════════"
echo " Smoke tests — $BASE_URL"
echo "══════════════════════════════════════════════════"

check_health() {
	echo ""
	echo "→ Checking application"

	if ! curl -fsS --connect-timeout 3 "$BASE_URL/health/live" >/dev/null; then
		echo "✗ Application is not reachable at $BASE_URL"
		echo "  Start CraneApp first or pass another BASE_URL."
		exit 1
	fi

	check "GET /health/live" 200 \
		"$BASE_URL/health/live"
}

# 1. Проверяем, что приложение доступно
check_health

# 2. Критические сценарии
run_auth_tests
run_chat_tests
if python3 "$SCRIPT_DIR/entities.py" "$BASE_URL" "$SESSION_COOKIE" "$CHAT_ID"; then
	PASS=$((PASS + 1))
else
	FAIL=$((FAIL + 1))
fi
run_media_tests
run_websocket_tests

# 3. Результат
print_summary
