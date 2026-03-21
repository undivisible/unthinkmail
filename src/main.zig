// HTTP JSON-RPC server for unthinkmail MCP
// Listens on :8080, accepts POST / with JSON-RPC body
// Worker injects "_credentials" field into every JSON-RPC request
const std = @import("std");
const json = std.json;
const mem = std.mem;

const Config = struct {
    imap_host: []const u8,
    imap_port: u16,
    imap_user: []const u8,
    imap_pass: []const u8,
    smtp_host: []const u8,
    smtp_port: u16,
};

// Per-instance server state (one container = one user)
// Mutex protects imap/config — IMAP operations block for network I/O so we
// serialize them, but the HTTP layer runs one thread per connection so health
// checks and fast paths (initialize, ping) are never blocked by IMAP.
const ServerState = struct {
    allocator: mem.Allocator,
    mutex: std.Thread.Mutex = .{},
    imap: ?*ImapConn = null,
    config: ?Config = null,

    fn deinit(self: *ServerState) void {
        self.mutex.lock();
        defer self.mutex.unlock();
        if (self.imap) |c| {
            c.deinit(self.allocator);
            self.allocator.destroy(c);
            self.imap = null;
        }
    }
};

const ConnArg = struct {
    allocator: mem.Allocator,
    conn: std.net.Server.Connection,
    state: *ServerState,
};

fn connThread(arg: *ConnArg) void {
    defer arg.allocator.destroy(arg);
    handleConn(arg.allocator, arg.conn, arg.state) catch |err| {
        std.log.err("connection error: {}", .{err});
    };
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    var tsa = std.heap.ThreadSafeAllocator{ .child_allocator = gpa.allocator() };
    const allocator = tsa.allocator();

    var state = ServerState{ .allocator = allocator };
    defer state.deinit();

    const address = try std.net.Address.parseIp("0.0.0.0", 8080);
    var tcp_server = try address.listen(.{ .reuse_address = true });
    defer tcp_server.deinit();

    std.log.info("unthinkmail MCP server listening on :8080", .{});

    while (true) {
        const conn = try tcp_server.accept();
        const arg = try allocator.create(ConnArg);
        arg.* = .{ .allocator = allocator, .conn = conn, .state = &state };
        const t = std.Thread.spawn(.{}, connThread, .{arg}) catch |err| {
            std.log.err("failed to spawn thread: {}", .{err});
            allocator.destroy(arg);
            conn.stream.close();
            continue;
        };
        t.detach();
    }
}

// Read/write buffer sizes for HTTP layer
const HTTP_BUF = 65536;

fn handleConn(allocator: mem.Allocator, conn: std.net.Server.Connection, state: *ServerState) !void {
    defer conn.stream.close();

    var rd_buf: [HTTP_BUF]u8 = undefined;
    var wr_buf: [HTTP_BUF]u8 = undefined;
    var rd = conn.stream.reader(&rd_buf);
    var wr = conn.stream.writer(&wr_buf);
    var srv = std.http.Server.init(rd.interface(), &wr.interface);

    // Handle keep-alive requests on the same connection
    while (true) {
        var request = srv.receiveHead() catch |err| switch (err) {
            error.HttpConnectionClosing => return,
            else => return err,
        };

        // MCP clients sometimes probe with GET — return server info
        if (request.head.method == .GET) {
            try request.respond(
                \\{"name":"unthinkmail","version":"1.0.0","protocolVersion":"2024-11-05"}
            , .{
                .status = .ok,
                .extra_headers = &.{
                    .{ .name = "content-type", .value = "application/json" },
                    .{ .name = "access-control-allow-origin", .value = "*" },
                },
            });
            if (!request.head.keep_alive) break;
            continue;
        }

        if (request.head.method == .OPTIONS) {
            try request.respond("", .{
                .status = .no_content,
                .extra_headers = &.{
                    .{ .name = "access-control-allow-origin", .value = "*" },
                    .{ .name = "access-control-allow-methods", .value = "GET, POST, OPTIONS" },
                    .{ .name = "access-control-allow-headers", .value = "Content-Type, Authorization" },
                },
            });
            if (!request.head.keep_alive) break;
            continue;
        }

        if (request.head.method != .POST) {
            try request.respond("Method Not Allowed", .{ .status = .method_not_allowed });
            continue;
        }

        // Read request body
        const content_len = request.head.content_length orelse 0;
        if (content_len > 4 * 1024 * 1024) {
            try request.respond("Request Too Large", .{ .status = .payload_too_large });
            continue;
        }

        var body_rd_buf: [4096]u8 = undefined;
        const body_io = request.readerExpectNone(&body_rd_buf);
        const body = body_io.readAlloc(allocator, content_len) catch {
            try request.respond("Bad Request", .{ .status = .bad_request });
            continue;
        };
        defer allocator.free(body);

        const response = handleRpc(allocator, body, state) catch |err| blk: {
            std.log.err("RPC error: {}", .{err});
            break :blk try allocPrint(allocator,
                \\{{"jsonrpc":"2.0","error":{{"code":-32603,"message":"Internal error"}}}}
            );
        };
        defer allocator.free(response);

        try request.respond(response, .{
            .status = .ok,
            .extra_headers = &.{
                .{ .name = "content-type", .value = "application/json" },
                .{ .name = "access-control-allow-origin", .value = "*" },
            },
        });

        if (!request.head.keep_alive) break;
    }
}

