/**
 * The community-directory review's ruleset, run the way the review runs it:
 * type-aware @typescript-eslint rules against a program with no @types/node
 * (see tsconfig.no-node-types.json).
 *
 * `src/node.ts` is the only module allowed to touch Node directly, so it is
 * the only place a finding here should ever appear. Anything else means the
 * boundary has been bypassed.
 *
 * Run with `npm run lint:review`. This is a check, not the project's lint —
 * `npm run lint` (eslint.config.mjs) is what enforces the Obsidian rules.
 */
import tseslint from "typescript-eslint";

export default [
	{
		ignores: [
			"main.js",
			"node_modules/**",
			"docs/**",
			"test/**",
			"*.config.*",
			"eslint.review.mjs",
			"plugins/**",
			"scripts/**",
		],
	},
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.no-node-types.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
