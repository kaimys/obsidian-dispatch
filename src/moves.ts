/**
 * What a drag writes.
 *
 * Dropping a card can touch one note or every note in a column, and it is the
 * one place where the board mutates a person's files. Deciding *what* to write
 * is pure and lives here; performing the writes stays in the view, so the
 * decision — including "touch only the moved note" and "change nothing" — can
 * be tested without a vault.
 */
import { sortByRank } from "./cards";
import type { CardData, FileRef } from "./cards";
import { substitute } from "./exec";
import { inColumn } from "./milestones";
import type { AutomationRule } from "./settings";

/** Spacing between freshly assigned ranks — leaves room for midpoint inserts. */
export const RANK_GAP = 1024;

/** One note's frontmatter change. */
export interface FrontmatterPatch<F extends FileRef = FileRef> {
	file: F;
	/** Properties to write. */
	set: Record<string, unknown>;
	/** Properties to remove. */
	unset?: string[];
}

export interface StatusDropPlan<F extends FileRef = FileRef> {
	moved: CardData<F>;
	oldStatus: string;
	statusChanged: boolean;
	patches: FrontmatterPatch<F>[];
	/** True when the column had to be rewritten instead of one note. */
	renormalized: boolean;
}

/**
 * Frontmatter assignments from every automation rule matching the target
 * status. `now` is injectable so a stamped date is testable.
 */
