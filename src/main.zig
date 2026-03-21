const std = @import("std");
const json = std.json;
const net = std.net;
const mem = std.mem;
const fs = std.fs;
const crypto = std.crypto;

const Config = struct {
    imap_host: []const u8,
    imap_port: u16,
    imap_user: []const u8,
    imap_pass: []const u8,
    smtp_host: []const u8,
    smtp_port: u16,
};

const JsonRpcRequest = struct {
    jsonrpc: []const u8,
    method: []const u8,
    params: ?json.Value = null,
    id: ?json.Value = null,
};

const JsonRpcResponse = struct {
    jsonrpc: []const u8 = "2.0",
    id: ?json.Value = null,
    result: ?json.Value = null,
    @"error": ?JsonRpcError = null,
};

const JsonRpcError = struct {
    code: i32,
    message: []const u8,
    data: ?json.Value = null,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const stdin_file = std.fs.File{ .handle = std.posix.STDIN_FILENO };
    const stdout_file = std.fs.File{ .handle = std.posix.STDOUT_FILENO };
    var stdin_buf: [4096]u8 = undefined;
    var stdout_buf: [4096]u8 = undefined;
    var stdin_reader = stdin_file.reader(&stdin_buf);
    var stdout_writer = stdout_file.writer(&stdout_buf);

    // Start with no IMAP client; initialized via the "initialize" JSON-RPC method
    var imap_client: ?ImapClient = null;
    defer if (imap_client) |*c| c.deinit();

    // Stored config, populated by the "initialize" method
    var stored_config: ?Config = null;

    while (stdin_reader.interface.takeDelimiter('\n') catch null) |line| {
        const parsed = json.parseFromSlice(JsonRpcRequest, allocator, line, .{}) catch {
            try sendError(&stdout_writer.interface, null, -32700, "Parse error", null);
            continue;
        };
        defer parsed.deinit();

        const req = parsed.value;

        if (mem.eql(u8, req.method, "initialize")) {
            // Accept credentials and create the ImapClient
            if (req.params == null or req.params.? != .object) {
                try sendError(&stdout_writer.interface, req.id, -32602, "Invalid params: expected object with credentials", null);
                continue;
            }
            const p = req.params.?.object;

            const imap_host = if (p.get("imap_host")) |v| (if (v == .string) v.string else null) else null;
            const imap_user = if (p.get("imap_user")) |v| (if (v == .string) v.string else null) else null;
            const imap_pass = if (p.get("imap_pass")) |v| (if (v == .string) v.string else null) else null;
            const smtp_host = if (p.get("smtp_host")) |v| (if (v == .string) v.string else null) else null;

            if (imap_host == null or imap_user == null or imap_pass == null or smtp_host == null) {
                try sendError(&stdout_writer.interface, req.id, -32602, "Missing required credential fields", null);
                continue;
            }

            const imap_port: u16 = if (p.get("imap_port")) |v| switch (v) {
                .integer => @intCast(v.integer),
                else => 993,
            } else 993;

            const smtp_port: u16 = if (p.get("smtp_port")) |v| switch (v) {
                .integer => @intCast(v.integer),
                else => 465,
            } else 465;

            // Clean up previous client if re-initializing
            if (imap_client) |*c| c.deinit();

            stored_config = Config{
                .imap_host = imap_host.?,
                .imap_port = imap_port,
                .imap_user = imap_user.?,
                .imap_pass = imap_pass.?,
                .smtp_host = smtp_host.?,
                .smtp_port = smtp_port,
            };

            imap_client = try ImapClient.init(allocator, stored_config.?);

            var result = json.ObjectMap.init(allocator);
            try result.put("status", json.Value{ .string = "ok" });
            try sendResult(&stdout_writer.interface, req.id, json.Value{ .object = result });
        } else if (mem.eql(u8, req.method, "tools/list")) {
            // tools/list works without initialization (no credentials needed)
            try listTools(allocator, &stdout_writer.interface, req.id);
        } else if (mem.eql(u8, req.method, "tools/call")) {
            if (imap_client == null or stored_config == null) {
                try sendError(&stdout_writer.interface, req.id, -32002, "Not initialized: send 'initialize' with credentials first", null);
                continue;
            }
            try callTool(allocator, &stdout_writer.interface, req.id, &imap_client.?, stored_config.?, req.params);
        } else {
            try sendError(&stdout_writer.interface, req.id, -32601, "Method not found", null);
        }
    }
}

