/**
 * Guards US00024 (AC5, AC7): the wiki is reached through the `wiki` symlink,
 * never a hardcoded `docs/` location. A regression here is silent at runtime
 * — `move-ticket.mjs` just prints "note not found" and exits 1, and a stray
 * `docs/wiki/…` in a workflow command resolves to nothing after the move.
 *
 * Also guards US00002's half of ADR-0020: one canonical body per workflow in
 * `dispatch/workflow/`, and a stub per agent that points at it and carries no
 * steps. That ADR's stated failure mode is silence — an agent that ignores the
 * pointer improvises rather than erroring — so the structural half is asserted
 * here, and only the behavioural half is left to the manual test plan.
 *
 * Parses source text rather than running the script, matching
 * `settings-tab.test.ts`'s approach for a repo-layout invariant that has no
 * Obsidian API to exercise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** A stub's frontmatter is a summary, not a step — only the body is scanned. */
function body(text: string): string {
	const m = /^---\r?\n.*?\r?\n---\r?\n(.*)$/s.exec(text);
	return m ? m[1] : text;
}

describe("scripts/dispatch/move-ticket.mjs", () => {
	const source = readFileSync(`${repoRoot}/scripts/dispatch/move-ticket.mjs`, "utf8");

	it("names the wiki through the symlink, not a literal docs/ location", () => {
		expect(source).not.toMatch(/"docs"/);
		expect(source).toContain('const VAULT_DIR = "wiki"');
	});
});

const workflowDir = `${repoRoot}/dispatch/workflow`;
const workflows = readdirSync(workflowDir)
	.filter((f) => f.endsWith(".md"))
	.map((f) => f.replace(/\.md$/, ""));

describe("dispatch/workflow/*.md — the canonical bodies", () => {
	it("finds the workflow files at all", () => {
		// Guards the rest of this suite: a moved/renamed folder would
		// otherwise make every assertion below vacuously true.
		expect(workflows.length).toBeGreaterThan(5);
	});

	it("references the wiki through the symlink, never docs/wiki", () => {
		for (const name of workflows) {
			const text = readFileSync(`${workflowDir}/${name}.md`, "utf8");
			expect(text, `${name} still has a docs/wiki reference`).not.toContain("docs/wiki");
		}
	});
});

describe("the per-agent stubs — ADR-0020", () => {
	const stubs = workflows.flatMap((name) => [
		{ name, agent: "claude", path: `${repoRoot}/.claude/commands/${name}.md` },
		{ name, agent: "codex", path: `${repoRoot}/.codex/skills/${name}/SKILL.md` },
	]);

	it("exists for every canonical workflow, on both agents", () => {
		for (const stub of stubs) {
			expect(() => readFileSync(stub.path, "utf8"), `${stub.agent}: ${stub.name}`).not.toThrow();
		}
	});

	it("points at its own canonical file", () => {
		for (const stub of stubs) {
			const text = readFileSync(stub.path, "utf8");
			expect(text, `${stub.agent}: ${stub.name}`).toContain(
				`dispatch/workflow/${stub.name}.md`
			);
		}
	});

	it("carries no workflow step that could drift from the canonical file", () => {
		// The counters and the freeze are the load-bearing terms: if one of
		// these appears in a stub body, a step was written into the copy the
		// other agent never reads.
		const stepTerms = [
			"open_questions",
			"open_tests",
			"open_findings",
			"frozen:",
			"version_target",
			"wiki/05_Requirements",
		];
		for (const stub of stubs) {
			const text = body(readFileSync(stub.path, "utf8"));
			for (const term of stepTerms) {
				expect(text, `${stub.agent}: ${stub.name} restates "${term}"`).not.toContain(term);
			}
		}
	});
});
