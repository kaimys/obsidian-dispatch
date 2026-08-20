/**
 * Integration tests: the rules run against the fixture wiki in `test/vault`,
 * reading the real files rather than hand-built strings. Every expectation
 * below is a claim about a note a person could plausibly have written.
 */
import { describe, expect, it } from "vitest";
import { parseOpenActionOwners, parseTodoItems, patchKey, versionKey } from "../src/parse";
import { SETTINGS, loadVault, note } from "./harness";

const { assignees, fallbackAssignee, todoSections, versionProperty, titleProperty } = SETTINGS;

function owners(prefix: string): string[] {
	return parseOpenActionOwners(note(prefix).content, assignees, fallbackAssignee);
}

function todos(prefix: string) {
	const f = note(prefix);
	const noteAssignee = typeof f.frontmatter.assignee === "string" ? f.frontmatter.assignee : null;
	return parseTodoItems(f.content, todoSections, assignees, fallbackAssignee, noteAssignee);
}

describe("the fixture wiki", () => {
	it("loads every note, with and without frontmatter", () => {
		const all = loadVault();
		expect(all).toHaveLength(19);
		expect(loadVault("tickets")).toHaveLength(11);
		expect(loadVault("releases")).toHaveLength(4);
		expect(loadVault("meetings")).toHaveLength(4);
		// A note with no frontmatter parses to an empty object, never a crash.
		expect(note("US00006 ").frontmatter).toEqual({});
	});

	it("still carries the human mistakes the tests rely on", () => {
		expect(note("US00003").frontmatter[titleProperty]).toBeUndefined(); // forgot the id
		expect(note("BUG00002").frontmatter.updated).toBe("{ date:today }"); // template stub
		expect(note("US00004").frontmatter.status).toBe("In Progres"); // typo
		expect(note("US00005").frontmatter.open_questions).toBe("3"); // string, not number
		expect(note("US00007").frontmatter.priority).toEqual({ level: "high", reason: "regression" });
	});
});

describe("version grouping across inconsistent formats", () => {
	const tickets = loadVault("tickets");
	const versionOf = (f: (typeof tickets)[number]) => String(f.frontmatter[versionProperty] ?? "");

	it("groups v1.4.0, 1.4.1 and v1.4.1 into one release line", () => {
		const line = tickets.filter((f) => versionKey(versionOf(f)) === "1.4");
		expect(line.map((f) => f.basename.split(" ")[0]).sort()).toEqual([
			"BUG00001",
			"BUG00002",
			"US00001",
			"US00002",
			"US00003",
			"US00004",
			"US00008",
		]);
	});

	it("splits that line into patch columns when expanded", () => {
		const byPatch = new Map<string, string[]>();
		for (const f of tickets) {
			const v = versionOf(f);
			if (versionKey(v) !== "1.4") continue;
			const key = patchKey(v);
			byPatch.set(key, [...(byPatch.get(key) ?? []), f.basename.split(" ")[0]]);
		}
		expect([...byPatch.keys()].sort()).toEqual(["1.4.0", "1.4.1"]);
		expect(byPatch.get("1.4.0")).toHaveLength(3);
		expect(byPatch.get("1.4.1")).toHaveLength(4);
	});

	it("keeps a non-version target as its own column and no version as none", () => {
		expect(tickets.filter((f) => versionKey(versionOf(f)) === "Icebox")).toHaveLength(1);
		expect(tickets.filter((f) => versionOf(f) === "")).toHaveLength(2);
	});

	it("matches release notes to the line and to the patch column", () => {
		const releases = loadVault("releases").map((f) => String(f.frontmatter.version ?? ""));
		expect(releases.filter((v) => versionKey(v) === "1.4")).toHaveLength(2);
		// The unprefixed 1.5.0 note must still find its line.
		expect(releases.some((v) => versionKey(v) === "1.5")).toBe(true);
		// A planned release with no date is still a note, just not a shipped one.
		const planned = loadVault("releases").find((f) => f.frontmatter.version === "v1.6.0");
		expect(planned?.frontmatter.date).toBeUndefined();
	});
});

describe("meeting action items, per owner", () => {
	it("reads a bold owner section and an inline prefix, ignoring checked items", () => {
		// [x] Publish the release note is done, so Alex has one open item.
		expect(owners("2026-08-04")).toEqual(["Alex", "Robin", "Morgan", "Robin"]);
	});

	it("falls back to the team for section headers that are not people", () => {
		// **Team**, **US00055:** and **Friday:** must not become owners.
		expect(owners("2026-08-11 - Product")).toEqual(["Alex", "Team", "Team", "Team"]);
	});

	it("keeps two meetings on the same date apart", () => {
		expect(owners("2026-08-11 - Design")).toEqual(["Morgan"]);
	});

	it("works on a note with no frontmatter at all", () => {
		expect(owners("2026-07-28")).toEqual(["Robin", "Robin"]);
	});
});

describe("todo collection", () => {
	it("only reads allowlisted sections", () => {
		// US00006's items live under "## Notes", which is not allowlisted.
		expect(todos("US00006 ")).toEqual([]);
		// US00001's live under "## Acceptance criteria" — also not a todo section.
		expect(todos("US00001")).toEqual([]);
	});

	it("strips a real owner prefix but keeps one that only looks like an owner", () => {
		const items = todos("2026-08-11 - Product");
		const byText = Object.fromEntries(items.map((i) => [i.text, i.owner]));
		expect(byText["Draft the 1.5.0 scope."]).toBe("Alex");
		expect(byText["Agree on the freeze rule wording."]).toBe("Team");
		// The ticket reference stays in the text instead of inventing a person.
		expect(byText["**US00055:** split the analytics ticket."]).toBe("Team");
	});

	it("points every item at the exact line it came from", () => {
		const f = note("2026-08-04");
		const lines = f.content.split(/\r?\n/);
		for (const item of todos("2026-08-04")) {
			expect(lines[item.line]).toContain("- [ ]");
			expect(lines[item.line]).toContain(item.text.replace(/^\*\*.*?\*\*\s*/, "").slice(0, 20));
		}
	});
});