fn sendResult(writer: *std.Io.Writer, id: ?json.Value, result: json.Value) !void {
    const response = JsonRpcResponse{
        .id = id,
        .result = result,
    };
    try json.Stringify.value(response, .{}, writer);
    try writer.writeAll("\n");
    try writer.flush();
}

fn sendError(writer: *std.Io.Writer, id: ?json.Value, code: i32, message: []const u8, data: ?json.Value) !void {
    const response = JsonRpcResponse{
        .id = id,
        .@"error" = .{
            .code = code,
            .message = message,
            .data = data,
        },
    };
    try json.Stringify.value(response, .{}, writer);
    try writer.writeAll("\n");
    try writer.flush();
}

fn listTools(allocator: mem.Allocator, writer: *std.Io.Writer, id: ?json.Value) !void {
    const tools_json =
        \\{
        \\  "tools": [
        \\    {"name": "listfolders", "description": "List all IMAP folders", "inputSchema": {"type": "object", "properties": {}}},
        \\    {"name": "searchmessages", "description": "Search messages", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}},
        \\    {"name": "getmessage", "description": "Get message content", "inputSchema": {"type": "object", "properties": {"uid": {"type": "string"}}}},
        \\    {"name": "composedraft", "description": "Compose a draft", "inputSchema": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}}}},
        \\    {"name": "senddraft", "description": "Send a draft", "inputSchema": {"type": "object", "properties": {"draftid": {"type": "string"}}}},
        \\    {"name": "deletemessage", "description": "Delete a message", "inputSchema": {"type": "object", "properties": {"uid": {"type": "string"}}}},
        \\    {"name": "movemessage", "description": "Move a message", "inputSchema": {"type": "object", "properties": {"uid": {"type": "string"}, "destination": {"type": "string"}}}}
        \\  ]
        \\}
    ;
    const tools = try json.parseFromSlice(json.Value, allocator, tools_json, .{});
    defer tools.deinit();
    try sendResult(writer, id, tools.value);
}

fn callTool(allocator: mem.Allocator, writer: *std.Io.Writer, id: ?json.Value, imap_client: *ImapClient, config: Config, params: ?json.Value) !void {
    _ = config;
    if (params == null or params.? != .object) {
        try sendError(writer, id, -32602, "Invalid params", null);
        return;
    }

    const name_val = params.?.object.get("name") orelse return try sendError(writer, id, -32602, "Missing name", null);
    if (name_val != .string) return try sendError(writer, id, -32602, "Name must be string", null);
    const name = name_val.string;

    const args = params.?.object.get("arguments") orelse json.Value{ .object = json.ObjectMap.init(allocator) };

    if (mem.eql(u8, name, "listfolders")) {
        const result = try imap_client.listFolders();
        try sendResult(writer, id, result);
    } else if (mem.eql(u8, name, "searchmessages")) {
        const query = args.object.get("query") orelse return try sendError(writer, id, -32602, "Missing query", null);
        const result = try imap_client.searchMessages(query.string);
        try sendResult(writer, id, result);
    } else if (mem.eql(u8, name, "getmessage")) {
        const uid = args.object.get("uid") orelse return try sendError(writer, id, -32602, "Missing uid", null);
        const result = try imap_client.getMessage(uid.string);
        try sendResult(writer, id, result);
    } else if (mem.eql(u8, name, "composedraft")) {
        // Implement draft creation (maybe just store in a Drafts folder)
    } else if (mem.eql(u8, name, "senddraft")) {
        // Implement SMTP send
    } else if (mem.eql(u8, name, "deletemessage")) {
        // Implement STORE +FLAGS (\Deleted) + EXPUNGE
    } else if (mem.eql(u8, name, "movemessage")) {
        // Implement COPY + STORE +FLAGS (\Deleted) + EXPUNGE
    } else {
        try sendError(writer, id, -32601, "Method not found", null);
    }
}

