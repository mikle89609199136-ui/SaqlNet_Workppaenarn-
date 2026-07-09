.PHONY: test build migrate migrate-legacy-dry-run migrate-legacy smoke load-test

test:
	GOCACHE=/tmp/crane-go-cache go test ./...

build:
	GOCACHE=/tmp/crane-go-cache go build ./cmd/edge ./cmd/auth ./cmd/user ./cmd/chat ./cmd/migrate-legacy ./cmd/migrate

migrate:
	GOCACHE=/tmp/crane-go-cache go run ./cmd/migrate

migrate-legacy-dry-run:
	GOCACHE=/tmp/crane-go-cache go run ./cmd/migrate-legacy

migrate-legacy:
	GOCACHE=/tmp/crane-go-cache go run ./cmd/migrate-legacy --apply

# Smoke-test: быстрая проверка всех эндпоинтов (1 запрос каждый)
smoke:
	../scripts/smoke-test.sh $${BASE_URL:-http://127.0.0.1:3000}

# Нагрузочный тест: 500-1000 запросов с уникальными IP
load-test:
	../scripts/load-test.sh $${BASE_URL:-http://127.0.0.1:3000}

# Полный цикл: миграции + smoke + load
ci: test migrate-legacy-dry-run smoke
