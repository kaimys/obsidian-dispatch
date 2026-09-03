import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{ ignores: ["main.js", "node_modules/**", "docs/**", "wiki/**", "test/**", "*.config.*", "plugins/**"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},
	{
		// `scripts/` is Node, not plugin code — it is never bundled and never runs
		// inside Obsidian, so `requestUrl` (an Obsidian API) does not exist there
		// and `fetch` is the correct call. The recommended ruleset assumes every
		// file is plugin code; this is the same mismatch that makes these scripts
		// write through `process.stdout` instead of `console`.
		files: ["scripts/**/*.mjs"],
		rules: { "no-restricted-globals": "off" },
	},
];
