#!/usr/bin/env bash
# общие helper-функции: check, json_check, auth_check,
# генерация тестовых пользователей, парсинг JSON, counters PASS/FAIL.

PASS=0
FAIL=0

check() {
	local LABEL="$1"
	local EXPECTED="$2"
	shift 2

	local RESP CODE BODY

	RESP=$(curl -s -w "\n%{http_code}" "$@" 2>/dev/null || printf '\n000')

	CODE=$(printf '%s\n' "$RESP" | tail -n 1)
	BODY=$(printf '%s\n' "$RESP" | sed '$d')

	if [[ "$CODE" == "$EXPECTED" ]]; then
		echo "✓ [$CODE] $LABEL"
		PASS=$((PASS + 1))
	else
		echo "✗ [$CODE] $LABEL (expected $EXPECTED)"
		echo "  ${BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi
}

http_request() {
	local response

	response=$(curl -s -H "Origin: $BASE_URL" -w "\n%{http_code}" "$@" 2>/dev/null || printf '\n000')

	HTTP_CODE=$(printf '%s\n' "$response" | tail -n 1)
	HTTP_BODY=$(printf '%s\n' "$response" | sed '$d')
}

json_check() {
	check "$1" "$2" \
		-H "Content-Type: application/json" \
		"${@:3}"
}

auth_check() {
	check "$1" "$2" \
		-b "$COOKIE_JAR" \
		-H "Origin: $BASE_URL" \
		"${@:3}"
}

auth_json() {
	check "$1" "$2" \
		-H "Content-Type: application/json" \
		-b "$COOKIE_JAR" \
		-H "Origin: $BASE_URL" \
		"${@:3}"
}

session_cookie_header() {
	awk 'NF >= 7 && ($1 !~ /^#/ || $1 ~ /^#HttpOnly_/) { print $6 "=" $7; exit }' "$1"
}
http_request_with_headers() {
	local response
	local headers_file

	headers_file=$(mktemp)

	response=$(curl -s \
		-D "$headers_file" \
		-H "Origin: $BASE_URL" \
		-w "\n%{http_code}" \
		"$@" 2>/dev/null || printf '\n000')

	HTTP_CODE=$(printf '%s\n' "$response" | tail -n 1)
	HTTP_BODY=$(printf '%s\n' "$response" | sed '$d')
	HTTP_HEADERS=$(cat "$headers_file")

	rm -f "$headers_file"
}

print_summary() {
	local total=$((PASS + FAIL))

	echo ""
	echo "========================================"
	echo "Smoke test summary"
	echo "========================================"
	echo "Total:  $total"
	echo "Passed: $PASS"
	echo "Failed: $FAIL"
	echo "========================================"

	if [[ "$FAIL" -eq 0 ]]; then
		echo "✓ All smoke tests passed"
		return 0
	fi

	echo "✗ Smoke tests failed"
	return 1
}
