/**
 * Guards US00024 (AC5, AC7): the wiki is reached through the `wiki` symlink,
 * never a hardcoded `docs/` location. A regression here is silent at runtime
 * — `move-ticket.mjs` just prints "note not found" and exits 1, and a stray
 * `docs/wiki/…` in a workflow command resolves to nothing after the move.
 *
 * Parses source text rather than running the script, matching
 * `settings-tab.test.ts`'s approach for a repo-layout invariant that has no
 * Obsidian API to exercise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("scripts/dispatch/move-ticket.mjs", () => {
	const source = readFileSync(`${repoRoot}/scripts/dispatch/move-ticket.mjs`, "utf8");

	it("names the wiki through the symlink, not a literal docs/ location", () => {
		expect(source).not.toMatch(/"docs"/);
		expect(source).toContain('const VAULT_DIR = "wiki"');
	});
});

describe(".claude/commands/*.md", () => {
	const dir = `${repoRoot}/.claude/commands`;
	const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

	it("finds the command files at all", () => {
		// Guards the rest of this suite: a moved/renamed folder would
		// otherwise make every assertion below vacuously true.
		expect(files.length).toBeGreaterThan(5);
	});

	it("references the wiki through the symlink, never docs/wiki", () => {
		for (const file of files) {
			const text = readFileSync(`${dir}/${file}`, "utf8");
			expect(text, `${file} still has a docs/wiki reference`).not.toContain("docs/wiki");
		}
	});
});
