// HTTP-to-stdio bridge for MCP server (multi-tenant process pool)
// Accepts POST /mcp with JSON-RPC body, forwards to the Zig binary via stdio
// Each unique credential set gets its own Zig process, keyed by SHA-256 hash
const http = require("http");
const { spawn } = require("child_process");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8080", 10);
const BINARY_PATH = process.env.BINARY_PATH || "./zig-out/bin/purelymail-mcp-server";
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const REAP_INTERVAL_MS = 60 * 1000; // check every 60 seconds
const REQUEST_TIMEOUT_MS = 30000;

// Process pool: Map<hash, {child, stdin, stdout, buffer, pendingResolve, lastUsed}>
const pool = new Map();

function credentialHash(creds) {
	const key = (creds.imap_user || "") + (creds.imap_host || "");
	return crypto.createHash("sha256").update(key).digest("hex");
}

function spawnProcess() {
	const child = spawn(BINARY_PATH, [], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	return child;
}

function sendToProcess(entry, jsonRpcBody) {
	return new Promise((resolve, reject) => {
		entry.pendingResolve = resolve;
		entry.lastUsed = Date.now();
		entry.child.stdin.write(jsonRpcBody + "\n", (err) => {
			if (err) {
				entry.pendingResolve = null;
				reject(err);
			}
		});
		setTimeout(() => {
			if (entry.pendingResolve === resolve) {
				entry.pendingResolve = null;
				reject(new Error("Timeout waiting for MCP response"));
			}
		}, REQUEST_TIMEOUT_MS);
	});
}

function getOrCreateProcess(credentials) {
	const hash = credentialHash(credentials);

	if (pool.has(hash)) {
		const entry = pool.get(hash);
		entry.lastUsed = Date.now();
		return { entry, isNew: false, hash };
	}

	const child = spawnProcess();
	const entry = {
		child,
		buffer: "",
		pendingResolve: null,
		lastUsed: Date.now(),
	};

	child.stdout.on("data", (data) => {
		entry.buffer += data.toString();
		const lines = entry.buffer.split("\n");
		entry.buffer = lines.pop();
		for (const line of lines) {
			if (line.trim() && entry.pendingResolve) {
				const resolve = entry.pendingResolve;
				entry.pendingResolve = null;
				resolve(line);
			}
		}
	});

	child.on("exit", (code) => {
		console.error(`MCP process ${hash.slice(0, 8)} exited with code ${code}`);
		pool.delete(hash);
		if (entry.pendingResolve) {
			const resolve = entry.pendingResolve;
			entry.pendingResolve = null;
			// Reject via the pending promise by calling it with an error-shaped response
			resolve(
				JSON.stringify({
					jsonrpc: "2.0",
					error: { code: -32000, message: `Process exited with code ${code}` },
					id: null,
				}),
			);
		}
	});

	pool.set(hash, entry);
	return { entry, isNew: true, hash };
}

// Idle process reaping: every 60 seconds, kill processes not used in last 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const [hash, entry] of pool) {
		if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
			console.log(`Reaping idle process ${hash.slice(0, 8)}`);
			entry.child.kill();
			pool.delete(hash);
		}
	}
}, REAP_INTERVAL_MS);

const server = http.createServer(async (req, res) => {
	// Health check at GET /health still works
	if (req.method === "GET" && req.url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", poolSize: pool.size }));
		return;
	}

	if (req.method !== "POST") {
		res.writeHead(405);
		res.end("Method not allowed");
		return;
	}

	let body = "";
	for await (const chunk of req) body += chunk;

	try {
		const parsed = JSON.parse(body.trim());

		// Extract _credentials from the body
		const credentials = parsed._credentials;
		if (!credentials) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					jsonrpc: "2.0",
					error: {
						code: -32602,
						message: "Missing _credentials in request body",
					},
					id: parsed.id || null,
				}),
			);
			return;
		}

		// Get or create a process for these credentials
		const { entry, isNew } = getOrCreateProcess(credentials);

		// If new process, send initialize with the credentials
		if (isNew) {
			const initRequest = JSON.stringify({
				jsonrpc: "2.0",
				method: "initialize",
				params: credentials,
				id: "__init__",
			});
			const initResponse = await sendToProcess(entry, initRequest);
			const initParsed = JSON.parse(initResponse);
			if (initParsed.error) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						jsonrpc: "2.0",
						error: {
							code: -32000,
							message: `Initialization failed: ${initParsed.error.message}`,
						},
						id: parsed.id || null,
					}),
				);
				return;
			}
		}

		// Strip _credentials from the original request before forwarding
		delete parsed._credentials;
		const forwardBody = JSON.stringify(parsed);

		const response = await sendToProcess(entry, forwardBody);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(response);
	} catch (err) {
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32000, message: err.message },
				id: null,
			}),
		);
	}
});

// Listen on PORT env var (default 8080)
server.listen(PORT, () => {
	console.log(`MCP HTTP bridge (multi-tenant) listening on port ${PORT}`);
});
