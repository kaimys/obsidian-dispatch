/**
 * `scripts/dispatch/move-ticket.mjs`'s destination mapping — the one place a
 * board column turns into a GitHub issue state (US00040).
 *
 * The script's own header advertises `--dry-run` as the seam built for this: a
 * dry run makes no `gh` calls at all, so the whole mapping is exercisable by
 * spawning the real script against a temp note. What each case pins is the line
 * Dispatch surfaces as an Obsidian notice — exactly one, whatever happened.
 *
 * `Done` is the case worth the file. It used to close the issue and now
 * deliberately does not: on this board `Done` means the test plan is signed off
 * and `Released` means a version carrying the ticket actually shipped, which is
 * what "closed as completed" claims. Nothing else would notice that flipping
 * back, in either direction.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts", "dispatch", "move-ticket.mjs");
const dir = mkdtempSync(join(tmpdir(), "move-ticket-"));

/** A ticket note on disk, carrying only the frontmatter the script reads. */
function ticket(id: string, extra = ""): string {
	const path = join(dir, `${id}.md`);
	const discussion = "https://github.com/kaimys/obsidian-dispatch/issues/43";
	writeFileSync(path, `---\nid: ${id}\ndiscussion: ${discussion}\n${extra}---\n\nBody.\n`);
	return path;
}

/** The one line the script prints for a `from → to` move. */
function move(note: string, from: string, to: string): string {
	const out = execFileSync(process.execPath, [script, note, from, to, "--dry-run"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	expect(out.trimEnd().split("\n"), "prints exactly ONE line").toHaveLength(1);
	return out.trim();
}

describe("what a destination column means on GitHub", () => {
	const note = ticket("US00040");

	it("closes the issue as completed on Released", () => {
		expect(move(note, "Done", "Released")).toContain("gh issue close --reason completed 43");
	});

	it("closes the issue as not planned on Rejected", () => {
		expect(move(note, "Backlog", "Rejected")).toContain("gh issue close --reason not planned 43");
	});

	it("leaves the issue open on Done — signed off is not shipped", () => {
		const line = move(note, "Review", "Done");
		expect(line).toContain("already open");
		expect(line).not.toContain("issue close");
	});

	it("leaves the issue open on every column before Done", () => {
		for (const to of ["Backlog", "Refinement", "In progress", "Review"]) {
			const line = move(note, "Done", to);
			expect(line, to).toContain("already open");
			expect(line, to).not.toContain("issue close");
		}
	});

	it("reports the state change and the milestone mirror in the same line", () => {
		expect(move(ticket("US00041", "version_target: v0.3.0\n"), "Done", "Released")).toBe(
			"US00041: would run `gh issue close --reason completed 43`, would ensure milestone v0.3.0"
		);
	});

	it("says so and stops when the ticket has no linked issue", () => {
		const path = join(dir, "US00042.md");
		writeFileSync(path, "---\nid: US00042\n---\n\nBody.\n");
		expect(move(path, "Done", "Released")).toBe("US00042: no GitHub issue linked — tracker skipped");
	});
});