const ImapClient = struct {
    allocator: mem.Allocator,
    config: Config,
    stream: ?net.Stream = null,
    authenticated: bool = false,
    tag_counter: usize = 0,

    pub fn init(allocator: mem.Allocator, config: Config) !ImapClient {
        return ImapClient{
            .allocator = allocator,
            .config = config,
        };
    }

    pub fn deinit(self: *ImapClient) void {
        if (self.stream) |s| s.close();
    }

    fn ensureConnected(self: *ImapClient) !void {
        if (self.authenticated and self.stream != null) return;

        if (self.stream) |s| s.close();
        self.stream = try net.tcpConnectToHost(self.allocator, self.config.imap_host, self.config.imap_port);

        // Purelymail usually uses 993 (IMAPS) or 143 (IMAP + STARTTLS)
        // For simplicity, let's assume we handle the connection.
        // Zig's std.crypto.tls needs a bundle.

        // This part needs to be more robust for real IMAP
        // Read greeting
        var buf: [1024]u8 = undefined;
        _ = try self.stream.?.read(&buf);

        const tag = try self.nextTag();
        try self.sendCommand(tag, "LOGIN", &.{ self.config.imap_user, self.config.imap_pass });
        _ = try self.readResponse(tag);
        self.authenticated = true;
    }

    fn nextTag(self: *ImapClient) ![]const u8 {
        self.tag_counter += 1;
        return try std.fmt.allocPrint(self.allocator, "A{d}", .{self.tag_counter});
    }

    fn sendCommand(self: *ImapClient, tag: []const u8, cmd: []const u8, cmd_args: []const []const u8) !void {
        var wr_buf: [4096]u8 = undefined;
        var wr = self.stream.?.writer(&wr_buf);
        try wr.interface.print("{s} {s}", .{ tag, cmd });
        for (cmd_args) |arg| {
            try wr.interface.print(" \"{s}\"", .{arg});
        }
        try wr.interface.writeAll("\r\n");
        wr.interface.flush() catch {};
    }

    fn readResponse(self: *ImapClient, tag: []const u8) ![]const u8 {
        var result_buf: std.ArrayList(u8) = .{};
        var rd_buf: [4096]u8 = undefined;
        var rd = self.stream.?.reader(&rd_buf);
        const rdr = rd.interface();
        while (true) {
            const line = rdr.takeDelimiter('\n') catch break orelse break;
            try result_buf.appendSlice(self.allocator, line);
            try result_buf.append(self.allocator, '\n');
            if (mem.startsWith(u8, line, tag)) break;
        }
        return result_buf.toOwnedSlice(self.allocator);
    }

    pub fn listFolders(self: *ImapClient) !json.Value {
        try self.ensureConnected();
        const tag = try self.nextTag();
        try self.sendCommand(tag, "LIST", &.{ "", "*" });
        const resp = try self.readResponse(tag);
        defer self.allocator.free(resp);

        var list = json.Array.init(self.allocator);
        var lines = mem.splitScalar(u8, resp, '\n');
        while (lines.next()) |line| {
            if (mem.startsWith(u8, line, "* LIST")) {
                // Parse folder name
                const last_quote = mem.lastIndexOfScalar(u8, line, '"') orelse continue;
                const prev_quote = mem.lastIndexOfScalar(u8, line[0..last_quote], '"') orelse continue;
                const folder_name = line[prev_quote + 1 .. last_quote];
                try list.append(json.Value{ .string = try self.allocator.dupe(u8, folder_name) });
            }
        }

        var result = json.ObjectMap.init(self.allocator);
        try result.put("folders", json.Value{ .array = list });
        return json.Value{ .object = result };
    }

    pub fn searchMessages(self: *ImapClient, query: []const u8) !json.Value {
        try self.ensureConnected();
        const tag = try self.nextTag();
        // Assume INBOX for now
        try self.sendCommand(tag, "SELECT", &.{"INBOX"});
        _ = try self.readResponse(tag);

        const stag = try self.nextTag();
        try self.sendCommand(stag, "SEARCH", &.{query});
        const resp = try self.readResponse(stag);
        defer self.allocator.free(resp);

        var list = json.Array.init(self.allocator);
        var lines = mem.splitScalar(u8, resp, '\n');
        while (lines.next()) |line| {
            if (mem.startsWith(u8, line, "* SEARCH")) {
                var parts = mem.splitScalar(u8, line[9..], ' ');
                while (parts.next()) |part| {
                    if (part.len > 0) try list.append(json.Value{ .string = try self.allocator.dupe(u8, part) });
                }
            }
        }

        var result = json.ObjectMap.init(self.allocator);
        try result.put("uids", json.Value{ .array = list });
        return json.Value{ .object = result };
    }

    pub fn getMessage(self: *ImapClient, uid: []const u8) !json.Value {
        try self.ensureConnected();
        const tag = try self.nextTag();
        try self.sendCommand(tag, "FETCH", &.{ uid, "RFC822" });
        const resp = try self.readResponse(tag);
        defer self.allocator.free(resp);

        var result = json.ObjectMap.init(self.allocator);
        try result.put("raw", json.Value{ .string = try self.allocator.dupe(u8, resp) });
        return json.Value{ .object = result };
    }
};

const SmtpClient = struct {
    // Implement SMTP with STARTTLS from scratch
};
