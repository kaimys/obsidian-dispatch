/**
 * Keyboard focus on the board — which card a key acts on, decided before the
 * view does anything (ADR-0009's plan-then-write, applied to one key press).
 *
 * The view keeps three pieces of focus state: `focusedPath`, the
 * `dispatch-card-focused` outline, and DOM focus. They drifted apart once
 * (BUG00006: `]` moved a card the user could not see was focused), so a key
 * resolves its target here from a snapshot of all of them, and a key that
 * writes acts only on the card that visibly carries the outline.
 */

/** A snapshot of the board a key press is resolved against. */
export interface FocusGrid {
	/** Each column's focusable card paths, top to bottom. */
	columns: string[][];
	/** The card key actions may act on: see `focusTarget`. */
	target: string | null;
	/** Whether `[` / `]` may move a card (the Status and Release Plan tabs). */
	movable: boolean;
}

export type KeyAction =
	| { kind: "focus"; path: string }
	| { kind: "open"; path: string }
	| { kind: "move"; path: string; column: number };

/**
 * The card a key may act on: the one card that carries the outline, provided
 * it is `focusedPath` and is on the board. Null for no outline, two outlines,
 * an outline that disagrees with `focusedPath`, or a card a slice hides — no
 * outline, no write.
 */
export function focusTarget(
	outlined: readonly string[],
	focusedPath: string | null,
	columns: readonly (readonly string[])[]
): string | null {
	if (outlined.length !== 1 || outlined[0] !== focusedPath) return null;
	return columns.some((col) => col.includes(focusedPath)) ? focusedPath : null;
}

/** What a key press does on the grid, or null when it does nothing. */
export function resolveKey(grid: FocusGrid, key: string): KeyAction | null {
	const { columns, target } = grid;
	let colIdx = -1;
	let rowIdx = -1;
	if (target !== null) {
		colIdx = columns.findIndex((col) => col.includes(target));
		if (colIdx !== -1) rowIdx = columns[colIdx].indexOf(target);
	}
	const nextColumnWithCards = (start: number, dir: number): number => {
		for (let i = start + dir; i >= 0 && i < columns.length; i += dir) {
			if (columns[i].length > 0) return i;
		}
		return -1;
	};
	const focusAt = (ci: number, ri: number): KeyAction => {
		const col = columns[ci];
		return { kind: "focus", path: col[Math.max(0, Math.min(ri, col.length - 1))] };
	};

	switch (key) {
		case "ArrowDown":
		case "ArrowUp":
		case "ArrowLeft":
		case "ArrowRight": {
			if (colIdx === -1) {
				const first = nextColumnWithCards(-1, 1);
				return first === -1 ? null : focusAt(first, 0);
			}
			if (key === "ArrowDown" || key === "ArrowUp") {
				return focusAt(colIdx, rowIdx + (key === "ArrowDown" ? 1 : -1));
			}
			const next = nextColumnWithCards(colIdx, key === "ArrowRight" ? 1 : -1);
			return next === -1 ? focusAt(colIdx, rowIdx) : focusAt(next, rowIdx);
		}
		case "Enter":
		case "o":
			return colIdx === -1 ? null : { kind: "open", path: columns[colIdx][rowIdx] };
		case "[":
		case "]": {
			if (colIdx === -1 || !grid.movable) return null;
			const column = colIdx + (key === "]" ? 1 : -1);
			if (column < 0 || column >= columns.length) return null;
			return { kind: "move", path: columns[colIdx][rowIdx], column };
		}
		default:
			return null;
	}
}

/**
 * A card's note and, for a todo card (`file#line`), the line to open it at.
 * Only a trailing `#<digits>` is a line; any other `#` is part of the path.
 */
export function splitCardPath(path: string): { path: string; line?: number } {
	const m = path.match(/^(.*)#(\d+)$/);
	return m ? { path: m[1], line: Number(m[2]) } : { path };
}
