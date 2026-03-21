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
