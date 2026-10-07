#!/usr/bin/env bash
# Создание второго пользователя, private chat, send/get message.

run_chat_tests() {
	echo ""
	echo "→ Chat / Messages"

	# Второй пользователь
	local user_b="smoke_peer_$$"
	local pass_b="smokepassword_1"

	http_request \
		-X POST "$BASE_URL/api/v2/auth/register" \
		-c "$COOKIE_JAR_B" \
		-H "Content-Type: application/json" \
		-d "{\"username\":\"$user_b\",\"password\":\"$pass_b\",\"firstName\":\"SmokePeer\"}"

	local user_b_id
	user_b_id=$(printf '%s' "$HTTP_BODY" | python3 -c \
		"import sys,json; print(json.load(sys.stdin).get('user',{}).get('id',''))" \
		2>/dev/null || true)

	SESSION_COOKIE_B=$(session_cookie_header "$COOKIE_JAR_B")

	if [[ "$HTTP_CODE" == "201" && -n "$user_b_id" && -n "$SESSION_COOKIE_B" ]]; then
		echo "✓ [$HTTP_CODE] POST /api/v2/auth/register (second user)"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/auth/register (second user) — expected 201 with user.id and cookie"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
		return
	fi

	# Создаём private chat
	http_request \
		-X POST "$BASE_URL/api/v2/chats/private" \
		-H "Content-Type: application/json" \
		-b "$COOKIE_JAR" \
		-d "{\"userId\":\"$user_b_id\"}"

	CHAT_ID=$(printf '%s' "$HTTP_BODY" | python3 -c \
		"import sys,json; print(json.load(sys.stdin).get('chatId',''))" \
		2>/dev/null || true)

	if [[ ("$HTTP_CODE" == "201" || "$HTTP_CODE" == "200") && -n "$CHAT_ID" ]]; then
		echo "✓ [$HTTP_CODE] POST /api/v2/chats/private"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/chats/private — expected 200/201 with chatId"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
		return
	fi

	# Отправляем сообщение — отправка всегда пачкой (#808), здесь пачка из одного
	local smoke_message="smoke-message-$$"

	http_request \
		-X POST "$BASE_URL/api/v2/messages/$CHAT_ID" \
		-H "Content-Type: application/json" \
		-b "$COOKIE_JAR" \
		-d "{\"messages\":[{\"content\":\"$smoke_message\",\"type\":\"text\"}]}"

	MESSAGE_ID=$(printf '%s' "$HTTP_BODY" | python3 -c \
		"import sys,json; print((json.load(sys.stdin).get('messages') or [{}])[0].get('id',''))" \
		2>/dev/null || true)

	if [[ "$HTTP_CODE" == "201" && -n "$MESSAGE_ID" ]]; then
		echo "✓ [$HTTP_CODE] POST /api/v2/messages/$CHAT_ID"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/messages/$CHAT_ID — expected 201 with messages[0].id"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
		return
	fi

	# Читаем сообщения обратно
	http_request \
		-b "$COOKIE_JAR" \
		"$BASE_URL/api/v2/messages/$CHAT_ID"

	if [[ "$HTTP_CODE" == "200" ]] &&
		printf '%s' "$HTTP_BODY" | python3 -c '
import sys, json

data = json.load(sys.stdin)
expected_id = sys.argv[1]
expected_content = sys.argv[2]

messages = data.get("messages", [])

if not any(
    m.get("id") == expected_id and m.get("content") == expected_content
    for m in messages
):
    raise SystemExit(1)
' "$MESSAGE_ID" "$smoke_message"; then
		echo "✓ [$HTTP_CODE] GET /api/v2/messages/$CHAT_ID contains sent message"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] GET /api/v2/messages/$CHAT_ID — sent message not found"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi

	# Пачка из двух: ответ в том же порядке
	http_request \
		-X POST "$BASE_URL/api/v2/messages/$CHAT_ID" \
		-H "Content-Type: application/json" \
		-b "$COOKIE_JAR" \
		-d "{\"messages\":[{\"content\":\"$smoke_message-a\",\"type\":\"text\"},{\"content\":\"$smoke_message-b\",\"type\":\"text\"}]}"

	if [[ "$HTTP_CODE" == "201" ]] &&
		printf '%s' "$HTTP_BODY" | python3 -c '
import sys, json

contents = [m.get("content") for m in json.load(sys.stdin).get("messages", [])]
if contents != [sys.argv[1] + "-a", sys.argv[1] + "-b"]:
    raise SystemExit(1)
' "$smoke_message"; then
		echo "✓ [$HTTP_CODE] POST /api/v2/messages/$CHAT_ID — batch of two, in order"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/messages/$CHAT_ID — batch of two not returned in order"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi

	# Пустая пачка — 400
	http_request \
		-X POST "$BASE_URL/api/v2/messages/$CHAT_ID" \
		-H "Content-Type: application/json" \
		-b "$COOKIE_JAR" \
		-d '{"messages":[]}'

	if [[ "$HTTP_CODE" == "400" ]]; then
		echo "✓ [$HTTP_CODE] POST /api/v2/messages/$CHAT_ID — empty batch rejected"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/messages/$CHAT_ID — empty batch should be 400"
		FAIL=$((FAIL + 1))
	fi
}
