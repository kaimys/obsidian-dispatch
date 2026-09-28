/**
 * Keyboard focus on the board (BUG00006). A key that writes frontmatter must
 * act on the card that visibly carries the outline, and on nothing when no
 * card does. The DOM side — the outline drawn on click, the board keeping
 * focus after a tab opens — is Obsidian behaviour and stays in the manual
 * test plan (ADR-0016); what a key resolves to is asserted here.
 */
import { describe, expect, it } from "vitest";
import { focusTarget, resolveKey, splitCardPath, upcomingCardKey } from "../src/focus";
import type { FocusGrid } from "../src/focus";

/** Backlog [A, B] · In progress [] · Review [C] · Done [D, E, F] */
const COLUMNS = [["A.md", "B.md"], [], ["C.md"], ["D.md", "E.md", "F.md"]];

function grid(target: string | null, movable = true): FocusGrid {
	return { columns: COLUMNS, target, movable };
}

describe("focusTarget: one outline, one target", () => {
	it("is the outlined card when outline, focusedPath and board agree", () => {
		expect(focusTarget(["B.md"], "B.md", COLUMNS)).toBe("B.md");
	});

	it("is null when no card carries the outline", () => {
		expect(focusTarget([], "B.md", COLUMNS)).toBeNull();
		expect(focusTarget([], null, COLUMNS)).toBeNull();
	});

	it("is null when the focused card is hidden by a slice", () => {
		expect(focusTarget(["X.md"], "X.md", COLUMNS)).toBeNull();
	});

	it("is null when the outline sits on another card than focusedPath", () => {
		expect(focusTarget(["A.md"], "B.md", COLUMNS)).toBeNull();
		expect(focusTarget(["A.md"], null, COLUMNS)).toBeNull();
	});

	it("is null when two cards carry the outline", () => {
		expect(focusTarget(["A.md", "B.md"], "B.md", COLUMNS)).toBeNull();
	});
});

describe("resolveKey: no outline, no write", () => {
	it.each(["[", "]", "Enter", "o"])("%s does nothing without a target", (key) => {
		expect(resolveKey(grid(null), key)).toBeNull();
	});

	it("the reproduction: B clicked after A was arrow-focused — ] moves B, never A", () => {
		// Arrow-focus A, then click B: the click moves outline and focusedPath
		// together, so the only target left is B.
		const target = focusTarget(["B.md"], "B.md", COLUMNS);
		expect(resolveKey(grid(target), "]")).toEqual({ kind: "move", path: "B.md", column: 1 });
	});

	it("a stale focusedPath without its outline moves nothing", () => {
		const target = focusTarget([], "A.md", COLUMNS);
		expect(resolveKey(grid(target), "]")).toBeNull();
	});
});

describe("resolveKey: moves", () => {
	it("moves one column left or right, into an empty column too", () => {
		expect(resolveKey(grid("C.md"), "[")).toEqual({ kind: "move", path: "C.md", column: 1 });
		expect(resolveKey(grid("C.md"), "]")).toEqual({ kind: "move", path: "C.md", column: 3 });
	});

	it("refuses to move past the first or last column", () => {
		expect(resolveKey(grid("A.md"), "[")).toBeNull();
		expect(resolveKey(grid("F.md"), "]")).toBeNull();
	});

	it("refuses to move on a tab without movable columns, but still opens and navigates", () => {
		expect(resolveKey(grid("A.md", false), "]")).toBeNull();
		expect(resolveKey(grid("A.md", false), "[")).toBeNull();
		expect(resolveKey(grid("A.md", false), "Enter")).toEqual({ kind: "open", path: "A.md" });
		expect(resolveKey(grid("A.md", false), "ArrowDown")).toEqual({ kind: "focus", path: "B.md" });
	});
});

describe("resolveKey: navigation", () => {
	it("an arrow without a target lands on the first card", () => {
		for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
			expect(resolveKey(grid(null), key)).toEqual({ kind: "focus", path: "A.md" });
		}
	});

	it("an arrow on an empty board does nothing", () => {
		expect(resolveKey({ columns: [[], []], target: null, movable: true }, "ArrowDown")).toBeNull();
	});

	it("up and down clamp at the top and bottom of a column", () => {
		expect(resolveKey(grid("A.md"), "ArrowUp")).toEqual({ kind: "focus", path: "A.md" });
		expect(resolveKey(grid("A.md"), "ArrowDown")).toEqual({ kind: "focus", path: "B.md" });
		expect(resolveKey(grid("F.md"), "ArrowDown")).toEqual({ kind: "focus", path: "F.md" });
	});

	it("left and right skip empty columns and keep the row where they can", () => {
		expect(resolveKey(grid("B.md"), "ArrowRight")).toEqual({ kind: "focus", path: "C.md" });
		expect(resolveKey(grid("C.md"), "ArrowLeft")).toEqual({ kind: "focus", path: "A.md" });
		expect(resolveKey(grid("C.md"), "ArrowRight")).toEqual({ kind: "focus", path: "D.md" });
		expect(resolveKey(grid("E.md"), "ArrowLeft")).toEqual({ kind: "focus", path: "C.md" });
	});

	it("left or right at the edge keeps the focus where it is", () => {
		expect(resolveKey(grid("A.md"), "ArrowLeft")).toEqual({ kind: "focus", path: "A.md" });
		expect(resolveKey(grid("E.md"), "ArrowRight")).toEqual({ kind: "focus", path: "E.md" });
	});

	it("Enter and o open the target", () => {
		expect(resolveKey(grid("C.md"), "Enter")).toEqual({ kind: "open", path: "C.md" });
		expect(resolveKey(grid("C.md"), "o")).toEqual({ kind: "open", path: "C.md" });
	});

	it("any other key does nothing", () => {
		expect(resolveKey(grid("C.md"), "x")).toBeNull();
	});
});

describe("splitCardPath", () => {
	it("splits a todo card's trailing line", () => {
		expect(splitCardPath("a/b.md#12")).toEqual({ path: "a/b.md", line: 12 });
	});

	it("leaves a plain path alone", () => {
		expect(splitCardPath("a/b.md")).toEqual({ path: "a/b.md" });
	});

	it("keeps a # that is not a trailing line number", () => {
		expect(splitCardPath("a/#tag b.md")).toEqual({ path: "a/#tag b.md" });
		expect(splitCardPath("a/b#x.md")).toEqual({ path: "a/b#x.md" });
	});
});

describe("upcoming events that link the same note", () => {
	// Two calendar events on one date with a single meeting note: both link it.
	const NOTE = "09_Meetings/2026-09-30 - Sync.md";
	const first = upcomingCardKey(NOTE, 0);
	const second = upcomingCardKey(NOTE, 1);
	const meetings = [[first, second, "09_Meetings/2026-09-01 - Intro.md"]];

	it("gives each event its own identity, so the clicked one is the one outlined", () => {
		expect(first).not.toBe(second);
		expect(focusTarget([second], second, meetings)).toBe(second);
	});

	it("navigation advances past both", () => {
		const nav = (target: string, key: string) =>
			resolveKey({ columns: meetings, target, movable: false }, key);
		expect(nav(first, "ArrowDown")).toEqual({ kind: "focus", path: second });
		expect(nav(second, "ArrowDown")).toEqual({
			kind: "focus",
			path: "09_Meetings/2026-09-01 - Intro.md",
		});
		expect(nav(second, "ArrowUp")).toEqual({ kind: "focus", path: first });
	});

	it("opening either opens the linked note", () => {
		expect(splitCardPath(first)).toEqual({ path: NOTE });
		expect(splitCardPath(second)).toEqual({ path: NOTE });
	});
});
