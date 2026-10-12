#!/usr/bin/env bash
# Регистрация, login, получение cookie, базовые auth assertions.

run_auth_tests() {
	echo ""
	echo "→ Auth service"

	TEST_USER="smoketest_$$"
	TEST_PASS="smokepassword_1"

	# Регистрация
	http_request \
		-X POST "$BASE_URL/api/v2/auth/register" \
		-c "$COOKIE_JAR" \
		-H "Content-Type: application/json" \
		-d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\",\"firstName\":\"Smoke\"}"

	SESSION_COOKIE=$(session_cookie_header "$COOKIE_JAR")
	local response_has_user_and_no_token
	response_has_user_and_no_token=$(printf '%s' "$HTTP_BODY" | python3 -c \
		"import sys,json; d=json.load(sys.stdin); print('yes' if d.get('user',{}).get('id') and 'token' not in d else '')" \
		2>/dev/null || true)

	if [[ "$HTTP_CODE" == "201" && -n "$SESSION_COOKIE" && "$response_has_user_and_no_token" == "yes" ]]; then
		echo "✓ [$HTTP_CODE] POST /api/v2/auth/register"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/auth/register — expected 201 with cookie and user, without token"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi

	# Login
	json_check \
		"POST /api/v2/auth/login" \
		200 \
		-X POST "$BASE_URL/api/v2/auth/login" \
		-c "$COOKIE_JAR" \
		-d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}"
	SESSION_COOKIE=$(session_cookie_header "$COOKIE_JAR")

	# Неверный пароль
	json_check \
		"POST /api/v2/auth/login (wrong password)" \
		401 \
		-X POST "$BASE_URL/api/v2/auth/login" \
		-d "{\"username\":\"$TEST_USER\",\"password\":\"wrongpassword1\"}"

	# Авторизованные endpoints
	if [[ -n "$SESSION_COOKIE" ]]; then
		auth_check \
			"GET /api/v2/auth/sessions" \
			200 \
			"$BASE_URL/api/v2/auth/sessions"

		auth_check \
			"GET /api/v2/auth/2fa/status" \
			200 \
			"$BASE_URL/api/v2/auth/2fa/status"
	fi
}
