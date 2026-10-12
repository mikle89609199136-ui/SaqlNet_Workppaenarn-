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

run_encrypted_media_tests() {
	local payload media_url
	payload='{"purpose":"message","file":{"encrypted":true,"version":2,"algorithm":"AES-GCM","iv":"AAECAwQFBgcICQoL","keyEpoch":5,"sizeBytes":999,"ciphertext":"Y2lwaGVy","mimeType":"text/html"}}'
	http_request -X POST "$BASE_URL/api/v2/media" \
		-H "Content-Type: application/json" -b "$COOKIE_JAR" -d "$payload"
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
			-H "Content-Type: application/json" -b "$COOKIE_JAR" -d "$payload"
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

run_gif_tests() {
	local text_url="$1"
	local gif_url payload
	http_request -X POST "$BASE_URL/api/v2/media" \
		-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
		-d '{"file":"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","fileName":"smoke.gif"}'
	gif_url=$(printf '%s' "$HTTP_BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url", ""))' 2>/dev/null || true)
	if [[ "$HTTP_CODE" == "201" && -n "$gif_url" ]]; then
		echo "✓ [$HTTP_CODE] upload one-pixel GIF"
		PASS=$((PASS + 1))
	else
		echo "✗ [$HTTP_CODE] upload one-pixel GIF — expected 201 with url"
		echo "  ${HTTP_BODY:0:160}"
		FAIL=$((FAIL + 1))
		return
	fi
	printf -v payload '{"url":"%s","name":"smoke GIF"}' "$gif_url"
	auth_json "POST /api/v2/gifs with own GIF upload" 201 \
		-X POST "$BASE_URL/api/v2/gifs" -d "$payload"

	local source_url expected_code
	for expected_code in invalid_url invalid_gif_source; do
		source_url='javascript:alert(1)'
		if [[ "$expected_code" == "invalid_gif_source" ]]; then
			source_url="$text_url"
		fi
		printf -v payload '{"url":"%s"}' "$source_url"
		http_request -X POST "$BASE_URL/api/v2/gifs" \
			-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "$payload"
		if [[ "$HTTP_CODE" == "400" ]] && printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
assert json.load(sys.stdin)["code"] == sys.argv[1]
' "$expected_code"; then
			echo "✓ [$HTTP_CODE] POST /api/v2/gifs rejects $expected_code"
			PASS=$((PASS + 1))
		else
			echo "✗ [$HTTP_CODE] POST /api/v2/gifs — expected 400 $expected_code"
			echo "  ${HTTP_BODY:0:160}"
			FAIL=$((FAIL + 1))
		fi
	done
}

run_sticker_tests() {
	local body_file body_cleanup
	local -a scenarios=(valid trailing)
	if [[ -n "${MAX_FILE_SIZE:-}" ]]; then
		scenarios+=(oversized)
		body_file=$(mktemp)
		trap 'rm -f "$body_file"; trap - RETURN EXIT' RETURN
		printf -v body_cleanup 'rm -f -- %q' "$body_file"
		trap "$body_cleanup" EXIT
		# Match the media service's explicitly supplied MAX_FILE_SIZE.
		if ! python3 - "$body_file" "$MAX_FILE_SIZE" <<'PY'
import sys
limit = int(sys.argv[2])
body_limit = ((limit + 2) // 3) * 4 + (64 << 10)
with open(sys.argv[1], "w") as body:
    body.write('{"name":"smoke sticker pack","description":"')
    remaining = body_limit + 1
    while remaining:
        size = min(remaining, 65536)
        body.write("a" * size)
        remaining -= size
    body.write('"}')
PY
		then
			echo "✗ generate oversized sticker request"
			FAIL=$((FAIL + 1))
			return
		fi
	else
		echo "⊘ POST /api/v2/stickers/packs oversized — пропущено: MAX_FILE_SIZE не задан"
	fi

	local scenario payload expected_status expected_code pack_id
	local -a pack_ids=()
	for scenario in "${scenarios[@]}"; do
		payload='{"name":"smoke sticker pack"}'
		expected_status=201
		expected_code=''
		case "$scenario" in
			trailing)
				payload+='{"name":"second"}'
				expected_status=400
				expected_code=invalid_json
				;;
			oversized)
				payload="@$body_file"
				expected_status=413
				expected_code=request_too_large
				;;
		esac
		http_request -X POST "$BASE_URL/api/v2/stickers/packs" \
			-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
			--data-binary "$payload"
		pack_id=$(printf '%s' "$HTTP_BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("pack", {}).get("id", ""))' 2>/dev/null || true)
		if [[ -n "$pack_id" ]]; then
			pack_ids+=("$pack_id")
		fi
		if [[ "$HTTP_CODE" == "$expected_status" ]] && printf '%s' "$HTTP_BODY" | python3 -c '
import json, sys
body = json.load(sys.stdin)
assert body.get("code") == sys.argv[1] if sys.argv[1] else body.get("success") and body.get("pack", {}).get("id")
' "$expected_code"; then
			echo "✓ [$HTTP_CODE] POST /api/v2/stickers/packs $scenario"
			PASS=$((PASS + 1))
		else
			echo "✗ [$HTTP_CODE] POST /api/v2/stickers/packs $scenario — expected $expected_status $expected_code"
			echo "  ${HTTP_BODY:0:160}"
			FAIL=$((FAIL + 1))
		fi
	done
	# Also remove packs accidentally accepted by a regressed handler.
	for pack_id in "${pack_ids[@]}"; do
		auth_check "DELETE smoke sticker pack $pack_id" 200 \
			-X DELETE "$BASE_URL/api/v2/stickers/packs/$pack_id"
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

	local mime_type
	for mime_type in text/html image/svg+xml; do
		http_request \
			-X POST "$BASE_URL/api/v2/media" \
			-H "Content-Type: application/json" \
			-b "$COOKIE_JAR" \
			-d "{\"file\":\"data:$mime_type;base64,$file_base64\",\"fileName\":\"$file_name\"}"
		assert_media_unsupported_type "POST /api/v2/media JSON $mime_type"

		http_request \
			-X POST "$BASE_URL/api/v2/media" \
			-b "$COOKIE_JAR" \
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
		-b "$COOKIE_JAR" \
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

	run_gif_tests "$MEDIA_URL"
	run_sticker_tests
}
