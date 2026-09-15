#!/usr/bin/env bash
# upload/download или upload/metadata.

#!/usr/bin/env bash

run_encrypted_media_tests() {
	local payload media_url
	payload='{"purpose":"message","file":{"encrypted":true,"version":2,"algorithm":"AES-GCM","iv":"AAECAwQFBgcICQoL","keyEpoch":5,"sizeBytes":999,"ciphertext":"Y2lwaGVy","mimeType":"text/html"}}'
	http_request -X POST "$BASE_URL/api/v2/media" \
		-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "$payload"
	if [[ "$HTTP_CODE" == "201" ]] && printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
body = json.load(sys.stdin)
envelope = json.loads(body["encryption"])
assert body["success"] and body["encrypted"] and body["url"]
assert body["sizeBytes"] == envelope["sizeBytes"] == 999
assert envelope["keyEpoch"] == 5 and envelope["version"] == 2
assert body["contentType"] == "text/html"
'; then
		echo "✓ [$HTTP_CODE] encrypted v2 upload preserves keyEpoch and plaintext size"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] encrypted v2 upload — invalid response"
		FAIL=$((FAIL + 1))
		return
	fi
	media_url=$(printf '%s' "$HTTP_BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])')
	http_request "$BASE_URL$media_url"
	if [[ "$HTTP_CODE" == "200" ]] && printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
body = json.load(sys.stdin)
assert body["encrypted"] and body["version"] == 2 and body["algorithm"] == "AES-GCM"
assert body["keyEpoch"] == 5 and body["sizeBytes"] == 999
assert body["iv"] == "AAECAwQFBgcICQoL" and body["ciphertext"] == "Y2lwaGVy"
'; then
		echo "✓ [$HTTP_CODE] encrypted v2 download preserves envelope"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] encrypted v2 download — invalid envelope"
		FAIL=$((FAIL + 1))
	fi

	local version ciphertext expected_code
	for expected_code in invalid_ciphertext validation_failed; do
		version=2
		ciphertext='!!!'
		if [[ "$expected_code" == "validation_failed" ]]; then
			version=1
			ciphertext='Y2lwaGVy'
		fi
		printf -v payload '{"purpose":"message","file":{"encrypted":true,"version":%s,"algorithm":"AES-GCM","iv":"AAECAwQFBgcICQoL","keyEpoch":5,"sizeBytes":999,"ciphertext":"%s"}}' "$version" "$ciphertext"
		http_request -X POST "$BASE_URL/api/v2/media" \
			-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "$payload"
		if [[ "$HTTP_CODE" == "400" ]] && printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
assert json.load(sys.stdin)["code"] == sys.argv[1]
' "$expected_code"; then
			echo "✓ [$HTTP_CODE] encrypted upload rejects $expected_code"
			PASS=$((PASS + 1))
		else
			echo "✗ [$HTTP_CODE] encrypted upload — expected 400 $expected_code"
			FAIL=$((FAIL + 1))
		fi
	done
}

run_media_tests() {
	echo ""
	echo "→ Media"
	run_encrypted_media_tests

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

	if [[ "$HTTP_CODE" == "200" && "$HTTP_BODY" == "$file_content" ]]; then
		echo "✓ [$HTTP_CODE] GET $MEDIA_URL returns media content"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] GET $MEDIA_URL — expected 200 with uploaded content"
		echo "  ${HTTP_HEADERS:0:300}"
		echo "  body: ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
	fi
}
