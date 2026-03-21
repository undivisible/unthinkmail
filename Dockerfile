FROM alpine:latest
WORKDIR /app
COPY zig-out/bin/purelymail-mcp-server .
ENTRYPOINT ["./purelymail-mcp-server"]
