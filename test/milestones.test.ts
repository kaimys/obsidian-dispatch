/**
 * Release Plan columns: which columns exist, and what a drop on each writes
 * (ADR-0036). The written value ends up in somebody's note and, through the
 * tracker mirror, as a GitHub milestone title — so every spelling matters.
 */
import { describe, expect, it } from "vitest";
import { buildCard } from "../src/cards";
import {
	buildLineColumns,
	buildPatchColumns,
	canonicalVersion,
	compareReleaseOrder,
	inColumn,
	lineWriteValue,
	linePatches,
	orderingScope,
} from "../src/milestones";
import { CARD_SETTINGS } from "./harness";

/** Line columns when the same versions are both on screen and candidates. */
const lines = (planned: string[], cards: string[]) =>
	buildLineColumns(planned, cards, [...planned, ...cards]);
const writeOf = (planned: string[], cards: string[], key: string) =>
	lines(planned, cards).find((c) => c.key === key)?.writeValue;

describe("a collapsed version line", () => {
	it("writes the highest patch its cards carry", () => {
		expect(writeOf([], ["v0.4.0", "v0.4.2"], "0.4")).toBe("v0.4.2");
	});

	it("compares patches numerically, not as text", () => {
		expect(writeOf([], ["v0.4.9", "v0.4.10"], "0.4")).toBe("v0.4.10");
	});

	it("ignores source, order and frequency", () => {
		const a = writeOf([], ["v0.4.1", "v0.4.1", "v0.4.1", "0.4.3"], "0.4");
		const b = writeOf([], ["0.4.3", "v0.4.1", "v0.4.1", "v0.4.1"], "0.4");
		expect(a).toBe("v0.4.3");
		expect(b).toBe("v0.4.3");
	});

	it("writes the canonical lowercase-v spelling whatever the cards say", () => {
		expect(writeOf([], ["0.4.2", "V0.4.2"], "0.4")).toBe("v0.4.2");
		expect(writeOf(["V0.4.2"], [], "0.4")).toBe("v0.4.2");
	});

	it("defaults a missing patch to .0", () => {
		expect(writeOf([], ["0.4", "v0.4"], "0.4")).toBe("v0.4.0");
		expect(writeOf(["0.4"], [], "0.4")).toBe("v0.4.0");
	});

	it("lets a newer card outrank an older planned entry", () => {
		expect(writeOf(["v0.4.0"], ["v0.4.2"], "0.4")).toBe("v0.4.2");
	});

	it("lets a newer planned entry outrank older cards", () => {
		expect(writeOf(["v0.4.3"], ["v0.4.2", "v0.4.2"], "0.4")).toBe("v0.4.3");
	});

	it("takes the highest of several planned patches, in any order", () => {
		expect(writeOf(["v0.4.5", "v0.4.1"], [], "0.4")).toBe("v0.4.5");
	});

	it("only counts candidates from its own line", () => {
		expect(writeOf([], ["v0.4.1", "v0.5.7", "v1.4.9"], "0.4")).toBe("v0.4.1");
	});

	it("uses candidates hidden by a slice, not only what is on screen", () => {
		// Slice shows only the v0.4.0 card; the v0.4.2 card still counts.
		const cols = buildLineColumns([], ["v0.4.0"], ["v0.4.0", "v0.4.2"]);
		expect(cols.find((c) => c.key === "0.4")?.writeValue).toBe("v0.4.2");
	});

	it("ignores versions left out of the candidates (archived / excluded cards)", () => {
		const cols = buildLineColumns([], ["v0.4.0"], ["v0.4.0"]);
		expect(cols.find((c) => c.key === "0.4")?.writeValue).toBe("v0.4.0");
		expect(lineWriteValue("0.4", ["v0.4.0", ""])).toBe("v0.4.0");
	});
});

describe("which line columns exist", () => {
	it("creates an empty column for a planned version", () => {
		expect(lines(["v0.4.0"], []).map((c) => c.key)).toEqual(["0.4"]);
	});

	it("discovers a column from a card, with no planned entry", () => {
		expect(lines([], ["0.5"]).map((c) => c.key)).toEqual(["0.5"]);
	});

	it("does not show a column for a candidate that is only hidden by a slice", () => {
		expect(buildLineColumns([], ["v0.4.0"], ["v0.4.0", "v0.6.0"]).map((c) => c.key)).toEqual(["0.4"]);
	});

	it("keeps special labels leftmost in planned order, writing their planned spelling", () => {
		const cols = lines(["v1.0.0", "Icebox", "Later"], ["v0.3.0", "Parked"]);
		expect(cols.map((c) => c.key)).toEqual(["Icebox", "Later", "Parked", "0.3", "1.0"]);
		expect(cols.find((c) => c.key === "Icebox")?.writeValue).toBe("Icebox");
		expect(cols.find((c) => c.key === "Parked")?.writeValue).toBe("Parked");
	});

	it("sorts version lines numerically", () => {
		expect(lines(["v0.10.0", "v0.9.0"], ["v1.0.0"]).map((c) => c.key)).toEqual(["0.9", "0.10", "1.0"]);
	});
});

