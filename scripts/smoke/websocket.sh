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

	# Wait for the actual handshake, including cold go run compilation time.
	local ready=false
	for ((attempt = 0; attempt < 300; attempt++)); do
		if grep -q '^READY$' "$ws_output_file"; then ready=true; break; fi
		if ! kill -0 "$ws_pid" 2>/dev/null; then break; fi
		sleep 0.1
	done
	if [[ "$ready" != true ]]; then
		echo "✗ [WS] handshake did not complete"
		cat "$ws_output_file"
		kill "$ws_pid" 2>/dev/null || true
		wait "$ws_pid" 2>/dev/null || true
		rm -f "$ws_output_file"
		FAIL=$((FAIL + 1))
		return
	fi

	local smoke_ws_message="smoke-ws-$$"

	http_request \
		-X POST "$BASE_URL/api/v2/messages/$CHAT_ID" \
		-H "Content-Type: application/json" \
		-H "Authorization: Bearer $TOKEN" \
		-d "{\"content\":\"$smoke_ws_message\",\"type\":\"text\",\"entities\":[{\"type\":\"bold\",\"offset\":0,\"length\":5},{\"type\":\"link\",\"offset\":6,\"length\":2,\"data\":{\"url\":\"https://example.com/docs\"}}]}"

	if [[ "$HTTP_CODE" != "201" ]]; then
		echo "✗ [$HTTP_CODE] Failed to create message for WebSocket test"
		kill "$ws_pid" 2>/dev/null || true
		wait "$ws_pid" 2>/dev/null || true
		rm -f "$ws_output_file"
		FAIL=$((FAIL + 1))
		return
	fi

	if wait "$ws_pid" && python3 -c '
import json, sys
with open(sys.argv[1]) as stream:
    events = [json.loads(line) for line in stream if line.startswith("{")]
message = events[-1]["message"]
assert message["content"] == sys.argv[2]
assert message["entities"] == [
    {"type": "bold", "offset": 0, "length": 5},
    {"type": "link", "offset": 6, "length": 2, "data": {"url": "https://example.com/docs"}},
]
' "$ws_output_file" "$smoke_ws_message"; then
		ws_output=$(cat "$ws_output_file")

		echo "✓ [WS] received new_message with entities for chat $CHAT_ID"
		PASS=$((PASS + 1))
	else
		ws_output=$(cat "$ws_output_file")

		echo "✗ [WS] new_message event was not received"
		echo "  ${ws_output:0:300}"
		FAIL=$((FAIL + 1))
	fi

	rm -f "$ws_output_file"
}
