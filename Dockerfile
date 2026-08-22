FROM node:20-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:react

FROM golang:1.26-alpine AS backend
WORKDIR /src
COPY backend-v2/go.mod backend-v2/go.sum ./
RUN go mod download
COPY backend-v2/ .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/edge ./cmd/edge

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
COPY --from=backend /out/edge /service
COPY --from=frontend /src/dist /dist
ENV PORT=3000
ENV FRONTEND_DIR=/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" >/dev/null || exit 1
ENTRYPOINT ["/service"]
