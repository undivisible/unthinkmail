FROM alpine:latest
RUN apk add --no-cache nodejs
WORKDIR /app
COPY zig-out/bin/purelymail-mcp-server .
COPY bridge.js .
EXPOSE 8080
CMD ["node", "bridge.js"]
