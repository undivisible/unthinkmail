// HTTP-to-stdio bridge for MCP server
// Accepts POST /mcp with JSON-RPC body, forwards to the Zig binary via stdio
const http = require("http");
const { spawn } = require("child_process");

const CONFIG_PATH = process.env.CONFIG_PATH || "/app/config.json";
const PORT = parseInt(process.env.PORT || "8080", 10);

const child = spawn("./purelymail-mcp-server", [CONFIG_PATH], {
	stdio: ["pipe", "pipe", "inherit"],
});

let pendingResolve = null;
let buffer = "";

child.stdout.on("data", (data) => {
	buffer += data.toString();
	const lines = buffer.split("\n");
	buffer = lines.pop();
	for (const line of lines) {
		if (line.trim() && pendingResolve) {
			const resolve = pendingResolve;
			pendingResolve = null;
			resolve(line);
		}
	}
});

child.on("exit", (code) => {
	console.error(`MCP server exited with code ${code}`);
	process.exit(code || 1);
});

function sendRequest(jsonRpcBody) {
	return new Promise((resolve, reject) => {
		pendingResolve = resolve;
		child.stdin.write(jsonRpcBody + "\n", (err) => {
			if (err) {
				pendingResolve = null;
				reject(err);
			}
		});
		setTimeout(() => {
			if (pendingResolve === resolve) {
				pendingResolve = null;
				reject(new Error("Timeout waiting for MCP response"));
			}
		}, 30000);
	});
}

const server = http.createServer(async (req, res) => {
	if (req.method === "GET" && req.url === "/health") {
		res.writeHead(200);
		res.end("ok");
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
		const response = await sendRequest(body.trim());
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

server.listen(PORT, () => {
	console.log(`MCP HTTP bridge listening on port ${PORT}`);
});
