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
import { DEFAULT_SHARED } from "../src/settings";
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
		expect(c.findings).toBe(2);
		expect(c.size).toBe(5);
	});

	it("renders no counter when the board names no property for it", () => {
		// Criterion 3's "off" half: an empty findingsProperty means no card
		// carries the badge, whatever the note says. Pins the ternary that
		// would otherwise read the property under any name.
		const f = note("US00005");
		const off = buildCard({ path: f.path, basename: f.basename }, f.frontmatter, {
			...CARD_SETTINGS,
			findingsProperty: "",
		});
		expect(off.findings).toBeUndefined();
		expect(card("US00005").findings).toBe(2);
	});

	it("leaves a counter undefined when the note never set it", () => {
		// Unset is not zero (ADR-0030): a ticket no review has touched makes
		// no claim, so the card renders no badge at all rather than a green
		// "reviewed and clear" one.
		expect(card("US00001").findings).toBeUndefined();
		expect(card("US00001").raw.open_findings).toBeUndefined();
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

	it("drops a nested object badge instead of rendering [object Object]", () => {
		// US00007 has `priority: { level: high, reason: regression }`, which
		// cannot be shown as a badge — the type badge is kept, that one is not.
		expect(card("US00007").badges).toEqual(["story"]);
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
	const completed = (when: string, size = 1): CardData<{ path: string; basename: string }> => ({
		...card("US00008"),
		completedAt: Date.parse(when),
		size,
	});

	it("weights completion by size across the release line", () => {
		const line = tickets().filter((c) => versionKey(c.version) === "1.4");
		// Σ(size × progress) / Σ(size) = 1100 / 18 ≈ 61 %
		expect(milestonePercent(line)).toBe(61);
	});

	it("returns null when nothing in the set counts", () => {
		expect(milestonePercent([])).toBeNull();
	});

	it("measures later weight across the observed span after a unique baseline", () => {
		expect(DEFAULT_SHARED.milestones.velocityMinimumCompletions).toBe(4);
		const v = velocityPerDay(
			[
				completed("2026-08-17T23:59:00Z", 99),
				completed("2026-08-18T00:01:00Z", 1),
				completed("2026-08-19T12:00:00Z", 2),
				completed("2026-08-20T23:00:00Z", 3),
			],
			{
				completedProperty: "deployed",
				velocityWindowDays: 28,
				minimumCompletions: DEFAULT_SHARED.milestones.velocityMinimumCompletions,
				now: Date.parse("2026-08-21T00:00:00Z"),
			}
		);
		expect(v).toEqual({ perDay: 6 / 4, samples: 3, spanDays: 4 });
	});

	it("uses the configured minimum completion count", () => {
		const cards = [
			completed("2026-08-18", 8),
			completed("2026-08-19", 2),
			completed("2026-08-20", 4),
		];
		const opts = {
			completedProperty: "deployed",
			velocityWindowDays: 28,
			now: Date.parse("2026-08-20"),
		};
		expect(velocityPerDay(cards, { ...opts, minimumCompletions: 4 })).toBeNull();
		expect(velocityPerDay(cards, { ...opts, minimumCompletions: 3 })).toEqual({
			perDay: 6 / 3,
			samples: 2,
			spanDays: 3,
		});
	});

	it("gives no forecast when the earliest UTC date is tied", () => {
		expect(
			velocityPerDay(
				[
					completed("2026-08-17T01:00:00Z", 1),
					completed("2026-08-17T23:00:00Z", 13),
					completed("2026-08-18", 2),
					completed("2026-08-19", 3),
				],
				{
					completedProperty: "deployed",
					velocityWindowDays: 28,
					minimumCompletions: 4,
					now: Date.parse("2026-08-20"),
				}
			)
		).toBeNull();
	});

	it("admits the exact cutoff but excludes older completions", () => {
		const v = velocityPerDay(
			[
				completed("2026-08-25", 100),
				completed("2026-08-26", 20),
				completed("2026-08-27", 1),
				completed("2026-08-28", 1),
				completed("2026-08-29", 1),
			],
			{
				completedProperty: "deployed",
				velocityWindowDays: 3,
				minimumCompletions: 4,
				now: Date.parse("2026-08-29"),
			}
		);
		expect(v).toEqual({ perDay: 1, samples: 3, spanDays: 3 });
	});

	it("counts internal gaps but ignores inactivity after the last completion", () => {
		const cards = [
			completed("2026-08-01", 50),
			completed("2026-08-03", 1),
			completed("2026-08-05", 2),
			completed("2026-08-07", 4),
		];
		const calculate = (now: string) =>
			velocityPerDay(cards, {
				completedProperty: "deployed",
				velocityWindowDays: 28,
				minimumCompletions: 4,
				now: Date.parse(now),
			});
		expect(calculate("2026-08-08")).toEqual({ perDay: 1, samples: 3, spanDays: 7 });
		expect(calculate("2026-08-20")).toEqual({ perDay: 1, samples: 3, spanDays: 7 });
	});

	it("gives no forecast without valid configuration or admitted history", () => {
		const valid = {
			completedProperty: "deployed",
			velocityWindowDays: 28,
			minimumCompletions: 4,
		};
		expect(velocityPerDay(tickets(), { ...valid, completedProperty: "" })).toBeNull();
		expect(velocityPerDay(tickets(), { ...valid, velocityWindowDays: 0 })).toBeNull();
		expect(velocityPerDay(tickets(), { ...valid, minimumCompletions: 0 })).toBeNull();
		expect(
			velocityPerDay(tickets(), { ...valid, now: Date.parse("2026-12-01") })
		).toBeNull();
	});

	it("gives no forecast when post-baseline weight is not positive", () => {
		expect(
			velocityPerDay(
				[
					completed("2026-08-17", 10),
					completed("2026-08-18", 0),
					completed("2026-08-19", 0),
					completed("2026-08-20", 0),
				],
				{
					completedProperty: "deployed",
					velocityWindowDays: 28,
					minimumCompletions: 4,
					now: Date.parse("2026-08-20"),
				}
			)
		).toBeNull();
	});
});
