/**
 * Board assembly over the fixture wiki: what a card becomes, what the problems
 * panel reports, which release note a column links, and the progress and
 * forecast maths — all against notes carrying the mistakes people make.
 */
import { describe, expect, it } from "vitest";
import {
	buildCard,
	cardProblems,
	indexReleases,
	milestonePercent,
	releaseNoteFrom,
	sortByRank,
	velocityPerDay,
} from "../src/cards";
import type { CardData } from "../src/cards";
import { versionKey } from "../src/parse";
import { CARD_SETTINGS, PROBLEM_SETTINGS, loadVault, note } from "./harness";

function card(prefix: string): CardData<{ path: string; basename: string }> {
	const f = note(prefix);
	return buildCard({ path: f.path, basename: f.basename }, f.frontmatter, CARD_SETTINGS);
}

const tickets = () =>
	loadVault("tickets").map((f) =>
		buildCard({ path: f.path, basename: f.basename }, f.frontmatter, CARD_SETTINGS)
	);

describe("building a card", () => {
	it("prefixes the title with the ticket id when there is one", () => {
		expect(card("US00001").title).toBe("US00001 · US00001 - Board renders columns");
	});

	it("falls back to the file name when the id was forgotten", () => {
		// This ticket is invisible to any batch chip that passes {{ids}}.
		expect(card("US00003").title).toBe("US00003 - Batch chips");
		expect(card("US00003").raw.id).toBeUndefined();
	});

	it("accepts counters and sizes typed as strings", () => {
		const c = card("US00005");
		expect(c.questions).toBe(3);
		expect(c.size).toBe(5);
	});

	it("places a known status in the pipeline and carries its progress weight", () => {
		const c = card("US00002");
		expect(c.status).toBe("Development");
		expect(c.statusIdx).toBe(3);
		expect(c.progress).toBe(55);
	});

	it("keeps a typo'd status as its own trailing column", () => {
		const c = card("US00004");
		expect(c.status).toBe("In Progres");
		expect(c.statusIdx).toBe(Number.MAX_SAFE_INTEGER); // sorts last, own column
		expect(c.statusLabel).toBe("In Progres");
		expect(c.progress).toBeUndefined(); // contributes nothing to progress
	});

	it("survives a note with no frontmatter at all", () => {
		const c = card("US00006 ");
		expect(c.status).toBe("");
		expect(c.statusLabel).toBe("(no status)");
		expect(c.size).toBe(1); // missing size counts as 1
		expect(c.rank).toBeUndefined();
	});

	it("reads assignee, rank, discussion and completion date", () => {
		expect(card("US00001").assignee).toBe("Alex");
		expect(card("US00001").rank).toBe(1024);
		expect(card("US00002").discussion).toBe("https://example.slack.com/archives/C1/p1");
		expect(card("US00008").completedAt).toBe(Date.parse("2026-08-07"));
	});

	it("renders a nested object badge as [object Object] today", () => {
		// Current behaviour, pinned so the typing pass has to change it on purpose.
		expect(card("US00007").badges).toContain("[object Object]");
	});
});

describe("ordering within a column", () => {
	it("sorts by rank, then title, and puts unranked cards last", () => {
		const readyForDev = tickets().filter((c) => c.status === "Ready for Dev");
		const order = sortByRank(readyForDev).map((c) => c.file.basename.split(" ")[0]);
		// BUG00001 and US00001 share rank 1024 (a copy-pasted frontmatter), so
		// the title breaks the tie; US00007 has no rank and sorts last.
		expect(order).toEqual(["BUG00001", "US00001", "US00007"]);
	});
});

describe("the problems panel", () => {
	const problemsFor = (prefix: string) => cardProblems(note(prefix).frontmatter, PROBLEM_SETTINGS);

	it("reports a forgotten id", () => {
		expect(problemsFor("US00003")).toEqual(['missing required property "id"']);
	});

	it("reports a template placeholder that was never filled in", () => {
		expect(problemsFor("BUG00002")).toEqual([
			'unrendered template value in "updated": { date:today }',
		]);
	});

	it("reports a status that is not a configured column", () => {
		expect(problemsFor("US00004")).toEqual(['status "In Progres" is not a configured column']);
	});

	it("reports every missing property on a note with no frontmatter", () => {
		expect(problemsFor("US00006 ")).toHaveLength(3); // id, status, updated
	});

	it("stays quiet on a complete ticket", () => {
		expect(problemsFor("US00001")).toEqual([]);
		expect(problemsFor("US00002")).toEqual([]);
	});

	it("flags missing, unrendered and unknown values — not odd types", () => {
		// US00005 (counters as strings), US00007 (object priority) and US00009
		// (a non-version target) are complete and correctly typed as far as the
		// panel is concerned, so they stay off it.
		const broken = loadVault("tickets").filter(
			(f) => cardProblems(f.frontmatter, PROBLEM_SETTINGS).length > 0
		);
		expect(broken.map((f) => f.basename.split(" ")[0]).sort()).toEqual([
			"BUG00002",
			"US00003",
			"US00004",
			"US00006",
		]);
	});
});

describe("release notes", () => {
	const notes = loadVault("releases")
		.map((f) => releaseNoteFrom({ path: f.path, basename: f.basename }, f.frontmatter))
		.filter((n): n is NonNullable<typeof n> => n !== null);

	it("links the initial x.y.0 note to the version line", () => {
		const { byLine } = indexReleases(notes);
		expect(byLine.get("1.4")?.version).toBe("v1.4.0");
		expect(byLine.get("1.4")?.date).toBe("2026-07-30");
		// The unprefixed note still finds its line.
		expect(byLine.get("1.5")?.version).toBe("1.5.0");
	});

	it("gives every patch column its own note", () => {
		const { byPatch } = indexReleases(notes);
		expect([...byPatch.keys()].sort()).toEqual(["1.4.0", "1.4.1", "1.5.0", "1.6.0"]);
		expect(byPatch.get("1.4.1")?.date).toBe("2026-08-05");
	});

	it("keeps a planned release with no date, without a release date to show", () => {
		const { byLine } = indexReleases(notes);
		expect(byLine.get("1.6")?.date).toBe("");
	});
});

describe("progress and forecast", () => {
	it("weights completion by size across the release line", () => {
		const line = tickets().filter((c) => versionKey(c.version) === "1.4");
		// Σ(size × progress) / Σ(size) = 1100 / 18 ≈ 61 %
		expect(milestonePercent(line)).toBe(61);
	});

	it("returns null when nothing in the set counts", () => {
		expect(milestonePercent([])).toBeNull();
	});

	it("measures velocity only from completions inside the window", () => {
		const now = Date.parse("2026-08-20");
		const v = velocityPerDay(tickets(), {
			completedProperty: "deployed",
			velocityWindowDays: 28,
			now,
		});
		expect(v).not.toBeNull();
		expect(v?.samples).toBe(1); // only US00008 carries a deployed date
		expect(v?.perDay).toBeCloseTo(8 / 28);
	});

	it("gives no forecast when the window is empty", () => {
		const now = Date.parse("2026-12-01"); // long after the only completion
		expect(
			velocityPerDay(tickets(), {
				completedProperty: "deployed",
				velocityWindowDays: 28,
				now,
			})
		).toBeNull();
	});

	it("gives no forecast when the feature is switched off", () => {
		expect(
			velocityPerDay(tickets(), { completedProperty: "", velocityWindowDays: 28 })
		).toBeNull();
	});
});
