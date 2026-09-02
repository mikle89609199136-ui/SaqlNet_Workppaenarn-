#!/usr/bin/env bash
# upload/download или upload/metadata.

#!/usr/bin/env bash

run_media_tests() {
	echo ""
	echo "→ Media"

	local file_name="smoke-$$.txt"
	local file_content="hello-smoke-media-$$"
	local file_base64

	file_base64=$(printf '%s' "$file_content" | base64 | tr -d '\n')

	# Загружаем файл
	http_request \
		-X POST "$BASE_URL/api/v2/media" \
		-H "Content-Type: application/json" \
		-H "Authorization: Bearer $TOKEN" \
		-d "{\"file\":\"data:text/plain;base64,$file_base64\",\"fileName\":\"$file_name\"}"

	MEDIA_URL=$(printf '%s' "$HTTP_BODY" | python3 -c \
		"import sys,json; print(json.load(sys.stdin).get('url',''))" \
		2>/dev/null || true)

	local returned_name
	returned_name=$(printf '%s' "$HTTP_BODY" | python3 -c \
		"import sys,json; print(json.load(sys.stdin).get('fileName',''))" \
		2>/dev/null || true)

	if [[ "$HTTP_CODE" == "201" && -n "$MEDIA_URL" && "$returned_name" == "$file_name" ]]; then
		echo "✓ [$HTTP_CODE] POST /api/v2/media"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] POST /api/v2/media — invalid upload response"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
		return
	fi

	# Получаем файл обратно
	http_request_with_headers \
		"$BASE_URL$MEDIA_URL"

	LOCATION=$(printf '%s\n' "$HTTP_HEADERS" |
		sed -n 's/^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]:[[:space:]]*//p' |
		tr -d '\r' |
		head -n 1)

	if [[ "$HTTP_CODE" == "307" && -n "$LOCATION" ]]; then
		echo "✓ [$HTTP_CODE] GET $MEDIA_URL returns redirect"
		PASS=$((PASS + 1))

		if [[ "$LOCATION" == http://minio:* || "$LOCATION" == https://minio:* ]]; then
			echo "⚠ Location uses internal Docker hostname: $LOCATION"
		fi
	else
		echo "✗ [$HTTP_CODE] GET $MEDIA_URL — expected 307 with Location header"
		echo "  ${HTTP_HEADERS:0:300}"
		FAIL=$((FAIL + 1))
	fi
}
