FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY zig-out/bin/purelymail-mcp-server .
EXPOSE 8080
CMD ["./purelymail-mcp-server"]
