#!/usr/bin/env bash
# подключение и проверка хотя бы одного события.

# От самого файла, а не от того, кто его подключил: BASH_SOURCE[2] зависит
# от глубины вызова, и под set -u обращение к пустому элементу обрывает
# прогон ещё до первой проверки.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run_websocket_tests() {
	echo ""
	echo "→ WebSocket"

	local ws_base
	ws_base="${BASE_URL/http:/ws:}"
	ws_base="${ws_base/https:/wss:}"

	local ws_url="$ws_base/ws?token=$TOKEN_B"
	local ws_output
	local ws_output_file
	local ws_pid

	ws_output_file=$(mktemp)

	(
		cd "$PROJECT_ROOT/backend-v2"
		go run ./cmd/smoke-ws \
			"$ws_url" \
			"new_message" \
			"$CHAT_ID"
	) >"$ws_output_file" 2>&1 &

	ws_pid=$!

	# Даём клиенту время завершить handshake.
	sleep 1

	local smoke_ws_message="smoke-ws-$$"

	http_request \
		-X POST "$BASE_URL/api/v2/messages/$CHAT_ID" \
		-H "Content-Type: application/json" \
		-H "Authorization: Bearer $TOKEN" \
		-d "{\"content\":\"$smoke_ws_message\",\"type\":\"text\"}"

	if [[ "$HTTP_CODE" != "200" ]]; then
		echo "✗ [$HTTP_CODE] Failed to create message for WebSocket test"
		kill "$ws_pid" 2>/dev/null || true
		wait "$ws_pid" 2>/dev/null || true
		rm -f "$ws_output_file"
		FAIL=$((FAIL + 1))
		return
	fi

	if wait "$ws_pid"; then
		ws_output=$(cat "$ws_output_file")

		echo "✓ [WS] received new_message for chat $CHAT_ID"
		PASS=$((PASS + 1))
	else
		ws_output=$(cat "$ws_output_file")

		echo "✗ [WS] new_message event was not received"
		echo "  ${ws_output:0:300}"
		FAIL=$((FAIL + 1))
	fi

	rm -f "$ws_output_file"
}
