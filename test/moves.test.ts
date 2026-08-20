/**
 * What a drag writes. These are the tests that matter most: everything here
 * ends in a frontmatter write to somebody's note, so a wrong plan corrupts
 * real files rather than just rendering badly.
 */
import { describe, expect, it } from "vitest";
import { buildCard } from "../src/cards";
import type { CardData, FileRef } from "../src/cards";
import { RANK_GAP, planStatusDrop, planVersionDrop, ruleSetsFor } from "../src/moves";
import { CARD_SETTINGS, loadVault } from "./harness";

const STATUS = "status";
const ORDER = "rank";

/** A minimal card — enough for the rank maths, without a vault. */
function card(path: string, status: string, rank?: number): CardData<FileRef> {
	return buildCard(
		{ path, basename: path.replace(/\.md$/, "") },
		{ status, ...(rank === undefined ? {} : { rank }) },
		CARD_SETTINGS
	);
}

const opts = { statusProperty: STATUS, orderProperty: ORDER };

/** The fixture wiki's tickets, as cards. */
const fixtureCards = () =>
	loadVault("tickets").map((f) =>
		buildCard({ path: f.path, basename: f.basename }, f.frontmatter, CARD_SETTINGS)
	);

describe("planStatusDrop — the happy path touches one note", () => {
	const column = [card("a.md", "Dev", 1024), card("b.md", "Dev", 2048), card("c.md", "Dev", 3072)];

	it("writes status and rank on the moved note only", () => {
		const cards = [...column, card("x.md", "Todo", 1024)];
		const plan = planStatusDrop(cards, "x.md", "Dev", 1, opts);
		expect(plan?.patches).toHaveLength(1);
		expect(plan?.renormalized).toBe(false);
		expect(plan?.patches[0].file.path).toBe("x.md");
		expect(plan?.patches[0].set[STATUS]).toBe("Dev");
		expect(plan?.patches[0].set[ORDER]).toBe(1536); // midpoint of 1024 and 2048
		expect(plan?.statusChanged).toBe(true);
	});

	it("appends past the end and prepends before the first", () => {
		const cards = [...column, card("x.md", "Todo")];
		expect(planStatusDrop(cards, "x.md", "Dev", 99, opts)?.patches[0].set[ORDER]).toBe(
			3072 + RANK_GAP
		);
		expect(planStatusDrop(cards, "x.md", "Dev", 0, opts)?.patches[0].set[ORDER]).toBe(
			1024 - RANK_GAP
		);
	});

	it("gives the first card of an empty column the base rank", () => {
		const plan = planStatusDrop([card("x.md", "Todo")], "x.md", "Dev", 0, opts);
		expect(plan?.patches[0].set[ORDER]).toBe(RANK_GAP);
	});

	it("reorders within a column without touching the status", () => {
		const plan = planStatusDrop(column, "c.md", "Dev", 0, opts);
		expect(plan?.statusChanged).toBe(false);
		expect(plan?.patches).toHaveLength(1);
		expect(plan?.patches[0].set[STATUS]).toBeUndefined();
		expect(plan?.patches[0].set[ORDER]).toBe(1024 - RANK_GAP);
	});
});

describe("planStatusDrop — when it must write nothing", () => {
	const column = [card("a.md", "Dev", 1024), card("b.md", "Dev", 2048)];

	it("returns null for a card that is not on the board", () => {
		expect(planStatusDrop(column, "ghost.md", "Dev", 0, opts)).toBeNull();
	});

	it("returns null when a card is dropped back where it already was", () => {
		// An accidental nudge must not rewrite the note.
		expect(planStatusDrop(column, "a.md", "Dev", 0, opts)).toBeNull();
		expect(planStatusDrop(column, "b.md", "Dev", 1, opts)).toBeNull();
	});

	it("returns null for a same-status drop when ordering is disabled", () => {
		expect(
			planStatusDrop(column, "a.md", "Dev", 0, { statusProperty: STATUS, orderProperty: "" })
		).toBeNull();
	});

	it("writes only the status when ordering is disabled", () => {
		const plan = planStatusDrop(column, "a.md", "Done", 0, {
			statusProperty: STATUS,
			orderProperty: "",
		});
		expect(plan?.patches).toHaveLength(1);
		expect(plan?.patches[0].set).toEqual({ status: "Done" });
	});
});

