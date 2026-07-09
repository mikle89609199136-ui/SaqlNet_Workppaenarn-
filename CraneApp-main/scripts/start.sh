#!/bin/bash

set -a
source .env
set +a

# Helper function to extract port from values like ":8080" or "8080"
get_port() {
  echo $1 | tr -d ':'
}

kill_port() {
  local port=$(get_port $1)
  if [ -n "$port" ]; then
    PID=$(lsof -t -i:$port -sTCP:LISTEN)
    if [ -n "$PID" ]; then
      echo "Port $port is occupied by PID $PID. Killing it..."
      kill -9 $PID
    fi
  fi
}

echo "Checking and freeing ports..."
kill_port ${EDGE_ADDR:-8080}
kill_port ${AUTH_ADDR:-8081}
kill_port ${USER_ADDR:-8082}
kill_port ${CHAT_ADDR:-8083}
kill_port 5005

echo "Starting frontend build..."
npm run build:react

echo "Starting Crypto Rust service..."
cd server/crypto-rust
cargo build --release
./target/release/crypto-rust &
cd ../..

echo "Starting Go microservices..."
cd backend-v2
go build -o edge ./cmd/edge
go build -o auth ./cmd/auth
go build -o user ./cmd/user
go build -o chat ./cmd/chat

./auth &
./user &
./chat &
./edge &
cd ..

echo "Application is now running entirely on Go/Rust backend!"
wait