fn allocPrint(allocator: mem.Allocator, comptime fmt: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, fmt, .{});
}

fn handleRpc(allocator: mem.Allocator, body: []const u8, state: *ServerState) ![]u8 {
    const parsed = json.parseFromSlice(json.Value, allocator, body, .{}) catch {
        return errResp(allocator, null, -32700, "Parse error");
    };
    defer parsed.deinit();

    if (parsed.value != .object) return errResp(allocator, null, -32700, "Expected object");
    const obj = parsed.value.object;

    const id = obj.get("id");
    const method_v = obj.get("method") orelse return errResp(allocator, id, -32600, "Missing method");
    if (method_v != .string) return errResp(allocator, id, -32600, "Method must be string");
    const method = method_v.string;
    const params = obj.get("params");

    // Fast paths — no state access needed, no lock required
    if (mem.startsWith(u8, method, "notifications/")) {
        return allocator.dupe(u8, "{}");
    }
    if (mem.eql(u8, method, "initialize")) {
        return okResp(allocator, id,
            \\{"protocolVersion":"2024-11-05","serverInfo":{"name":"unthinkmail","version":"1.0.0"},"capabilities":{"tools":{"listChanged":false}}}
        );
    }
    if (mem.eql(u8, method, "ping")) {
        return okResp(allocator, id, "{}");
    }
    if (mem.eql(u8, method, "tools/list")) {
        return toolsList(allocator, id);
    }

    // State-touching paths — serialize with mutex (IMAP ops block on network)
    state.mutex.lock();
    defer state.mutex.unlock();

    if (obj.get("_credentials")) |creds| {
        if (creds == .object) applyCredentials(allocator, state, creds.object) catch |err| {
            std.log.err("credentials error: {}", .{err});
        };
    }

    if (mem.eql(u8, method, "tools/call")) {
        if (state.imap == null) {
            return errResp(allocator, id, -32002, "No credentials. Configure IMAP via the hub first.");
        }
        return toolsCall(allocator, id, state.imap.?, state.config.?, params);
    } else {
        return errResp(allocator, id, -32601, "Method not found");
    }
}

fn applyCredentials(allocator: mem.Allocator, state: *ServerState, creds: json.ObjectMap) !void {
    const imap_host = strField(creds, "imap_host") orelse return;
    const imap_user = strField(creds, "imap_user") orelse return;
    const imap_pass = strField(creds, "imap_pass") orelse return;
    const smtp_host = strField(creds, "smtp_host") orelse "";
    const imap_port = portField(creds, "imap_port", 993);
    const smtp_port = portField(creds, "smtp_port", 465);

    // Same creds → reuse connection
    if (state.config) |cfg| {
        if (mem.eql(u8, cfg.imap_host, imap_host) and
            mem.eql(u8, cfg.imap_user, imap_user) and
            cfg.imap_port == imap_port)
        {
            return;
        }
    }

    // Reset connection
    if (state.imap) |c| {
        c.deinit(allocator);
        allocator.destroy(c);
        state.imap = null;
    }

    state.config = Config{
        .imap_host = try allocator.dupe(u8, imap_host),
        .imap_port = imap_port,
        .imap_user = try allocator.dupe(u8, imap_user),
        .imap_pass = try allocator.dupe(u8, imap_pass),
        .smtp_host = try allocator.dupe(u8, smtp_host),
        .smtp_port = smtp_port,
    };

    const conn = try allocator.create(ImapConn);
    conn.* = ImapConn.init(state.config.?);
    state.imap = conn;
}

