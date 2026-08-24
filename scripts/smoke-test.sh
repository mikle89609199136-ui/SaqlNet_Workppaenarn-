#!/usr/bin/env bash
# smoke-test.sh — быстрая проверка всех сервисов (1 запрос на эндпоинт)
# Использование: ./scripts/smoke-test.sh [BASE_URL]

exec "$(dirname "$0")/smoke/run.sh" "$@"