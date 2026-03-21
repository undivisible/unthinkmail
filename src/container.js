import { Container } from "@cloudflare/containers";

export class McpContainer extends Container {
	defaultPort = 8080;
	sleepAfter = "168h";

	onStart() {
		console.log("unthinkmail container started");
	}

	onStop() {
		console.log("unthinkmail container stopped");
	}

	onError(error) {
		console.error("unthinkmail container error:", error);
	}
}
