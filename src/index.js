import { Container } from "@cloudflare/containers";

export class McpContainer extends Container {
	defaultPort = 8080;
	sleepAfter = "5m";

	onStart() {
		console.log("purelymail-mcp-server container started");
	}

	onStop() {
		console.log("purelymail-mcp-server container stopped");
	}

	onError(error) {
		console.error("purelymail-mcp-server error:", error);
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// Health check
		if (url.pathname === "/health") {
			return new Response("ok");
		}

		// Route all MCP requests to a single container instance
		const id = env.MCP_CONTAINER.idFromName("default");
		const stub = env.MCP_CONTAINER.get(id);
		return stub.fetch(request);
	},
};