describe("planStatusDrop — renormalizing a messy column", () => {
	it("rewrites the column when ranks are duplicated, and only where they change", () => {
		// The fixture's Ready for Dev column: US00001 and BUG00001 both carry
		// rank 1024 (copy-pasted frontmatter) and US00007 has no rank at all.
		const cards = fixtureCards();
		const target = cards.find((c) => c.file.basename.startsWith("US00005"));
		expect(target).toBeDefined();
		const plan = planStatusDrop(cards, target!.file.path, "Ready for Dev", 0, opts);
		expect(plan?.renormalized).toBe(true);
		// 4 cards in the column afterwards; every one needs a new rank because
		// none of them currently holds the value it should.
		expect(plan?.patches).toHaveLength(4);
		expect(plan?.patches.map((p) => p.set[ORDER])).toEqual([1024, 2048, 3072, 4096]);
		expect(plan?.patches[0].file.path).toBe(target!.file.path);
		expect(plan?.patches[0].set[STATUS]).toBe("Ready for Dev");
	});

	it("skips notes whose rank is already correct", () => {
		// a.md already sits at 1024; only the arriving card and the displaced
		// one need writing.
		const cards = [card("a.md", "Dev", 1024), card("b.md", "Dev", 1024), card("x.md", "Todo")];
		const plan = planStatusDrop(cards, "x.md", "Dev", 2, opts);
		expect(plan?.renormalized).toBe(true);
		expect(plan?.patches.map((p) => p.file.path)).toEqual(["b.md", "x.md"]);
	});

	it("renormalizes when the gap between neighbours is exhausted", () => {
		const cards = [card("a.md", "Dev", 1024), card("b.md", "Dev", 1025), card("x.md", "Todo")];
		const plan = planStatusDrop(cards, "x.md", "Dev", 1, opts);
		expect(plan?.renormalized).toBe(true);
		expect(plan?.patches.map((p) => p.set[ORDER])).toEqual([2048, 3072]);
	});
});

describe("automation rules", () => {
	const now = new Date("2026-08-20T10:30:00Z");
	const stampDeployed = [{ when: ["Deployed"], set: { deployed: "{{date}}" }, repo: "", command: "" }];

	it("stamps the configured property when a card enters the status", () => {
		const plan = planStatusDrop([card("a.md", "Dev", 1024)], "a.md", "Deployed", 0, {
			...opts,
			automations: stampDeployed,
			now,
		});
		expect(plan?.patches[0].set.deployed).toBe("2026-08-20");
		// written together with the status, in one patch
		expect(plan?.patches[0].set[STATUS]).toBe("Deployed");
	});

	it("does not stamp a status the rule does not name", () => {
		const plan = planStatusDrop([card("a.md", "Dev", 1024)], "a.md", "Done", 0, {
			...opts,
			automations: stampDeployed,
			now,
		});
		expect(plan?.patches[0].set.deployed).toBeUndefined();
	});

	it("does not stamp a reorder inside the same column", () => {
		const cards = [card("a.md", "Deployed", 1024), card("b.md", "Deployed", 2048)];
		const plan = planStatusDrop(cards, "b.md", "Deployed", 0, {
			...opts,
			automations: stampDeployed,
			now,
		});
		expect(plan?.statusChanged).toBe(false);
		expect(plan?.patches[0].set.deployed).toBeUndefined();
	});

	it("applies a rule with no 'when' to every status change", () => {
		const rules = [{ when: [], set: { moved: "{{from}} → {{to}}" }, repo: "", command: "" }];
		expect(ruleSetsFor(rules, "Dev", "Done", now)).toEqual({ moved: "Dev → Done" });
	});

	it("expands date and datetime from the injected clock", () => {
		const rules = [{ when: [], set: { d: "{{date}}", t: "{{datetime}}" }, repo: "", command: "" }];
		const out = ruleSetsFor(rules, "a", "b", now);
		expect(out.d).toBe("2026-08-20");
		expect(out.t).toBe(now.toISOString());
	});
});

describe("planVersionDrop", () => {
	const c = (version: string) =>
		buildCard({ path: "t.md", basename: "t" }, { version_target: version }, CARD_SETTINGS);
	const VERSION = "version_target";

	it("writes the column's canonical value", () => {
		const patch = planVersionDrop(c("v1.4.0"), { key: "1.5", writeValue: "v1.5.0" }, VERSION);
		expect(patch?.set).toEqual({ version_target: "v1.5.0" });
	});

	it("removes the property when dropped on (no version)", () => {
		const patch = planVersionDrop(c("v1.4.0"), { key: "", writeValue: "" }, VERSION);
		expect(patch?.unset).toEqual([VERSION]);
		expect(patch?.set).toEqual({});
	});

	it("leaves a card alone when dropped on the line it is already in", () => {
		// This is what stops a hand-written "1.4.1" being reformatted to "v1.4.0"
		// just because someone nudged the card.
		expect(planVersionDrop(c("1.4.1"), { key: "1.4", writeValue: "v1.4.0" }, VERSION)).toBeNull();
		expect(planVersionDrop(c(""), { key: "", writeValue: "" }, VERSION)).toBeNull();
	});

	it("still rewrites when dropped on its own patch column", () => {
		// Current behaviour: the guard compares major.minor, so a patch column
		// never matches and the same value is written back. Harmless, but it is
		// a write where none is needed.
		const patch = planVersionDrop(c("v1.4.1"), { key: "1.4.1", writeValue: "v1.4.1" }, VERSION);
		expect(patch?.set).toEqual({ version_target: "v1.4.1" });
	});
});