fn strField(obj: json.ObjectMap, key: []const u8) ?[]const u8 {
    const v = obj.get(key) orelse return null;
    return if (v == .string) v.string else null;
}

fn portField(obj: json.ObjectMap, key: []const u8, default: u16) u16 {
    const v = obj.get(key) orelse return default;
    return switch (v) {
        .integer => @intCast(v.integer),
        .string => std.fmt.parseInt(u16, v.string, 10) catch default,
        else => default,
    };
}

// --- JSON-RPC response helpers ---

fn idStr(allocator: mem.Allocator, id: ?json.Value) ![]u8 {
    return if (id) |v| json.Stringify.valueAlloc(allocator, v, .{}) else allocator.dupe(u8, "null");
}

fn okResp(allocator: mem.Allocator, id: ?json.Value, result_json: []const u8) ![]u8 {
    const id_s = try idStr(allocator, id);
    defer allocator.free(id_s);
    return std.fmt.allocPrint(allocator,
        "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{s}}}",
        .{ id_s, result_json },
    );
}

fn errResp(allocator: mem.Allocator, id: ?json.Value, code: i32, msg: []const u8) ![]u8 {
    const id_s = try idStr(allocator, id);
    defer allocator.free(id_s);
    const msg_s = try json.Stringify.valueAlloc(allocator, json.Value{ .string = msg }, .{});
    defer allocator.free(msg_s);
    return std.fmt.allocPrint(allocator,
        "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"error\":{{\"code\":{d},\"message\":{s}}}}}",
        .{ id_s, code, msg_s },
    );
}

// --- Tool definitions ---

fn toolsList(allocator: mem.Allocator, id: ?json.Value) ![]u8 {
    return okResp(allocator, id,
        \\{"tools":[
        \\{"name":"listfolders","description":"List all IMAP mail folders / mailboxes","inputSchema":{"type":"object","properties":{},"required":[]}},
        \\{"name":"searchmessages","description":"Search messages in a mail folder using IMAP search criteria (e.g. ALL, UNSEEN, FROM \"user@example.com\", SUBJECT \"hello\", SINCE 1-Jan-2024)","inputSchema":{"type":"object","properties":{"folder":{"type":"string","description":"Folder to search, e.g. INBOX"},"query":{"type":"string","description":"IMAP search criteria"}},"required":["folder"]}},
        \\{"name":"getmessage","description":"Fetch the full content of a message by its UID","inputSchema":{"type":"object","properties":{"folder":{"type":"string","description":"Folder containing the message"},"uid":{"type":"string","description":"Message UID from searchmessages"}},"required":["folder","uid"]}},
        \\{"name":"deletemessage","description":"Permanently delete a message by UID","inputSchema":{"type":"object","properties":{"folder":{"type":"string","description":"Folder containing the message"},"uid":{"type":"string","description":"Message UID"}},"required":["folder","uid"]}},
        \\{"name":"movemessage","description":"Move a message to another folder","inputSchema":{"type":"object","properties":{"folder":{"type":"string","description":"Source folder"},"uid":{"type":"string","description":"Message UID"},"destination":{"type":"string","description":"Destination folder name"}},"required":["folder","uid","destination"]}}
        \\]}
    );
}

// MCP tools/call response: wrap JSON value in content envelope
fn toolResult(allocator: mem.Allocator, id: ?json.Value, value: json.Value) ![]u8 {
    const text = try json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(text);
    const id_s = try idStr(allocator, id);
    defer allocator.free(id_s);
    const text_s = try json.Stringify.valueAlloc(allocator, json.Value{ .string = text }, .{});
    defer allocator.free(text_s);
    return std.fmt.allocPrint(allocator,
        "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"content\":[{{\"type\":\"text\",\"text\":{s}}}],\"isError\":false}}}}",
        .{ id_s, text_s },
    );
}