describe("an expanded line's patch columns", () => {
	const line = lines(["V0.4.1"], ["v0.4.3", "0.4"])[0];

	it("writes each patch in canonical form, never the line's highest", () => {
		const patches = linePatches("0.4", ["V0.4.1", "v0.4.3", "0.4"], []);
		const cols = buildPatchColumns(line, patches);
		expect(cols.map((c) => [c.key, c.writeValue])).toEqual([
			["0.4", "v0.4.0"],
			["0.4.1", "v0.4.1"],
			["0.4.3", "v0.4.3"],
		]);
		expect(cols.every((c) => c.isPatch && c.line === "0.4")).toBe(true);
	});

	it("offers a release-note patch as a target without raising the line's write value", () => {
		expect(linePatches("0.4", ["v0.4.1"], ["0.4.2", "0.5.0"])).toEqual(["0.4.1", "0.4.2"]);
		expect(writeOf([], ["v0.4.1"], "0.4")).toBe("v0.4.1");
	});
});

describe("canonicalVersion", () => {
	it("adds the v prefix and a missing .0 patch", () => {
		expect(canonicalVersion("1.4")).toBe("v1.4.0");
		expect(canonicalVersion("1.4.2")).toBe("v1.4.2");
	});
});

/** A card on the Release Plan: version, status and both order properties. */
const rc = (name: string, version: string, fm: Record<string, unknown> = {}) =>
	buildCard(
		{ path: `${name}.md`, basename: name },
		{ status: "Refinement", version_target: version, ...fm },
		CARD_SETTINGS
	);
const names = (cards: { file: { basename: string } }[]) => cards.map((c) => c.file.basename);

describe("column membership", () => {
	it("puts a patch column's own patch in it, and the line's cards in the line", () => {
		const patch = { key: "0.4.1", isPatch: true };
		expect(inColumn(rc("a", "v0.4.1"), patch)).toBe(true);
		expect(inColumn(rc("a", "0.4.1"), patch)).toBe(true);
		expect(inColumn(rc("a", "v0.4.2"), patch)).toBe(false);
		expect(inColumn(rc("a", "v0.4.2"), { key: "0.4" })).toBe(true);
		expect(inColumn(rc("a", ""), { key: "" })).toBe(true);
	});
});

describe("release order", () => {
	it("reduces to the status-first sort when no card has a release rank", () => {
		const cards = [
			rc("late", "v0.4.0", { status: "Development", rank: 1 }),
			rc("b", "v0.4.0", { rank: 2048 }),
			rc("a", "v0.4.0", { rank: 1024 }),
			rc("z", "v0.4.0"),
		];
		expect(names([...cards].sort(compareReleaseOrder))).toEqual(["a", "b", "z", "late"]);
	});

	it("puts ranked cards first, overriding status, and the rest after in today's order", () => {
		const cards = [
			rc("new", "v0.4.0", { rank: 1 }),
			rc("done", "v0.4.0", { status: "Deployed", release_rank: 1024 }),
			rc("backlog", "v0.4.0", { status: "Ready for Refinement", release_rank: 2048 }),
		];
		expect(names([...cards].sort(compareReleaseOrder))).toEqual(["done", "backlog", "new"]);
	});

	it("scopes an expanded line's patch column to the whole line, never the archive", () => {
		const cards = [
			rc("p2", "v0.4.2", { release_rank: 1024 }),
			rc("p1", "v0.4.1", { release_rank: 2048 }),
			rc("other", "v0.5.0", { release_rank: 1 }),
		];
		const patch = { key: "0.4.1", isPatch: true, line: "0.4" };
		expect(names(orderingScope(cards, patch))).toEqual(["p2", "p1"]);
		expect(names(orderingScope(cards, { key: "0.4" }))).toEqual(["p2", "p1"]);
		const archived = rc("gone", "", { status: "Deployed" });
		expect(orderingScope([archived, rc("open", "")], { key: "" }).map((c) => c.file.basename)).toEqual([
			"open",
		]);
	});
});

