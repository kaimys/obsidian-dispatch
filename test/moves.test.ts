/**
 * What a drag writes. These are the tests that matter most: everything here
 * ends in a frontmatter write to somebody's note, so a wrong plan corrupts
 * real files rather than just rendering badly.
 */
import { describe, expect, it } from "vitest";
import { buildCard } from "../src/cards";
import type { CardData, FileRef } from "../src/cards";
import { buildLineColumns, buildPatchColumns } from "../src/milestones";
import {
	RANK_GAP,
	planRankInsert,
	planReleaseDrop,
	planStatusDrop,
	planVersionDrop,
	ruleSetsFor,
} from "../src/moves";
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

describe("planRankInsert — placing a block of cards", () => {
	const rankOf = (c: CardData<FileRef>) => c.rank;
	const scope = [card("a.md", "Dev", 1024), card("b.md", "Dev", 2048), card("c.md", "Dev", 3072)];
	const block = [card("x.md", "Todo"), card("y.md", "Todo")];

	it("spaces a block evenly between two neighbours, writing only the block", () => {
		const plan = planRankInsert(scope, block, 1, rankOf, ORDER);
		expect(plan.renormalized).toBe(false);
		expect(plan.patches.map((p) => [p.file.path, p.set[ORDER]])).toEqual([
			["x.md", 1365],
			["y.md", 1706],
		]);
	});

	it("puts a block a gap apart at either end", () => {
		expect(planRankInsert(scope, block, 3, rankOf, ORDER).patches.map((p) => p.set[ORDER])).toEqual([
			3072 + RANK_GAP,
			3072 + 2 * RANK_GAP,
		]);
		expect(planRankInsert(scope, block, 0, rankOf, ORDER).patches.map((p) => p.set[ORDER])).toEqual([
			1024 - 2 * RANK_GAP,
			1024 - RANK_GAP,
		]);
		expect(planRankInsert([], block, 0, rankOf, ORDER).patches.map((p) => p.set[ORDER])).toEqual([
			RANK_GAP,
			2 * RANK_GAP,
		]);
	});

	it("renumbers when the neighbours leave fewer free ranks than the block needs", () => {
		const tight = [card("a.md", "Dev", 1024), card("b.md", "Dev", 1026)];
		const plan = planRankInsert(tight, block, 1, rankOf, ORDER);
		expect(plan.renormalized).toBe(true);
		// a.md already holds 1024, so it is not written.
		expect(plan.patches.map((p) => [p.file.path, p.set[ORDER]])).toEqual([
			["x.md", 2048],
			["y.md", 3072],
			["b.md", 4096],
		]);
	});

	it("renumbers a scope with an unranked card in its displayed order", () => {
		const messy = [card("a.md", "Dev", 1024), card("u.md", "Dev")];
		const plan = planRankInsert(messy, [card("x.md", "Todo")], 2, rankOf, ORDER);
		expect(plan.renormalized).toBe(true);
		expect(plan.patches.map((p) => [p.file.path, p.set[ORDER]])).toEqual([
			["u.md", 2048],
			["x.md", 3072],
		]);
	});

	it("writes a block card even when it already holds its renumbered rank", () => {
		const messy = [card("u.md", "Dev")];
		const plan = planRankInsert(messy, [card("x.md", "Todo", 1024)], 0, rankOf, ORDER);
		expect(plan.patches.map((p) => p.file.path)).toEqual(["x.md", "u.md"]);
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

	it("leaves a card alone when dropped on its own patch column", () => {
		// The guard used to compare major.minor, so a patch column never
		// matched and a hand-written "1.4.1" came back as "v1.4.1" (US00043).
		const own = { key: "1.4.1", writeValue: "v1.4.1", isPatch: true };
		expect(planVersionDrop(c("v1.4.1"), own, VERSION)).toBeNull();
		expect(planVersionDrop(c("1.4.1"), own, VERSION)).toBeNull();
		// The bare bucket of an expanded line holds only patch-less values.
		const bare = { key: "1.4", writeValue: "v1.4.0", isPatch: true };
		expect(planVersionDrop(c("v1.4"), bare, VERSION)).toBeNull();
		expect(planVersionDrop(c("v1.4.1"), bare, VERSION)?.set).toEqual({ version_target: "v1.4.0" });
	});

	describe("onto columns built from the board (ADR-0036)", () => {
		const board = ["0.4", "v0.4.2", "V0.4.1", "v0.3.0"];
		const column = (key: string) => {
			const col = buildLineColumns(["v0.4.0"], board, ["v0.4.0", ...board]).find((k) => k.key === key);
			if (!col) throw new Error(`no column ${key}`);
			return col;
		};

		it("writes a discovered-and-planned line's highest patch for a card from another line", () => {
			expect(planVersionDrop(c("v0.3.0"), column("0.4"), VERSION)?.set).toEqual({
				version_target: "v0.4.2",
			});
		});

		it("leaves an older or noncanonical value alone when dropped back on its own line", () => {
			expect(planVersionDrop(c("V0.4.1"), column("0.4"), VERSION)).toBeNull();
			expect(planVersionDrop(c("0.4"), column("0.4"), VERSION)).toBeNull();
		});

		it("writes an explicit older patch when dropped on that expanded patch column", () => {
			const [bare, older] = buildPatchColumns(column("0.4"), ["0.4", "0.4.1", "0.4.2"]);
			expect(planVersionDrop(c("v0.3.0"), older, VERSION)?.set).toEqual({ version_target: "v0.4.1" });
			expect(planVersionDrop(c("v0.3.0"), bare, VERSION)?.set).toEqual({ version_target: "v0.4.0" });
		});

		it("unsets the property when a versioned card goes to (no version)", () => {
			const patch = planVersionDrop(c("v0.4.2"), { key: "", writeValue: "" }, VERSION);
			expect(patch?.unset).toEqual([VERSION]);
		});
	});
});

describe("planReleaseDrop", () => {
	const VERSION = "version_target";
	const RELEASE = "release_rank";
	const on = { versionProperty: VERSION, releaseOrderProperty: RELEASE };
	const off = { versionProperty: VERSION, releaseOrderProperty: "" };
	const rc = (name: string, version: string, fm: Record<string, unknown> = {}) =>
		buildCard(
			{ path: `${name}.md`, basename: name },
			{ status: "Refinement", version_target: version, ...fm },
			CARD_SETTINGS
		);
	const line04 = { key: "0.4", writeValue: "v0.4.0" };
	const line05 = { key: "0.5", writeValue: "v0.5.0" };
	const ranked = () => [
		rc("a", "v0.4.0", { release_rank: 1024 }),
		rc("b", "v0.4.0", { release_rank: 2048 }),
		rc("c", "v0.4.0", { release_rank: 3072 }),
	];
	const sets = (plan: ReturnType<typeof planReleaseDrop>) =>
		plan?.patches.map((p) => [p.file.path, p.set, p.unset]);

	describe("a reorder in place", () => {
		it("writes only the release rank of the moved note", () => {
			const plan = planReleaseDrop(ranked(), "c.md", line04, { before: "b.md" }, on);
			expect(plan?.versionChanged).toBe(false);
			expect(sets(plan)).toEqual([["c.md", { release_rank: 1536 }, undefined]]);
		});

		it("never touches a hand-written version", () => {
			const cards = [rc("a", "0.4", { release_rank: 1024 }), rc("b", "V0.4.1", { release_rank: 2048 })];
			const plan = planReleaseDrop(cards, "b.md", line04, { before: "a.md" }, on);
			expect(sets(plan)).toEqual([["b.md", { release_rank: 0 }, undefined]]);
		});

		it("writes nothing when the card is dropped back on its own spot", () => {
			expect(planReleaseDrop(ranked(), "b.md", line04, { before: "b.md" }, on)).toBeNull();
			expect(planReleaseDrop(ranked(), "b.md", line04, { before: "c.md" }, on)).toBeNull();
			expect(planReleaseDrop(ranked(), "b.md", line04, { after: "a.md" }, on)).toBeNull();
			expect(planReleaseDrop(ranked(), "c.md", line04, { after: "c.md" }, on)).toBeNull();
			expect(planReleaseDrop(ranked(), "c.md", line04, "end", on)).toBeNull();
		});

		it("writes nothing at all with the release order off", () => {
			expect(planReleaseDrop(ranked(), "c.md", line04, { before: "a.md" }, off)).toBeNull();
		});

		it("numbers a fresh column as it was displayed on the first drop", () => {
			// Displayed today: by status, then Kanban rank — so a, then b, then c.
			const cards = [
				rc("c", "v0.4.0", { status: "Development" }),
				rc("b", "v0.4.0", { rank: 2048 }),
				rc("a", "v0.4.0", { rank: 1024 }),
			];
			const plan = planReleaseDrop(cards, "c.md", line04, { before: "b.md" }, on);
			expect(sets(plan)).toEqual([
				["a.md", { release_rank: 1024 }, undefined],
				["c.md", { release_rank: 2048 }, undefined],
				["b.md", { release_rank: 3072 }, undefined],
			]);
		});
	});

	describe("a move to another column", () => {
		it("writes the version and the position in one patch", () => {
			const cards = [...ranked(), rc("x", "v0.5.0", { release_rank: 99 })];
			const plan = planReleaseDrop(cards, "x.md", line04, { after: "a.md" }, on);
			expect(plan?.versionChanged).toBe(true);
			expect(sets(plan)).toEqual([["x.md", { version_target: "v0.4.0", release_rank: 1536 }, undefined]]);
		});

		it("appends without a position (the keyboard move)", () => {
			const cards = [...ranked(), rc("x", "v0.5.0")];
			const plan = planReleaseDrop(cards, "x.md", line04, "end", on);
			expect(sets(plan)).toEqual([
				["x.md", { version_target: "v0.4.0", release_rank: 3072 + RANK_GAP }, undefined],
			]);
		});

		it("appends when the anchor card has left the column", () => {
			const cards = [...ranked(), rc("x", "v0.5.0")];
			const plan = planReleaseDrop(cards, "x.md", line04, { before: "gone.md" }, on);
			expect(plan?.patches[0].set[RELEASE]).toBe(3072 + RANK_GAP);
		});

		it("orders (no version) and label columns like a line", () => {
			const cards = [rc("a", "", { release_rank: 1024 }), rc("x", "v0.4.0")];
			const plan = planReleaseDrop(cards, "x.md", { key: "", writeValue: "" }, { before: "a.md" }, on);
			expect(sets(plan)).toEqual([["x.md", { release_rank: 0 }, [VERSION]]]);
			const icebox = [rc("i", "Icebox", { release_rank: 1024 }), rc("x", "v0.4.0")];
			const onIce = planReleaseDrop(icebox, "x.md", { key: "Icebox", writeValue: "Icebox" }, "end", on);
			expect(sets(onIce)).toEqual([["x.md", { version_target: "Icebox", release_rank: 2048 }, undefined]]);
		});

		it("writes only the version with the release order off", () => {
			const cards = [...ranked(), rc("x", "v0.5.0")];
			const plan = planReleaseDrop(cards, "x.md", line04, { before: "a.md" }, off);
			expect(sets(plan)).toEqual([["x.md", { version_target: "v0.4.0" }, undefined]]);
		});

		it("gives an archived card no position", () => {
			const cards = [...ranked(), rc("old", "", { status: "Deployed" })];
			const plan = planReleaseDrop(cards, "old.md", line05, { before: "a.md" }, on);
			expect(sets(plan)).toEqual([["old.md", { version_target: "v0.5.0" }, undefined]]);
		});
	});

	describe("an expanded line", () => {
		const cards = () => [
			rc("p0", "v0.4.0", { release_rank: 1024 }),
			rc("p1", "v0.4.1", { release_rank: 2048 }),
			rc("q0", "v0.4.0", { release_rank: 3072 }),
		];
		const patch0 = { key: "0.4.0", writeValue: "v0.4.0", isPatch: true, line: "0.4" };
		const patch1 = { key: "0.4.1", writeValue: "v0.4.1", isPatch: true, line: "0.4" };

		it("positions within the line's single order", () => {
			// q0 dropped before p0 in the 0.4.0 column: first in the whole line.
			const plan = planReleaseDrop(cards(), "q0.md", patch0, { before: "p0.md" }, on);
			expect(sets(plan)).toEqual([["q0.md", { release_rank: 0 }, undefined]]);
		});

		it("changes only the patch when the card keeps its place in the line", () => {
			// p1 dropped after p0 into 0.4.0 stays second in the line.
			const plan = planReleaseDrop(cards(), "p1.md", patch0, { after: "p0.md" }, on);
			expect(sets(plan)).toEqual([["p1.md", { version_target: "v0.4.0" }, undefined]]);
		});

		it("renumbers the whole line, not just the patch column", () => {
			const tight = [
				rc("p0", "v0.4.0", { release_rank: 1024 }),
				rc("p1", "v0.4.1", { release_rank: 1025 }),
				rc("x", "v0.5.0"),
			];
			const plan = planReleaseDrop(tight, "x.md", patch1, { before: "p1.md" }, on);
			expect(sets(plan)).toEqual([
				["x.md", { version_target: "v0.4.1", release_rank: 2048 }, undefined],
				["p1.md", { release_rank: 3072 }, undefined],
			]);
		});
	});

	describe("a sliced column", () => {
		it("lands next to the visible neighbour, whatever the slice hides", () => {
			// A slice shows only a and c. Dropped just above c, x lands directly
			// before c in the full column (after the hidden b) — not at the sliced
			// index 1, which would put it above b.
			const cards = [...ranked(), rc("x", "v0.5.0")];
			const plan = planReleaseDrop(cards, "x.md", line04, { before: "c.md" }, on);
			expect(plan?.patches[0].set[RELEASE]).toBe(2560);
		});
	});
});