fn toolError(allocator: mem.Allocator, id: ?json.Value, msg: []const u8) ![]u8 {
    const id_s = try idStr(allocator, id);
    defer allocator.free(id_s);
    const msg_s = try json.Stringify.valueAlloc(allocator, json.Value{ .string = msg }, .{});
    defer allocator.free(msg_s);
    return std.fmt.allocPrint(allocator,
        "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"content\":[{{\"type\":\"text\",\"text\":{s}}}],\"isError\":true}}}}",
        .{ id_s, msg_s },
    );
}

fn toolsCall(allocator: mem.Allocator, id: ?json.Value, imap: *ImapConn, config: Config, params: ?json.Value) ![]u8 {
    _ = config;
    if (params == null or params.? != .object) return errResp(allocator, id, -32602, "Invalid params");
    const p = params.?.object;

    const name_v = p.get("name") orelse return errResp(allocator, id, -32602, "Missing name");
    if (name_v != .string) return errResp(allocator, id, -32602, "name must be string");
    const name = name_v.string;
    const args = if (p.get("arguments")) |a| (if (a == .object) a.object else json.ObjectMap.init(allocator)) else json.ObjectMap.init(allocator);

    if (mem.eql(u8, name, "listfolders")) {
        const result = imap.listFolders(allocator) catch |e| return toolError(allocator, id, @errorName(e));
        return toolResult(allocator, id, result);
    } else if (mem.eql(u8, name, "searchmessages")) {
        const query = strField(args, "query") orelse "ALL";
        const folder = strField(args, "folder") orelse "INBOX";
        const result = imap.searchMessages(allocator, folder, query) catch |e| return toolError(allocator, id, @errorName(e));
        return toolResult(allocator, id, result);
    } else if (mem.eql(u8, name, "getmessage")) {
        const uid = strField(args, "uid") orelse return errResp(allocator, id, -32602, "Missing uid");
        const folder = strField(args, "folder") orelse "INBOX";
        const result = imap.getMessage(allocator, folder, uid) catch |e| return toolError(allocator, id, @errorName(e));
        return toolResult(allocator, id, result);
    } else if (mem.eql(u8, name, "deletemessage")) {
        const uid = strField(args, "uid") orelse return errResp(allocator, id, -32602, "Missing uid");
        const folder = strField(args, "folder") orelse "INBOX";
        imap.deleteMessage(allocator, folder, uid) catch |e| return toolError(allocator, id, @errorName(e));
        var res = json.ObjectMap.init(allocator);
        try res.put("deleted", json.Value{ .bool = true });
        return toolResult(allocator, id, json.Value{ .object = res });
    } else if (mem.eql(u8, name, "movemessage")) {
        const uid = strField(args, "uid") orelse return errResp(allocator, id, -32602, "Missing uid");
        const folder = strField(args, "folder") orelse "INBOX";
        const dest = strField(args, "destination") orelse return errResp(allocator, id, -32602, "Missing destination");
        imap.moveMessage(allocator, folder, uid, dest) catch |e| return toolError(allocator, id, @errorName(e));
        var res = json.ObjectMap.init(allocator);
        try res.put("moved", json.Value{ .bool = true });
        return toolResult(allocator, id, json.Value{ .object = res });
    } else {
        return errResp(allocator, id, -32601, "Unknown tool");
    }
}


// --- IMAP connection via openssl s_client subprocess ---
// Using system OpenSSL avoids TLS compatibility issues with Zig's pure-Zig TLS
// implementation. Each ImapConn spawns one openssl process; stdin/stdout are pipes.

