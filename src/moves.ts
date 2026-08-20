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
import { versionKey } from "./parse";
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

	const prev = idx > 0 ? columnCards[idx - 1] : undefined;
	const next = idx < columnCards.length ? columnCards[idx] : undefined;

	const strictlyRanked =
		columnCards.every((c) => c.rank !== undefined) &&
		columnCards.every(
			(c, i) => i === 0 || (columnCards[i - 1].rank as number) < (c.rank as number)
		);

	// Preferred path: touch only the moved note.
	let singleRank: number | undefined;
	if (strictlyRanked) {
		if (prev && next) {
			if ((next.rank as number) - (prev.rank as number) > 1) {
				singleRank = Math.floor(((prev.rank as number) + (next.rank as number)) / 2);
			}
		} else if (prev) singleRank = (prev.rank as number) + RANK_GAP;
		else if (next) singleRank = (next.rank as number) - RANK_GAP;
		else singleRank = RANK_GAP;
	}

	if (singleRank !== undefined) {
		return {
			moved,
			oldStatus,
			statusChanged,
			renormalized: false,
			patches: [{ file: moved.file, set: { ...statusSet, [opts.orderProperty]: singleRank } }],
		};
	}

	// The column has unranked or duplicate ranks, or the gap is exhausted:
	// renormalize, writing only the notes whose rank actually changes.
	const desired = [...columnCards.slice(0, idx), moved, ...columnCards.slice(idx)];
	const patches: FrontmatterPatch<F>[] = [];
	for (let i = 0; i < desired.length; i++) {
		const card = desired[i];
		const rank = (i + 1) * RANK_GAP;
		const isMoved = card.file.path === path;
		if (!isMoved && card.rank === rank) continue;
		patches.push({
			file: card.file,
			set: { ...(isMoved ? statusSet : {}), [opts.orderProperty]: rank },
		});
	}
	return { moved, oldStatus, statusChanged, renormalized: true, patches };
}

/**
 * Plan a Release Plan drop: write the column's canonical version, or remove the
 * property for the (no version) column. Null when the card is already in that
 * column — dropping a card back on its own column must not rewrite the value,
 * which is what keeps a hand-written "v1.4.0" from being reformatted.
 */
export function planVersionDrop<F extends FileRef>(
	card: CardData<F>,
	col: { key: string; writeValue: string },
	versionProperty: string
): FrontmatterPatch<F> | null {
	if (versionKey(card.version) === col.key) return null;
	if (col.writeValue === "") return { file: card.file, set: {}, unset: [versionProperty] };
	return { file: card.file, set: { [versionProperty]: col.writeValue } };
}
