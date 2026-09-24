/**
 * Retargeting a Release Plan line from its header (US00053). The planner is
 * the only place the batch can be asserted — the menu and modals are not
 * reachable from the suite (ADR-0016) — and every plan here ends in N notes
 * and team-synced settings being rewritten at once.
 */
import { describe, expect, it } from "vitest";
import type { CardData, FileRef } from "../src/cards";
import { isArchivedCard, lineCandidates } from "../src/milestones";
import {
	isRetargetSource,
	parseDestination,
	planRetarget,
	retargetBlockers,
	retargetDestinations,
	sameRetarget,
} from "../src/retarget";
import type { RetargetInput, RetargetPlan } from "../src/retarget";

const VERSION = "version_target";

/** A plain card: enough for line membership, archiving and protection. */
function card(
	id: string,
	version: string,
	opts: { progress?: number; excluded?: boolean } = {}
): CardData<FileRef> {
	return {
		file: { path: `${id}.md`, basename: id },
		status: "",
		statusLabel: "",
		statusIdx: 0,
		title: id,
		badges: [],
		version,
		size: 1,
		progress: opts.progress ?? 10,
		excludedFromProgress: opts.excluded ?? false,
		raw: {},
	};
}

function input(over: Partial<RetargetInput>): RetargetInput {
	return {
		cards: [],
		sourceKey: "0.4",
		destination: "0.5",
		versionProperty: VERSION,
		plannedVersions: [],
		tags: {},
		...over,
	};
}

function plan(over: Partial<RetargetInput>): RetargetPlan {
	const result = planRetarget(input(over));
	if (!result.ok) throw new Error(`expected a plan, got ${result.reason}`);
	return result;
}

const paths = (p: RetargetPlan) => p.patches.map((x) => x.file.path);

describe("which headers offer the action", () => {
	it("is a collapsed numeric line", () => {
		expect(isRetargetSource({ key: "0.4" })).toBe(true);
		expect(isRetargetSource({ key: "10.12" })).toBe(true);
	});

	it("is not a patch column, (no version), (archive) or a label", () => {
		expect(isRetargetSource({ key: "0.4.1", isPatch: true })).toBe(false);
		expect(isRetargetSource({ key: "0.4", isPatch: true })).toBe(false);
		expect(isRetargetSource({ key: "" })).toBe(false);
		expect(isRetargetSource({ key: "\u0000archive" })).toBe(false);
		expect(isRetargetSource({ key: "Icebox" })).toBe(false);
	});
});

describe("protection — a finished card blocks the whole batch", () => {
	const eligible = Array.from({ length: 8 }, (_, i) => card(`E${i}`, "v0.4.0"));
	const finished = [card("D1", "v0.4.0", { progress: 100 }), card("R1", "v0.4.1", { progress: 100 })];

	it("8 eligible plus 2 finished is zero writes, naming exactly those 2", () => {
		const planned = Object.freeze(["v0.4.0", "v0.5.0"]);
		const tags = Object.freeze({ "0.4": "MVP" });
		const result = planRetarget(
			input({ cards: [...eligible, ...finished], plannedVersions: planned, tags })
		);
		expect(result.ok).toBe(false);
		if (result.ok || result.reason !== "protected") throw new Error("expected protected");
		expect(result.blockers.map((c) => c.title)).toEqual(["D1", "R1"]);
		expect("patches" in result).toBe(false);
		expect(planned).toEqual(["v0.4.0", "v0.5.0"]);
		expect(tags).toEqual({ "0.4": "MVP" });
	});

	it("is status progress, not a status name: 85 does not block", () => {
		expect(retargetBlockers([card("A", "v0.4.0", { progress: 85 })], "0.4")).toEqual([]);
		expect(plan({ cards: [card("A", "v0.4.0", { progress: 85 })] }).patches).toHaveLength(1);
	});

	it("ignores finished cards of other lines", () => {
		const p = plan({ cards: [card("A", "v0.4.0"), card("D", "v0.5.0", { progress: 100 })] });
		expect(paths(p)).toEqual(["A.md"]);
	});

	it("leaves a Rejected card on the line alone: no block, no patch", () => {
		const rejected = card("X", "v0.4.0", { progress: 100, excluded: true });
		const p = plan({ cards: [card("A", "v0.4.0"), rejected] });
		expect(paths(p)).toEqual(["A.md"]);
	});
});

describe("rejected destinations write nothing", () => {
	const cards = [card("A", "v0.4.0")];

	it.each(["v0.4.0", "v0.4.1", "0.4", "V0.4.9", " 0.04 "])("same line: %s", (destination) => {
		expect(planRetarget(input({ cards, destination }))).toEqual({
			ok: false,
			reason: "same-line",
			destKey: "0.4",
		});
	});

	it.each(["Icebox", "", "v1", "next", "0.5-beta", "(no version)"])("not a version: %j", (destination) => {
		expect(planRetarget(input({ cards, destination }))).toEqual({ ok: false, reason: "invalid" });
	});

	it("checks the destination before protection", () => {
		const blocked = [card("D", "v0.4.0", { progress: 100 })];
		expect(planRetarget(input({ cards: blocked, destination: "Icebox" })).ok).toBe(false);
		expect(planRetarget(input({ cards: blocked, destination: "v0.4.2" }))).toMatchObject({
			reason: "same-line",
		});
	});
});

