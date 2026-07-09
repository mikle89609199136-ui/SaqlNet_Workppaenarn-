#!/usr/bin/env bash
# load-test.sh — нагрузочное тестирование v2 edge gateway
# Использование: ./scripts/load-test.sh [BASE_URL]
# Требует: curl, python3, ab (apache2-utils)

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
TEST_USER="loadtest_lt$$"
TEST_PASS="securepassword_lt1"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $*"; }

# ── Зависимости ──────────────────────────────────────────────────────────────
for cmd in curl python3 ab; do
  command -v "$cmd" >/dev/null || fail "$cmd not found (apt install curl python3 apache2-utils)"
done

# ── Health check ─────────────────────────────────────────────────────────────
info "Checking edge gateway health..."
STATUS=$(curl -sf "$BASE_URL/health/live" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
[[ "$STATUS" == "ok" ]] || fail "Edge gateway not healthy at $BASE_URL"
ok "Gateway up"

# ── Register + Login ─────────────────────────────────────────────────────────
info "Registering test user: $TEST_USER"
REG=$(curl -sf -X POST "$BASE_URL/api/v2/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\",\"firstName\":\"LoadTest\"}" \
  2>/dev/null || true)

if echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'token' in d else 1)" 2>/dev/null; then
  TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  ok "Registered and obtained token"
else
  # Пользователь уже есть — логинимся
  LOGIN=$(curl -sf -X POST "$BASE_URL/api/v2/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}" 2>/dev/null || true)
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || true)
  [[ -n "$TOKEN" ]] || fail "Registration and login both failed. Response: $REG"
  ok "Logged in (user already existed)"
fi

# ── Вспомогательная функция: тест с уникальными IP ───────────────────────────
# $1=label $2=N $3=concurrency $4=method $5=endpoint $6=extra_curl_args...
multi_ip_test() {
  local LABEL="$1" N="$2" CONC="$3" METHOD="$4" ENDPOINT="$5"
  shift 5
  local EXTRA_ARGS=("$@")

  /usr/bin/python3 - "$LABEL" "$N" "$CONC" "$METHOD" "$BASE_URL$ENDPOINT" "$TOKEN" "${EXTRA_ARGS[@]}" <<'PYEOF'
import subprocess, concurrent.futures, sys

label, n, conc, method, url, token = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6]
extra = sys.argv[7:]

def req(i):
    ip = f"10.{(i>>16)&255}.{(i>>8)&255}.{i&255}" if i else "10.0.0.1"
    cmd = ["curl","-s","-o","/dev/null","-w","%{http_code} %{time_total}",
           "-X", method,
           "-H", f"Authorization: Bearer {token}",
           "-H", f"X-Forwarded-For: {ip}"] + extra + [url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    parts = r.stdout.strip().split()
    return (int(parts[0]), float(parts[1]))

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=conc) as ex:
    futs = [ex.submit(req, i) for i in range(n)]
    results = [f.result() for f in concurrent.futures.as_completed(futs)]

codes = [r[0] for r in results]
times = sorted([r[1]*1000 for r in results if r[0] < 500])
ok_count = sum(1 for c in codes if c < 400)
p = lambda pct: times[int(len(times)*pct/100)] if times else 0

status = "✓" if ok_count == n else "✗"
print(f"  {status} {label}: {ok_count}/{n} OK  p50={p(50):.0f}ms  p95={p(95):.0f}ms  p99={p(99):.0f}ms  max={max(times,default=0):.0f}ms")
other = {c: codes.count(c) for c in set(codes) if c >= 400}
if other:
    print(f"    -> non-OK codes: {other}")
if ok_count < n:
    exit(1)
PYEOF
}

# ── ab тест для эндпоинтов без auth (per-IP лимит не мешает) ─────────────────
ab_test() {
  local LABEL="$1" N="$2" CONC="$3" URL="$4"
  local OUT
  OUT=$(ab -n "$N" -c "$CONC" -H "Authorization: Bearer $TOKEN" -q "$URL" 2>&1)
  local RPS P50 P99 FAILED
  RPS=$(echo "$OUT" | grep "Requests per second" | awk '{print $4}')
  P50=$(echo "$OUT" | grep "^ *50%" | awk '{print $2}')
  P99=$(echo "$OUT" | grep "^ *99%" | awk '{print $2}')
  FAILED=$(echo "$OUT" | grep "Failed requests" | awk '{print $3}')
  echo "  ✓ $LABEL: ${RPS} req/s  p50=${P50}ms  p99=${P99}ms  (failed=${FAILED:-0})"
}

