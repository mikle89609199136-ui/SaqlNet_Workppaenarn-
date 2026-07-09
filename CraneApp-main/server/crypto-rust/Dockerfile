FROM rust:1.94-slim AS build

WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/target/release/crypto-rust /crypto-rust
USER nonroot:nonroot
EXPOSE 5005
ENTRYPOINT ["/crypto-rust"]
