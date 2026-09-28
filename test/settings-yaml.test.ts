/**
 * US00033 criterion 2: the tracker repository is stated once, in
 * `dispatch/settings.yaml`, and not in the workflow files that used to name it
 * ten times. The file is committed and shared, so it may carry no absolute path
 * (ADR-0035) — those belong to the device layer in `~/.dispatch/`.
 *
 * Only agents read the file; no script parses it. So this test is what keeps the
 * hardcoding from creeping back into a workflow.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const text = readFileSync(`${repoRoot}/dispatch/settings.yaml`, "utf8");
const settings = parse(text) as { tracker?: { repository?: unknown } };

/** Every scalar in the file, however deeply nested. */
function scalars(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (typeof value === "object") return Object.values(value).flatMap(scalars);
	return [String(value)];
}

describe("dispatch/settings.yaml", () => {
	it("names the tracker repository as owner/name", () => {
		expect(settings.tracker?.repository).toMatch(/^[\w.-]+\/[\w.-]+$/);
	});

	it("carries no absolute path", () => {
		for (const value of scalars(settings)) {
			expect(value, `absolute path in settings.yaml: ${value}`).not.toMatch(/^(\/|~|[A-Za-z]:[\\/])/);
		}
	});

	it("is the only place the workflows learn the tracker from", () => {
		const repository = String(settings.tracker?.repository);
		const dir = `${repoRoot}/dispatch/workflow`;
		for (const name of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
			const body = readFileSync(`${dir}/${name}`, "utf8");
			expect(body, `${name} still names ${repository}`).not.toContain(repository);
		}
	});
});
