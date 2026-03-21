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
    error: ?JsonRpcError = null,
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

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 2) {
        std.debug.print("Usage: {s} <config-path>\n", .{args[0]});
        std.process.exit(1);
    }

    const config_data = try fs.cwd().readFileAlloc(allocator, args[1], 1024 * 1024);
    defer allocator.free(config_data);
    const config_parsed = try json.parseFromSlice(Config, allocator, config_data, .{});
    defer config_parsed.deinit();
    const config = config_parsed.value;

    const stdin = std.io.getStdIn().reader();
    const stdout = std.io.getStdOut().writer();

    var imap_client = try ImapClient.init(allocator, config);
    defer imap_client.deinit();

    var buf: [1024 * 64]u8 = undefined;
    while (try stdin.readUntilDelimiterOrEof(&buf, '\n')) |line| {
        const parsed = json.parseFromSlice(JsonRpcRequest, allocator, line, .{}) catch |err| {
            try sendError(stdout, null, -32700, "Parse error", null);
            continue;
        };
        defer parsed.deinit();

        const req = parsed.value;

        if (mem.eql(u8, req.method, "tools/list")) {
            try listTools(allocator, stdout, req.id);
        } else if (mem.eql(u8, req.method, "tools/call")) {
            try callTool(allocator, stdout, req.id, &imap_client, config, req.params);
        } else {
            try sendError(stdout, req.id, -32601, "Method not found", null);
        }
    }
}

fn sendResult(writer: anytype, id: ?json.Value, result: json.Value) !void {
    const response = JsonRpcResponse{
        .id = id,
        .result = result,
    };
    try json.stringify(response, .{}, writer);
    try writer.writeAll("\n");
}

fn sendError(writer: anytype, id: ?json.Value, code: i32, message: []const u8, data: ?json.Value) !void {
    const response = JsonRpcResponse{
        .id = id,
        .error = .{
            .code = code,
            .message = message,
            .data = data,
        },
    };
    try json.stringify(response, .{}, writer);
    try writer.writeAll("\n");
}

fn listTools(allocator: mem.Allocator, writer: anytype, id: ?json.Value) !void {
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

fn callTool(allocator: mem.Allocator, writer: anytype, id: ?json.Value, imap_client: *ImapClient, config: Config, params: ?json.Value) !void {
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

    fn sendCommand(self: *ImapClient, tag: []const u8, cmd: []const u8, args: []const []const u8) !void {
        try self.stream.?.writer().print("{s} {s}", .{ tag, cmd });
        for (args) |arg| {
            try self.stream.?.writer().print(" \"{s}\"", .{arg});
        }
        try self.stream.?.writer().writeAll("\r\n");
    }

    fn readResponse(self: *ImapClient, tag: []const u8) ![]const u8 {
        var buf = std.ArrayList(u8).init(self.allocator);
        const reader = self.stream.?.reader();
        while (true) {
            const line = try reader.readUntilDelimiterAlloc(self.allocator, '\n', 1024 * 1024);
            defer self.allocator.free(line);
            try buf.appendSlice(line);
            try buf.append('\n');
            if (mem.startsWith(u8, line, tag)) break;
        }
        return buf.toOwnedSlice();
    }

    pub fn listFolders(self: *ImapClient) !json.Value {
        try self.ensureConnected();
        const tag = try self.nextTag();
        try self.sendCommand(tag, "LIST", &.{ "", "*" });
        const resp = try self.readResponse(tag);
        defer self.allocator.free(resp);

        var list = std.ArrayList(json.Value).init(self.allocator);
        var lines = mem.split(u8, resp, "\n");
        while (lines.next()) |line| {
            if (mem.startsWith(u8, line, "* LIST")) {
                // Parse folder name
                const last_quote = mem.lastIndexOf(u8, line, "\"") orelse continue;
                const prev_quote = mem.lastIndexOf(u8, line[0..last_quote], "\"") orelse continue;
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

        var list = std.ArrayList(json.Value).init(self.allocator);
        var lines = mem.split(u8, resp, "\n");
        while (lines.next()) |line| {
            if (mem.startsWith(u8, line, "* SEARCH")) {
                var parts = mem.split(u8, line[9..], " ");
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
