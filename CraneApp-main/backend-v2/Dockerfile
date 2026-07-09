FROM golang:1.26-alpine AS build

ARG SERVICE
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/service ./cmd/${SERVICE}

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/service /service
COPY --from=build /src/migrations /migrations
WORKDIR /
USER nonroot:nonroot
ENTRYPOINT ["/service"]
