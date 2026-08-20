import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{ ignores: ["main.js", "node_modules/**", "docs/**", "test/**", "*.config.*", "plugins/**"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},
];
