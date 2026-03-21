# Build stage
FROM alpine:latest AS builder
RUN apk add --no-cache zig --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing
WORKDIR /app
COPY . .
RUN zig build -Doptimize=ReleaseSafe

# Run stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/zig-out/bin/purelymail-mcp-server .
ENTRYPOINT ["./purelymail-mcp-server"]