export function ruleSetsFor(
	automations: AutomationRule[],
	from: string,
	to: string,
	now: Date = new Date()
): Record<string, string> {
	const out: Record<string, string> = {};
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
		now.getDate()
	).padStart(2, "0")}`;
	for (const rule of automations) {
		if (rule.when.length > 0 && !rule.when.includes(to)) continue;
		for (const [key, value] of Object.entries(rule.set ?? {})) {
			out[key] = substitute(value, { date, datetime: now.toISOString(), from, to });
		}
	}
	return out;
}

/**
 * Plan a Kanban drop: the status change, the new position, and any automation
 * stamps — as the exact set of frontmatter writes. Returns null when the drop
 * is a no-op (unknown card, or dropped back where it already was), so an
 * accidental drag never rewrites a note.
 */
export function planStatusDrop<F extends FileRef>(
	cards: CardData<F>[],
	path: string,
	newStatus: string,
	insertIndex: number,
	opts: {
		statusProperty: string;
		orderProperty: string;
		automations?: AutomationRule[];
		now?: Date;
	}
): StatusDropPlan<F> | null {
	const moved = cards.find((c) => c.file.path === path);
	if (!moved) return null;

	const oldStatus = moved.status;
	const statusChanged = oldStatus !== newStatus;
	const ruleSets = statusChanged
		? ruleSetsFor(opts.automations ?? [], oldStatus, newStatus, opts.now)
		: {};
	const statusSet = statusChanged ? { [opts.statusProperty]: newStatus, ...ruleSets } : {};

	// Ordering disabled — drops only change status.
	if (!opts.orderProperty) {
		if (!statusChanged) return null;
		return {
			moved,
			oldStatus,
			statusChanged,
			renormalized: false,
			patches: [{ file: moved.file, set: statusSet }],
		};
	}

	const columnCards = sortByRank(
		cards.filter((c) => c.status === newStatus && c.file.path !== path)
	);

	// The visual index counts the moved card itself on same-column drags.
	let idx = insertIndex;
	let origIdx = -1;
	if (!statusChanged) {
		const visual = sortByRank(cards.filter((c) => c.status === newStatus));
		origIdx = visual.findIndex((c) => c.file.path === path);
		if (origIdx !== -1 && origIdx < idx) idx--;
	}
	idx = Math.max(0, Math.min(idx, columnCards.length));
	if (!statusChanged && idx === origIdx) return null;

	const { patches, renormalized } = planRankInsert(
		columnCards,
		[moved],
		idx,
		(c) => c.rank,
		opts.orderProperty
	);
	// Status and automation stamps travel in the moved note's own patch.
	for (const patch of patches) {
		if (patch.file.path === path) patch.set = { ...statusSet, ...patch.set };
	}
	return { moved, oldStatus, statusChanged, renormalized, patches };
}

/**
 * The gap-based ordering maths shared by every ordering write (ADR-0007):
 * place `moved` — one card or a block, in the order given — at `index` of
 * `scope`, which is in display order and must not contain `moved`.
 *
 * When the scope is strictly ranked and the neighbours leave room, only the
 * moved notes are written: evenly spaced between the neighbours (the midpoint
 * for a single card), or a gap apart at either end. Otherwise the whole scope
 * is renumbered in its displayed order, writing the moved notes and only
 * those others whose value actually changes.
 */
export function planRankInsert<F extends FileRef>(
	scope: CardData<F>[],
	moved: CardData<F>[],
	index: number,
	rankOf: (card: CardData<F>) => number | undefined,
	property: string
): { patches: FrontmatterPatch<F>[]; renormalized: boolean } {
	const idx = Math.max(0, Math.min(index, scope.length));
	const n = moved.length;
	const prevRank = idx > 0 ? rankOf(scope[idx - 1]) : undefined;
	const nextRank = idx < scope.length ? rankOf(scope[idx]) : undefined;

	const ranks = scope.map(rankOf);
	const strictlyRanked =
		ranks.every((r) => r !== undefined) &&
		ranks.every((r, i) => i === 0 || (ranks[i - 1] as number) < (r as number));

	// Preferred path: touch only the moved notes.
	let placed: number[] | undefined;
	if (strictlyRanked) {
		const hasPrev = idx > 0;
		const hasNext = idx < scope.length;
		const p = prevRank as number;
		const q = nextRank as number;
		if (hasPrev && hasNext) {
			if (q - p > n) {
				placed = moved.map((_, i) => Math.floor((p * (n - i) + q * (i + 1)) / (n + 1)));
			}
		} else if (hasPrev) placed = moved.map((_, i) => p + (i + 1) * RANK_GAP);
		else if (hasNext) placed = moved.map((_, i) => q - (n - i) * RANK_GAP);
		else placed = moved.map((_, i) => (i + 1) * RANK_GAP);
	}

	if (placed) {
		const ranksPlaced = placed;
		return {
			renormalized: false,
			patches: moved.map((card, i) => ({ file: card.file, set: { [property]: ranksPlaced[i] } })),
		};
	}

	// The scope has unranked or duplicate ranks, or the gap is exhausted:
	// renumber, writing only the notes whose rank actually changes.
	const movedPaths = new Set(moved.map((c) => c.file.path));
	const desired = [...scope.slice(0, idx), ...moved, ...scope.slice(idx)];
	const patches: FrontmatterPatch<F>[] = [];
	for (let i = 0; i < desired.length; i++) {
		const card = desired[i];
		const rank = (i + 1) * RANK_GAP;
		if (!movedPaths.has(card.file.path) && rankOf(card) === rank) continue;
		patches.push({ file: card.file, set: { [property]: rank } });
	}
	return { renormalized: true, patches };
}

/**
 * Plan a Release Plan drop: write the column's canonical version, or remove the
 * property for the (no version) column. Null when the card is already in that
 * column — dropping a card back on its own column must not rewrite the value,
 * which is what keeps a hand-written "v1.4.0" from being reformatted. A patch
 * column holds its exact patch, so "already in it" is decided the same way
 * the board fills it (`inColumn`).
 */
export function planVersionDrop<F extends FileRef>(
	card: CardData<F>,
	col: { key: string; writeValue: string; isPatch?: boolean },
	versionProperty: string
): FrontmatterPatch<F> | null {
	if (inColumn(card, col)) return null;
	if (col.writeValue === "") return { file: card.file, set: {}, unset: [versionProperty] };
	return { file: card.file, set: { [versionProperty]: col.writeValue } };
}