describe("a new destination from a planned source", () => {
	const planned = Object.freeze(["Icebox", "v0.3.0", "v0.4.0", "v0.7.0"]);
	const tags = Object.freeze({ "0.3": "Beta", "0.4": "MVP" });
	const cards = [card("A", "v0.4.0"), card("B", "0.4.2"), card("C", "v0.3.1")];

	it("replaces the planned entry in place and keeps the others in order", () => {
		const p = plan({ cards, destination: "0.6", plannedVersions: planned, tags });
		expect(p.destinationExists).toBe(false);
		expect(p.writeValue).toBe("v0.6.0");
		expect(p.plannedVersions).toEqual(["Icebox", "v0.3.0", "v0.6.0", "v0.7.0"]);
		expect(p.summary.plannedReplaced).toEqual({ from: "v0.4.0", to: "v0.6.0" });
		expect(p.summary.plannedRemoved).toEqual([]);
	});

	it("carries the source tag and removes the old key", () => {
		const p = plan({ cards, destination: "0.6", plannedVersions: planned, tags });
		expect(p.tags).toEqual({ "0.3": "Beta", "0.6": "MVP" });
		expect(p.summary.tagMoved).toBe("MVP");
	});

	it("patches every source card, and only those", () => {
		const p = plan({ cards, destination: "0.6", plannedVersions: planned, tags });
		expect(p.patches).toEqual([
			{ file: cards[0].file, set: { [VERSION]: "v0.6.0" } },
			{ file: cards[1].file, set: { [VERSION]: "v0.6.0" } },
		]);
	});

	it("writes canonical lowercase spelling", () => {
		expect(plan({ cards, destination: "0.6" }).writeValue).toBe("v0.6.0");
		expect(plan({ cards, destination: "V0.6.2" }).writeValue).toBe("v0.6.2");
		expect(plan({ cards, destination: " v0.06 " }).destKey).toBe("0.6");
		expect(plan({ cards, destination: "0.06" }).writeValue).toBe("v0.6.0");
	});

	it("keeps only the first of several source spellings", () => {
		const p = plan({ cards, destination: "0.6", plannedVersions: ["v0.4.0", "0.4.1", "v0.5.0"] });
		expect(p.plannedVersions).toEqual(["v0.6.0", "v0.5.0"]);
		expect(p.summary.plannedRemoved).toEqual(["0.4.1"]);
	});
});

describe("a new destination from a discovered source", () => {
	it("leaves planned untouched and moves the tag", () => {
		const planned = Object.freeze(["v0.3.0"]);
		const p = plan({
			cards: [card("A", "v0.4.0")],
			destination: "v0.9.0",
			plannedVersions: planned,
			tags: { "0.4": "MVP" },
		});
		expect(p.plannedVersions).toEqual(["v0.3.0"]);
		expect(p.plannedVersions).not.toBe(planned);
		expect(p.summary.plannedReplaced).toBeUndefined();
		expect(p.tags).toEqual({ "0.9": "MVP" });
	});
});

