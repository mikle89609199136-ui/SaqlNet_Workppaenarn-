GOCACHE  := /tmp/crane-go-cache
GO_TEST  := GOCACHE=$(GOCACHE) go test

.PHONY: test test-integration build migrate migrate-legacy-dry-run migrate-legacy smoke load-test

BIN_DIR := bin

test:
	$(GO_TEST) ./...

test-integration:
	$(GO_TEST) -tags=integration -count=1 -timeout=15m ./internal/chat/tests/integration/...

build:
	mkdir -p $(BIN_DIR)
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/edge ./cmd/edge
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/auth ./cmd/auth
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/user ./cmd/user
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/chat ./cmd/chat
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/media ./cmd/media
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/admin ./cmd/admin
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/migrate ./cmd/migrate
	GOCACHE=/tmp/crane-go-cache go build -o $(BIN_DIR)/migrate-legacy ./cmd/migrate-legacy

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