echo ""
echo "══════════════════════════════════════════════════"
echo " Load tests — $BASE_URL"
echo "══════════════════════════════════════════════════"

# ── 1. Edge health (baseline) ─────────────────────────────────────────────────
echo ""
info "1. Edge gateway baseline (1000 req, concurrency 50)"
ab_test "GET /health/live" 1000 50 "$BASE_URL/health/live"

# ── 2. Auth service ───────────────────────────────────────────────────────────
echo ""
info "2. Auth service"

# Регистрация: каждый запрос — уникальный пользователь (индекс в имени)
RUN_ID="$(date +%s)"
/usr/bin/python3 - "POST /api/v2/auth/register (Argon2id)" 50 10 "$BASE_URL" "$RUN_ID" <<'PYEOF'
import subprocess, concurrent.futures, sys, json

label, n, conc, base, run_id = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]

def req(i):
    ip = f"10.4.{i//256}.{i%256}"
    username = f"ltb{run_id}{i:03d}"
    body = json.dumps({"username": username, "password": "securepassword1", "firstName": "LT"})
    r = subprocess.run([
        "curl","-s","-o","/dev/null","-w","%{http_code} %{time_total}",
        "-H","Content-Type: application/json",
        "-H",f"X-Forwarded-For: {ip}",
        "-d", body,
        f"{base}/api/v2/auth/register"
    ], capture_output=True, text=True)
    parts = r.stdout.strip().split()
    return (int(parts[0]), float(parts[1]))

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=conc) as ex:
    futs = [ex.submit(req, i) for i in range(n)]
    results = [f.result() for f in concurrent.futures.as_completed(futs)]

codes = [r[0] for r in results]
times = sorted([r[1]*1000 for r in results if r[0] < 400])
ok = sum(1 for c in codes if c in (200, 201))
p = lambda pct: times[int(len(times)*pct/100)] if times else 0
status = "✓" if ok == n else "✗"
print(f"  {status} {label}: {ok}/{n} OK  p50={p(50):.0f}ms  p95={p(95):.0f}ms  p99={p(99):.0f}ms")
other = {c: codes.count(c) for c in set(codes) if c >= 400}
if other: print(f"    -> non-OK codes: {other}")
if ok < n: exit(1)
PYEOF

# login
multi_ip_test "POST /api/v2/auth/login" 100 20 POST /api/v2/auth/login \
  "-H" "Content-Type: application/json" \
  "-d" "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}"

# ── 3. User service ───────────────────────────────────────────────────────────
echo ""
info "3. User service"
multi_ip_test "GET /api/v2/users/me" 500 50 GET /api/v2/users/me
multi_ip_test "GET /api/v2/users/search?q=load" 200 25 GET "/api/v2/users/search?q=load"

# ── 4. Chat service ───────────────────────────────────────────────────────────
echo ""
info "4. Chat service"
multi_ip_test "GET /api/v2/chats" 500 50 GET /api/v2/chats
multi_ip_test "GET /api/v2/messages/favorites" 200 25 GET /api/v2/messages/favorites

# ── 5. Inline handlers ────────────────────────────────────────────────────────
echo ""
info "5. Inline edge handlers"
multi_ip_test "GET /api/v2/calls/ice-servers" 200 25 GET /api/v2/calls/ice-servers
multi_ip_test "GET /api/v2/emojis" 200 25 GET /api/v2/emojis

# ── 6. Rate limiter ───────────────────────────────────────────────────────────
echo ""
info "6. Rate limiter (single IP burst — expect 429s)"
/usr/bin/python3 - "$BASE_URL" "$TOKEN" <<'PYEOF'
import subprocess, concurrent.futures, sys

base, token = sys.argv[1], sys.argv[2]

def req(i):
    r = subprocess.run([
        "curl","-s","-o","/dev/null","-w","%{http_code}",
        "-H",f"Authorization: Bearer {token}",
        f"{base}/api/v2/users/me"
    ], capture_output=True, text=True)
    return int(r.stdout.strip())

with concurrent.futures.ThreadPoolExecutor(max_workers=200) as ex:
    codes = list(concurrent.futures.as_completed([ex.submit(req, i) for i in range(200)]))
    codes = [f.result() for f in codes]

ok  = sum(1 for c in codes if c == 200)
rl  = sum(1 for c in codes if c == 429)
err = sum(1 for c in codes if c not in (200, 429))
print(f"  ✓ 200 OK={ok}  429 rate-limited={rl}  errors={err}  (rate limiter {'working' if rl > 0 else 'NOT triggered — check config'})")
PYEOF

echo ""
echo "══════════════════════════════════════════════════"
ok "All load tests completed"
echo "══════════════════════════════════════════════════"