describe("merging into an existing destination", () => {
	const planned = Object.freeze(["v0.4.0", "v0.5.0", "Icebox"]);
	const src = [card("A", "v0.4.0"), card("B", "v0.4.1")];
	const dst = [card("P", "v0.5.1"), card("Q", "v0.5.2")];

	it("writes the line's highest known patch and never patches its cards", () => {
		const p = plan({ cards: [...src, ...dst], plannedVersions: planned });
		expect(p.destinationExists).toBe(true);
		expect(p.writeValue).toBe("v0.5.2");
		expect(paths(p)).toEqual(["A.md", "B.md"]);
	});

	it("counts every non-archived card, not a slice, for that patch", () => {
		// The board passes every card; one a slice would hide still counts.
		const p = plan({ cards: [...src, card("Hidden", "v0.5.7")], plannedVersions: planned });
		expect(p.writeValue).toBe("v0.5.7");
	});

	it("ignores an archived card's patch", () => {
		const archived = card("X", "v0.5.9", { excluded: true });
		expect(plan({ cards: [...src, archived], plannedVersions: planned }).writeValue).toBe("v0.5.0");
	});

	it("ignores a typed patch in favour of the line's value", () => {
		const p = plan({ cards: [...src, ...dst], plannedVersions: planned, destination: "0.5.9" });
		expect(p.writeValue).toBe("v0.5.2");
	});

	it("removes every planned spelling of the source and adds nothing", () => {
		const p = plan({ cards: src, plannedVersions: ["0.4", "v0.4.0", "v0.5.0", "Icebox", "V0.4.3"] });
		expect(p.plannedVersions).toEqual(["v0.5.0", "Icebox"]);
		expect(p.summary.plannedRemoved).toEqual(["0.4", "v0.4.0", "V0.4.3"]);
		expect(p.summary.plannedReplaced).toBeUndefined();
	});

	it("keeps the destination's tag and drops the source's", () => {
		const p = plan({ cards: src, plannedVersions: planned, tags: { "0.4": "MVP", "0.5": "GA" } });
		expect(p.tags).toEqual({ "0.5": "GA" });
		expect(p.summary.tagRemoved).toBe("MVP");
		expect(p.summary.tagMoved).toBeUndefined();
	});

	it("leaves an untagged destination untagged", () => {
		const p = plan({ cards: src, plannedVersions: planned, tags: { "0.4": "MVP", "0.3": "Beta" } });
		expect(p.tags).toEqual({ "0.3": "Beta" });
	});

	it("merges into a discovered destination without planning it", () => {
		const p = plan({ cards: [...src, card("P", "v0.5.3")], plannedVersions: ["v0.4.0"] });
		expect(p.destinationExists).toBe(true);
		expect(p.writeValue).toBe("v0.5.3");
		expect(p.plannedVersions).toEqual([]);
	});
});

describe("edges", () => {
	it("an empty planned source renumbers the entry and its tag only", () => {
		const p = plan({ cards: [card("Z", "v0.8.0")], plannedVersions: ["v0.4.0"], tags: { "0.4": "MVP" } });
		expect(p.patches).toEqual([]);
		expect(p.summary.cardCount).toBe(0);
		expect(p.plannedVersions).toEqual(["v0.5.0"]);
		expect(p.tags).toEqual({ "0.5": "MVP" });
	});

	it("every patch sets only the version property", () => {
		const p = plan({ cards: [card("A", "v0.4.0"), card("B", "0.4")] });
		for (const patch of p.patches) {
			expect(Object.keys(patch.set)).toEqual([VERSION]);
			expect(patch.unset).toBeUndefined();
		}
	});

	it("never mutates its inputs", () => {
		const cards = Object.freeze([card("A", "v0.4.0")]);
		const planned = Object.freeze(["v0.4.0"]);
		const tags = Object.freeze({ "0.4": "MVP" });
		expect(() => planRetarget(input({ cards, plannedVersions: planned, tags }))).not.toThrow();
		expect(cards[0].version).toBe("v0.4.0");
	});
});

describe("the destination picker and the re-plan check", () => {
	it("lists every other numeric line with its write value", () => {
		const cards = [card("A", "v0.4.0"), card("B", "v0.6.1"), card("L", "Icebox")];
		const lines = retargetDestinations(["v0.5.0", "v0.4.0"], cards, "0.4");
		expect(lines.map((c) => [c.key, c.writeValue])).toEqual([
			["0.5", "v0.5.0"],
			["0.6", "v0.6.1"],
		]);
	});

	it("parses destinations into a line key and a patch", () => {
		expect(parseDestination("v0.5")).toEqual({ key: "0.5" });
		expect(parseDestination("V01.002.3")).toEqual({ key: "1.2", patch: 3 });
		expect(parseDestination("Icebox")).toBeNull();
	});

	it("sameRetarget spots a card that arrived while the dialog was open", () => {
		const base = { plannedVersions: ["v0.4.0"], tags: { "0.4": "MVP" } };
		const before = plan({ ...base, cards: [card("A", "v0.4.0")] });
		expect(sameRetarget(before, plan({ ...base, cards: [card("A", "v0.4.0")] }))).toBe(true);
		const after = plan({ ...base, cards: [card("A", "v0.4.0"), card("B", "v0.4.0")] });
		expect(sameRetarget(before, after)).toBe(false);
		const retagged = plan({ ...base, tags: { "0.4": "GA" }, cards: [card("A", "v0.4.0")] });
		expect(sameRetarget(before, retagged)).toBe(false);
	});
});

describe("line membership shared with the board", () => {
	it("isArchivedCard: excluded, or finished without a version", () => {
		expect(isArchivedCard(card("X", "v0.4.0", { excluded: true }))).toBe(true);
		expect(isArchivedCard(card("D", "", { progress: 100 }))).toBe(true);
		expect(isArchivedCard(card("D", "v0.4.0", { progress: 100 }))).toBe(false);
		expect(isArchivedCard(card("A", ""))).toBe(false);
	});

	it("lineCandidates excludes archived cards", () => {
		const cards = [card("A", "v0.4.1"), card("X", "v0.4.9", { excluded: true })];
		expect(lineCandidates(["v0.4.0"], cards)).toEqual(["v0.4.0", "v0.4.1"]);
	});
});
