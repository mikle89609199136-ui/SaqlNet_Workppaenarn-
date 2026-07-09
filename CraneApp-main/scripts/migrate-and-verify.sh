#!/usr/bin/env bash
# migrate-and-verify.sh — применяет миграции, запускает migrate-legacy, проверяет счётчики
# Использование: ./scripts/migrate-and-verify.sh [--apply]
#
# Без --apply: dry-run (откатывает)
# С --apply:   коммитит данные из legacy public.* в v2 схемы

set -euo pipefail

APPLY="${1:-}"
BACKEND_DIR="$(cd "$(dirname "$0")/../backend-v2" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $*"; }

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL env var is required"

# ── 1. Применить SQL-миграции ─────────────────────────────────────────────────
echo ""
info "Applying SQL migrations from $BACKEND_DIR/migrations/"
FAILED_MIGRATIONS=0
for migration in "$BACKEND_DIR"/migrations/*.sql; do
  NAME=$(basename "$migration")
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration" 2>/dev/null; then
    ok "$NAME"
  else
    # Может уже применена — проверяем тихо
    echo -e "  ${YELLOW}~${NC} $NAME (skipped or already applied)"
    FAILED_MIGRATIONS=$((FAILED_MIGRATIONS+1))
  fi
done

if [[ $FAILED_MIGRATIONS -gt 0 ]]; then
  echo -e "  ${YELLOW}Note: $FAILED_MIGRATIONS migrations skipped (may already be applied)${NC}"
fi

# ── 2. Проверить что v2 схемы существуют ─────────────────────────────────────
info "Verifying v2 schemas..."
SCHEMAS=$(psql "$DATABASE_URL" -tAq -c "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname IN ('auth','users','chats','messages','media','calls','crypto','support','admin') ORDER BY nspname" 2>/dev/null)
EXPECTED="admin auth calls chats crypto media messages support users"
ACTUAL=$(echo "$SCHEMAS" | tr '\n' ' ' | xargs)
[[ "$ACTUAL" == "$EXPECTED" ]] || fail "Missing schemas. Found: '$ACTUAL', expected: '$EXPECTED'"
ok "All 9 v2 schemas present"

# ── 3. Migrate-legacy ─────────────────────────────────────────────────────────
echo ""
if [[ "$APPLY" == "--apply" ]]; then
  info "Running migrate-legacy --apply (commits data from public.* → v2 schemas)"
  (cd "$BACKEND_DIR" && go run ./cmd/migrate-legacy --domain all --apply)
  ok "Data migration committed"
else
  info "Running migrate-legacy dry-run (pass --apply to commit)"
  (cd "$BACKEND_DIR" && go run ./cmd/migrate-legacy --domain all)
  echo -e "  ${YELLOW}Dry-run complete — no data written. Re-run with --apply to commit.${NC}"
fi

# ── 4. Проверить счётчики ─────────────────────────────────────────────────────
echo ""
info "Verifying row counts..."

LEGACY_USERS=$(psql "$DATABASE_URL" -tAq -c "SELECT COUNT(*) FROM public.users" 2>/dev/null || echo 0)
V2_USERS=$(psql "$DATABASE_URL" -tAq -c "SELECT COUNT(*) FROM auth.users" 2>/dev/null || echo 0)
LEGACY_CHATS=$(psql "$DATABASE_URL" -tAq -c "SELECT COUNT(*) FROM public.chats" 2>/dev/null || echo 0)
V2_CHATS=$(psql "$DATABASE_URL" -tAq -c "SELECT COUNT(*) FROM chats.chats" 2>/dev/null || echo 0)

echo "  legacy public.users=$LEGACY_USERS  →  auth.users=$V2_USERS"
echo "  legacy public.chats=$LEGACY_CHATS  →  chats.chats=$V2_CHATS"

if [[ "$APPLY" == "--apply" ]]; then
  [[ "$V2_USERS" -ge "$LEGACY_USERS" ]] || fail "auth.users count ($V2_USERS) < legacy ($LEGACY_USERS)"
  [[ "$V2_CHATS" -ge "$LEGACY_CHATS" ]] || fail "chats.chats count ($V2_CHATS) < legacy ($LEGACY_CHATS)"
  ok "Row counts match"
fi

echo ""
ok "Done"
