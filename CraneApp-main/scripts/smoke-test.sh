#!/usr/bin/env bash
# smoke-test.sh — быстрая проверка всех сервисов (1 запрос на эндпоинт)
# Использование: ./scripts/smoke-test.sh [BASE_URL]

set -uo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
TEST_USER="smoketest_$$"
TEST_PASS="smokepassword_1"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0

# check LABEL EXPECTED_CODE [curl-args...]
check() {
  local LABEL="$1" EXPECTED="$2"
  shift 2
  local RESP CODE BODY
  RESP=$(curl -s -w "\n%{http_code}" "$@" 2>/dev/null || echo -e "\n000")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | head -n -1)

  if [[ "$CODE" == "$EXPECTED" ]]; then
    echo -e "  ${GREEN}✓${NC} [$CODE] $LABEL"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗${NC} [$CODE] $LABEL  (expected $EXPECTED)"
    echo "        ${BODY:0:160}"
    FAIL=$((FAIL+1))
  fi
}

json_check()  { check "$1" "$2" -H "Content-Type: application/json" "${@:3}"; }
auth_check()  { check "$1" "$2" -H "Authorization: Bearer $TOKEN" "${@:3}"; }
auth_json()   { check "$1" "$2" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" "${@:3}"; }

TOKEN=""

echo ""
echo "══════════════════════════════════════════════════"
echo " Smoke tests — $BASE_URL"
echo "══════════════════════════════════════════════════"

# ── Health ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→${NC} Health"
check "GET /health/live (edge)" 200 "$BASE_URL/health/live"

# ── Auth ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→${NC} Auth service"

REG=$(curl -s -X POST "$BASE_URL/api/v2/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\",\"firstName\":\"Smoke\"}" 2>/dev/null || echo "{}")
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)

if [[ -n "$TOKEN" ]]; then
  echo -e "  ${GREEN}✓${NC} [201] POST /api/v2/auth/register"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}✗${NC} POST /api/v2/auth/register — no token. Response: ${REG:0:160}"
  FAIL=$((FAIL+1))
  LOGIN=$(curl -s -X POST "$BASE_URL/api/v2/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}" 2>/dev/null || echo "{}")
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
fi

json_check "POST /api/v2/auth/login"         200 -X POST "$BASE_URL/api/v2/auth/login" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}"
json_check "POST /api/v2/auth/login (wrong)" 401 -X POST "$BASE_URL/api/v2/auth/login" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"wrongpassword1\"}"

if [[ -n "$TOKEN" ]]; then
  auth_check "GET  /api/v2/auth/sessions"    200 "$BASE_URL/api/v2/auth/sessions"
  auth_check "GET  /api/v2/auth/2fa/status"  200 "$BASE_URL/api/v2/auth/2fa/status"

  # ── User ────────────────────────────────────────────────────────────────
  echo ""
  echo -e "${YELLOW}→${NC} User service"
  auth_check "GET  /api/v2/users/me"                  200 "$BASE_URL/api/v2/users/me"
  auth_check "GET  /api/v2/users/search?q=smoke"      200 "$BASE_URL/api/v2/users/search?q=smoke"
  auth_check "GET  /api/v2/users/all-settings"        200 "$BASE_URL/api/v2/users/all-settings"
  auth_check "GET  /api/v2/users/storage"             200 "$BASE_URL/api/v2/users/storage"
  auth_check "GET  /api/v2/users/devices"             200 "$BASE_URL/api/v2/users/devices"
  auth_check "GET  /api/v2/users/blocked"             200 "$BASE_URL/api/v2/users/blocked"
  auth_check "GET  /api/v2/encryption/my-key/ (no chatId → 400)" 400 "$BASE_URL/api/v2/encryption/my-key/"
  auth_check "GET  /api/v2/encryption/my-key/:id (no key → 404)" 404 "$BASE_URL/api/v2/encryption/my-key/00000000-0000-0000-0000-000000000000"
  auth_check "GET  /api/v2/support/requests"          200 "$BASE_URL/api/v2/support/requests"

  # ── Chat ────────────────────────────────────────────────────────────────
  echo ""
  echo -e "${YELLOW}→${NC} Chat service"
  auth_check "GET  /api/v2/chats"                     200 "$BASE_URL/api/v2/chats"
  auth_check "GET  /api/v2/messages/favorites"        200 "$BASE_URL/api/v2/messages/favorites"
  auth_check "GET  /api/v2/messages/search?q=hello"   200 "$BASE_URL/api/v2/messages/search?q=hello"
fi

# ── Edge inline handlers ──────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→${NC} Edge inline handlers"
check "GET  /api/v2/calls/ice-servers" 200 "$BASE_URL/api/v2/calls/ice-servers"
check "GET  /api/v2/emojis"            200 "$BASE_URL/api/v2/emojis"

# ── Auth enforcement ─────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→${NC} Auth enforcement (expect 401)"
check "GET  /api/v2/users/me (no token)"  401 "$BASE_URL/api/v2/users/me"
check "GET  /api/v2/chats  (no token)"    401 "$BASE_URL/api/v2/chats"

# ── 404 ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}→${NC} Unknown routes (expect 404)"
check "GET  /api/v2/nonexistent"  404 "$BASE_URL/api/v2/nonexistent"

# ── Cleanup ───────────────────────────────────────────────────────────────────
if [[ -n "${TOKEN:-}" ]]; then
  curl -s -X POST "$BASE_URL/api/v2/auth/logout" \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
TOTAL=$((PASS+FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}All $TOTAL checks passed${NC}"
else
  echo -e "${RED}$FAIL/$TOTAL checks FAILED${NC}"
  exit 1
fi
echo "══════════════════════════════════════════════════"