const ImapConn = struct {
    config: Config,
    authenticated: bool = false,
    tag_counter: usize = 0,
    child: ?std.process.Child = null,

    fn init(config: Config) ImapConn {
        return .{ .config = config };
    }

    fn deinit(self: *ImapConn, allocator: mem.Allocator) void {
        _ = allocator;
        self.killChild();
    }

    fn killChild(self: *ImapConn) void {
        if (self.child) |*c| {
            if (c.stdin) |f| f.close();
            if (c.stdout) |f| f.close();
            _ = c.wait() catch {};
            self.child = null;
            self.authenticated = false;
        }
    }

    fn nextTag(self: *ImapConn, allocator: mem.Allocator) ![]u8 {
        self.tag_counter += 1;
        return std.fmt.allocPrint(allocator, "T{d}", .{self.tag_counter});
    }

    fn ensureConnected(self: *ImapConn, allocator: mem.Allocator) !void {
        if (self.authenticated) return;

        self.killChild();

        const connect_str = try std.fmt.allocPrint(
            allocator, "{s}:{d}", .{ self.config.imap_host, self.config.imap_port },
        );
        defer allocator.free(connect_str);

        std.log.info("IMAP: spawning openssl s_client -> {s}", .{connect_str});

        var child = std.process.Child.init(&.{
            "openssl", "s_client",
            "-connect", connect_str,
            "-quiet",   // suppress SSL session info on stdout
            "-crlf",    // translate LF to CRLF for IMAP commands
        }, allocator);
        child.stdin_behavior  = .Pipe;
        child.stdout_behavior = .Pipe;
        child.stderr_behavior = .Ignore;

        child.spawn() catch |e| {
            std.log.err("IMAP: openssl spawn failed: {}", .{e});
            return error.ImapConnectFailed;
        };
        self.child = child;

            // Read greeting (first line from server)
        const greeting = self.readLine(allocator) catch |e| {
            std.log.err("IMAP: greeting read failed: {}", .{e});
            self.killChild();
            return error.ImapConnectFailed;
        };
        defer allocator.free(greeting);
        std.log.info("IMAP: greeting: {s}", .{greeting[0..@min(greeting.len, 80)]});

        // LOGIN
        const tag = try self.nextTag(allocator);
        defer allocator.free(tag);
        const cmd = try std.fmt.allocPrint(allocator, "{s} LOGIN \"{s}\" \"{s}\"\r\n", .{
            tag, self.config.imap_user, self.config.imap_pass,
        });
        defer allocator.free(cmd);

        self.child.?.stdin.?.writeAll(cmd) catch |e| {
            std.log.err("IMAP: LOGIN write failed: {}", .{e});
            self.killChild();
            return error.ImapConnectFailed;
        };

        const resp = self.readResp(allocator, tag) catch |e| {
            std.log.err("IMAP: login read failed: {}", .{e});
            self.killChild();
            return error.ImapConnectFailed;
        };
        defer allocator.free(resp);

        const tagged = lastTaggedLine(resp, tag);
        std.log.info("IMAP: login resp: {s}", .{tagged[0..@min(tagged.len, 60)]});
        if (!mem.startsWith(u8, tagged, "OK")) {
            self.killChild();
            return error.ImapAuthFailed;
        }
        self.authenticated = true;
        std.log.info("IMAP: authenticated ok", .{});
    }

    // Read one byte directly from the pipe (no buffering — kernel pipe retains state)
    fn pipeByte(self: *ImapConn) !u8 {
        const fd = self.child.?.stdout.?.handle;
        var b: u8 = undefined;
        const n = try std.posix.read(fd, @as(*[1]u8, &b));
        if (n == 0) return error.EndOfStream;
        return b;
    }

    // Read a single line from stdout (up to \n, inclusive)
    fn readLine(self: *ImapConn, allocator: mem.Allocator) ![]u8 {
        var buf = std.ArrayListUnmanaged(u8){};
        while (true) {
            const byte = try self.pipeByte();
            try buf.append(allocator, byte);
            if (byte == '\n' or buf.items.len > 8192) break;
        }
        return buf.toOwnedSlice(allocator);
    }

    fn sendCmd(self: *ImapConn, allocator: mem.Allocator, cmd: []const u8) ![]u8 {
        self.child.?.stdin.?.writeAll(cmd) catch |e| {
            std.log.err("IMAP: sendCmd write failed: {}", .{e});
            return e;
        };
        const tag_end = mem.indexOfScalar(u8, cmd, ' ') orelse cmd.len;
        const tag = cmd[0..tag_end];
        return self.readResp(allocator, tag);
    }

    fn readResp(self: *ImapConn, allocator: mem.Allocator, tag: []const u8) ![]u8 {
        var buf = std.ArrayListUnmanaged(u8){};

        while (true) {
            // Read one line at a time
            var line_buf: [65536]u8 = undefined;
            var line_len: usize = 0;
            while (line_len < line_buf.len) {
                const byte = self.pipeByte() catch |e| {
                    if (buf.items.len > 0) break; // partial response ok
                    return e;
                };
                line_buf[line_len] = byte;
                line_len += 1;
                if (byte == '\n') break;
            }
            if (line_len == 0) break;
            try buf.appendSlice(allocator, line_buf[0..line_len]);

            // Tagged response line signals end
            const line = mem.trimRight(u8, line_buf[0..line_len], "\r\n");
            if (line.len > tag.len and mem.startsWith(u8, line, tag) and line[tag.len] == ' ') break;
            if (buf.items.len > 16 * 1024 * 1024) break;
        }
        return buf.toOwnedSlice(allocator);
    }

    fn lastTaggedLine(resp: []const u8, tag: []const u8) []const u8 {
        var lines = mem.splitScalar(u8, resp, '\n');
        var last: []const u8 = "";
        while (lines.next()) |line| {
            const trimmed = mem.trimRight(u8, line, "\r");
            if (mem.startsWith(u8, trimmed, tag)) last = trimmed[tag.len + 1 ..];
        }
        return last;
    }

    pub fn listFolders(self: *ImapConn, allocator: mem.Allocator) !json.Value {
        try self.ensureConnected(allocator);
        const tag = try self.nextTag(allocator);
        defer allocator.free(tag);

        const cmd = try std.fmt.allocPrint(allocator, "{s} LIST \"\" \"*\"\r\n", .{tag});
        defer allocator.free(cmd);
        const resp = try self.sendCmd(allocator, cmd);
        defer allocator.free(resp);

        var list = json.Array.init(allocator);
        var lines = mem.splitScalar(u8, resp, '\n');
        while (lines.next()) |line| {
            const trimmed = mem.trimRight(u8, line, "\r");
            if (!mem.startsWith(u8, trimmed, "* LIST")) continue;
            const lq = mem.lastIndexOfScalar(u8, trimmed, '"') orelse continue;
            const pq = mem.lastIndexOfScalar(u8, trimmed[0..lq], '"') orelse continue;
            try list.append(json.Value{ .string = try allocator.dupe(u8, trimmed[pq + 1 .. lq]) });
        }

        var result = json.ObjectMap.init(allocator);
        try result.put("folders", json.Value{ .array = list });
        return json.Value{ .object = result };
    }

    pub fn searchMessages(self: *ImapConn, allocator: mem.Allocator, folder: []const u8, query: []const u8) !json.Value {
        try self.ensureConnected(allocator);

        // SELECT
        const stag = try self.nextTag(allocator);
        defer allocator.free(stag);
        const scmd = try std.fmt.allocPrint(allocator, "{s} SELECT \"{s}\"\r\n", .{ stag, folder });
        defer allocator.free(scmd);
        const sresp = try self.sendCmd(allocator, scmd);
        defer allocator.free(sresp);

        // SEARCH
        const tag = try self.nextTag(allocator);
        defer allocator.free(tag);
        const cmd = try std.fmt.allocPrint(allocator, "{s} SEARCH {s}\r\n", .{ tag, query });
        defer allocator.free(cmd);
        const resp = try self.sendCmd(allocator, cmd);
        defer allocator.free(resp);

        var list = json.Array.init(allocator);
        var lines = mem.splitScalar(u8, resp, '\n');
        while (lines.next()) |line| {
            const trimmed = mem.trimRight(u8, line, "\r");
            if (!mem.startsWith(u8, trimmed, "* SEARCH")) continue;
            var parts = mem.splitScalar(u8, mem.trim(u8, trimmed[8..], " "), ' ');
            while (parts.next()) |part| {
                if (part.len > 0) try list.append(json.Value{ .string = try allocator.dupe(u8, part) });
            }
        }

        var result = json.ObjectMap.init(allocator);
        try result.put("uids", json.Value{ .array = list });
        try result.put("folder", json.Value{ .string = try allocator.dupe(u8, folder) });
        return json.Value{ .object = result };
    }

    pub fn getMessage(self: *ImapConn, allocator: mem.Allocator, folder: []const u8, uid: []const u8) !json.Value {
        try self.ensureConnected(allocator);

        const stag = try self.nextTag(allocator);
        defer allocator.free(stag);
        const scmd = try std.fmt.allocPrint(allocator, "{s} SELECT \"{s}\"\r\n", .{ stag, folder });
        defer allocator.free(scmd);
        const sresp = try self.sendCmd(allocator, scmd);
        defer allocator.free(sresp);

        const tag = try self.nextTag(allocator);
        defer allocator.free(tag);
        const cmd = try std.fmt.allocPrint(allocator, "{s} UID FETCH {s} (FLAGS BODY[])\r\n", .{ tag, uid });
        defer allocator.free(cmd);
        const resp = try self.sendCmd(allocator, cmd);
        defer allocator.free(resp);

        var result = json.ObjectMap.init(allocator);
        try result.put("uid", json.Value{ .string = try allocator.dupe(u8, uid) });
        try result.put("raw", json.Value{ .string = try allocator.dupe(u8, resp) });
        return json.Value{ .object = result };
    }

    pub fn deleteMessage(self: *ImapConn, allocator: mem.Allocator, folder: []const u8, uid: []const u8) !void {
        try self.ensureConnected(allocator);

        const stag = try self.nextTag(allocator);
        defer allocator.free(stag);
        const scmd = try std.fmt.allocPrint(allocator, "{s} SELECT \"{s}\"\r\n", .{ stag, folder });
        defer allocator.free(scmd);
        const sresp = try self.sendCmd(allocator, scmd);
        defer allocator.free(sresp);

        const tag = try self.nextTag(allocator);
        defer allocator.free(tag);
        const cmd = try std.fmt.allocPrint(allocator, "{s} UID STORE {s} +FLAGS (\\Deleted)\r\n", .{ tag, uid });
        defer allocator.free(cmd);
        const resp = try self.sendCmd(allocator, cmd);
        defer allocator.free(resp);

        const etag = try self.nextTag(allocator);
        defer allocator.free(etag);
        const ecmd = try std.fmt.allocPrint(allocator, "{s} EXPUNGE\r\n", .{etag});
        defer allocator.free(ecmd);
        const eresp = try self.sendCmd(allocator, ecmd);
        defer allocator.free(eresp);
    }

    pub fn moveMessage(self: *ImapConn, allocator: mem.Allocator, folder: []const u8, uid: []const u8, destination: []const u8) !void {
        try self.ensureConnected(allocator);

        const stag = try self.nextTag(allocator);
        defer allocator.free(stag);
        const scmd = try std.fmt.allocPrint(allocator, "{s} SELECT \"{s}\"\r\n", .{ stag, folder });
        defer allocator.free(scmd);
        const sresp = try self.sendCmd(allocator, scmd);
        defer allocator.free(sresp);

        // Try UID MOVE (RFC 6851)
        const tag = try self.nextTag(allocator);
        defer allocator.free(tag);
        const cmd = try std.fmt.allocPrint(allocator, "{s} UID MOVE {s} \"{s}\"\r\n", .{ tag, uid, destination });
        defer allocator.free(cmd);
        const resp = try self.sendCmd(allocator, cmd);
        defer allocator.free(resp);

        // Fallback: COPY + delete if MOVE not supported
        const tagged = lastTaggedLine(resp, tag);
        if (!mem.startsWith(u8, tagged, "OK")) {
            const ctag = try self.nextTag(allocator);
            defer allocator.free(ctag);
            const ccmd = try std.fmt.allocPrint(allocator, "{s} UID COPY {s} \"{s}\"\r\n", .{ ctag, uid, destination });
            defer allocator.free(ccmd);
            const cresp = try self.sendCmd(allocator, ccmd);
            defer allocator.free(cresp);
            try self.deleteMessage(allocator, folder, uid);
        }
    }
};
