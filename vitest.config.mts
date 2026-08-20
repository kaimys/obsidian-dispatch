import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
	resolve: {
		// The real `obsidian` module only exists inside the app; tests run
		// against a stub that provides the few values our modules import.
		alias: {
			obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)),
		},
	},
});
