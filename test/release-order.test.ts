/**
 * "Copy release order to Kanban" (US00043): one deliberate batch that seeds
 * the Kanban order of a line's cards from their release order. The planner is
 * the only place it can be asserted (ADR-0016); the menu and modal are not.
 */
import { describe, expect, it } from "vitest";
import { buildCard } from "../src/cards";
import { RANK_GAP } from "../src/moves";
import { isCopyOrderSource, planCopyReleaseOrder, sameCopyPlan } from "../src/release-order";
import { CARD_SETTINGS } from "./harness";

const ORDER = "rank";

const rc = (name: string, version: string, fm: Record<string, unknown> = {}) =>
	buildCard(
		{ path: `${name}.md`, basename: name },
		{ status: "Refinement", version_target: version, ...fm },
		CARD_SETTINGS
	);
const writes = (p: ReturnType<typeof planCopyReleaseOrder>) =>
	p.patches.map((x) => [x.file.path, x.set]);

describe("copying a line's release order", () => {
	it("puts the line's cards on top of each status column, in release order", () => {
		const cards = [
			rc("other1", "v0.5.0", { rank: 4096 }),
			rc("other2", "v0.5.0", { rank: 8192 }),
			rc("second", "v0.4.0", { rank: 9000, release_rank: 2048 }),
			rc("first", "v0.4.0", { rank: 20000, release_rank: 1024 }),
			rc("dev", "v0.4.0", { status: "Development", rank: 50, release_rank: 3072 }),
			rc("devOther", "v0.5.0", { status: "Development", rank: 10 }),
		];
		const p = planCopyReleaseOrder(cards, "0.4", ORDER);
		expect(p.columns).toEqual(["Refinement", "Development"]);
		// Only the line's cards are written: there is room above the others.
		expect(writes(p)).toEqual([
			["first.md", { rank: 4096 - 2 * RANK_GAP }],
			["second.md", { rank: 4096 - RANK_GAP }],
			["dev.md", { rank: 10 - RANK_GAP }],
		]);
	});

	it("writes nothing on a second run", () => {
		const cards = [
			rc("first", "v0.4.0", { rank: 1024, release_rank: 1024 }),
			rc("second", "v0.4.0", { rank: 2048, release_rank: 2048 }),
			rc("other", "v0.5.0", { rank: 3072 }),
		];
		const p = planCopyReleaseOrder(cards, "0.4", ORDER);
		expect(p.patches).toEqual([]);
		expect(p.columns).toEqual([]);
	});

	it("moves only the line's own open cards, not archived ones or other lines", () => {
		const cards = [
			// Finished without a version: archived, so never part of a line.
			rc("gone", "", { status: "Deployed", rank: 1 }),
			rc("next", "v0.5.0", { status: "Deployed", rank: 2, release_rank: 0 }),
			rc("mine", "v0.4.0", { status: "Deployed", rank: 3072, release_rank: 1 }),
		];
		const p = planCopyReleaseOrder(cards, "0.4", ORDER);
		expect(writes(p)).toEqual([["mine.md", { rank: 1 - RANK_GAP }]]);
	});

	it("renumbers a status column with unranked cards, and never writes status or version", () => {
		const cards = [rc("loose", "v0.5.0"), rc("mine", "v0.4.0", { release_rank: 1024 })];
		const p = planCopyReleaseOrder(cards, "0.4", ORDER);
		expect(writes(p)).toEqual([
			["mine.md", { rank: 1024 }],
			["loose.md", { rank: 2048 }],
		]);
	});

	it("is offered on collapsed numeric lines with both orders configured", () => {
		expect(isCopyOrderSource({ key: "0.4" }, "release_rank", "rank")).toBe(true);
		expect(isCopyOrderSource({ key: "0.4.1", isPatch: true }, "release_rank", "rank")).toBe(false);
		expect(isCopyOrderSource({ key: "" }, "release_rank", "rank")).toBe(false);
		expect(isCopyOrderSource({ key: "Icebox" }, "release_rank", "rank")).toBe(false);
		expect(isCopyOrderSource({ key: "0.4" }, "", "rank")).toBe(false);
		expect(isCopyOrderSource({ key: "0.4" }, "release_rank", "")).toBe(false);
	});

	it("detects a board that changed while the dialog was open", () => {
		const cards = [rc("mine", "v0.4.0", { release_rank: 1 }), rc("other", "v0.5.0", { rank: 4096 })];
		const before = planCopyReleaseOrder(cards, "0.4", ORDER);
		const after = planCopyReleaseOrder([...cards, rc("new", "v0.5.0", { rank: 100 })], "0.4", ORDER);
		expect(sameCopyPlan(before, after)).toBe(false);
		expect(sameCopyPlan(before, planCopyReleaseOrder(cards, "0.4", ORDER))).toBe(true);
	});
});
