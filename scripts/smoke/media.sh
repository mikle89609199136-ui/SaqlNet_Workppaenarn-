#!/usr/bin/env bash
# upload/download или upload/metadata.

assert_media_unsupported_type() {
	local label="$1"
	if [[ "$HTTP_CODE" == "415" ]] && printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
error = json.load(sys.stdin)
sys.exit(0 if error.get("code") == "unsupported_type" and error.get("message") == "file type not allowed" else 1)
'; then
		echo "✓ [$HTTP_CODE] $label"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] $label — expected 415 unsupported_type / file type not allowed"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi
}

run_media_tests() {
	echo ""
	echo "→ Media"

	local file_name="smoke-$$.txt"
	local file_content="hello-smoke-media-$$"
	local file_base64

	file_base64=$(printf '%s' "$file_content" | base64 | tr -d '\n')

	local mime_type
	for mime_type in text/html image/svg+xml; do
		http_request \
			-X POST "$BASE_URL/api/v2/media" \
			-H "Content-Type: application/json" \
			-H "Authorization: Bearer $TOKEN" \
			-d "{\"file\":\"data:$mime_type;base64,$file_base64\",\"fileName\":\"$file_name\"}"
		assert_media_unsupported_type "POST /api/v2/media JSON $mime_type"

		http_request \
			-X POST "$BASE_URL/api/v2/media" \
			-H "Authorization: Bearer $TOKEN" \
			-F "file=@-;filename=$file_name;type=$mime_type" <<< "$file_content"
		assert_media_unsupported_type "POST /api/v2/media multipart $mime_type"
	done

	# Optional existing unsafe fixture: no DB changes are needed to check its download.
	if [[ -n "${MEDIA_LEGACY_UNSAFE_URL:-}" && "${MEDIA_LEGACY_UNSAFE_BODY+x}" == "x" ]]; then
		http_request_with_headers "$BASE_URL$MEDIA_LEGACY_UNSAFE_URL"
		local legacy_type legacy_disposition
		legacy_type=$(printf '%s\n' "$HTTP_HEADERS" | sed -n 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//p' | tr -d '\r')
		legacy_disposition=$(printf '%s\n' "$HTTP_HEADERS" | sed -n 's/^[Cc]ontent-[Dd]isposition:[[:space:]]*//p' | tr -d '\r')
		if [[ "$HTTP_CODE" == "200" && "$legacy_type" == "application/octet-stream" && "$legacy_disposition" == "attachment" && "$HTTP_BODY" == "$MEDIA_LEGACY_UNSAFE_BODY" ]]; then
			echo "✓ [$HTTP_CODE] GET legacy unsafe media returns attachment with unchanged content"
			PASS=$((PASS + 1))
		else
			echo "✗ [$HTTP_CODE] GET legacy unsafe media — expected octet-stream attachment with unchanged content"
			FAIL=$((FAIL + 1))
		fi
	fi

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

	local returned_type disposition
	returned_type=$(printf '%s\n' "$HTTP_HEADERS" | sed -n 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//p' | tr -d '\r')
	disposition=$(printf '%s\n' "$HTTP_HEADERS" | sed -n 's/^[Cc]ontent-[Dd]isposition:[[:space:]]*//p' | tr -d '\r')
	if [[ "$HTTP_CODE" == "200" && "$HTTP_BODY" == "$file_content" && "$returned_type" == "text/plain" && -z "$disposition" ]]; then
		echo "✓ [$HTTP_CODE] GET $MEDIA_URL returns media content"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] GET $MEDIA_URL — expected 200 with uploaded text/plain content and no attachment"
		echo "  ${HTTP_HEADERS:0:300}"
		echo "  body: ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi
}
