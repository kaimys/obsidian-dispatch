/**
 * "Copy release order to Kanban" — seeding the Kanban order of one Release
 * Plan line from its release order, once, as a deliberate step (US00043).
 * Planned before anything is written (ADR-0009, as for a retarget).
 *
 * In every Kanban status column the line's cards move to the top, in release
 * order, and every other card keeps its relative order below them. Only the
 * Kanban order property is written — never status or version — and nothing
 * keeps the two orders in step afterwards.
 */
import { sortByRank } from "./cards";
import type { CardData, FileRef } from "./cards";
import { isVersionLine, orderingScope } from "./milestones";
import { planRankInsert } from "./moves";
import type { FrontmatterPatch } from "./moves";

export interface CopyOrderPlan<F extends FileRef = FileRef> {
	lineKey: string;
	/** Status columns whose order changes. */
	columns: string[];
	patches: FrontmatterPatch<F>[];
}

/**
 * The header action is offered on collapsed numeric lines, and only while
 * both orders exist to copy from and to.
 */
export function isCopyOrderSource(
	col: { key: string; isPatch?: boolean },
	releaseOrderProperty: string,
	orderProperty: string
): boolean {
	return isVersionLine(col.key) && !col.isPatch && releaseOrderProperty !== "" && orderProperty !== "";
}

/**
 * Plan the copy over every card on the board (not a slice). A status column
 * that already starts with the line's cards in release order is left alone,
 * so running the action twice writes nothing the second time.
 */
export function planCopyReleaseOrder<F extends FileRef>(
	cards: readonly CardData<F>[],
	lineKey: string,
	orderProperty: string
): CopyOrderPlan<F> {
	const line = orderingScope(cards, { key: lineKey });
	const inLine = new Set(line);
	const statuses = [...new Set(line.map((c) => c.status))];

	const columns: string[] = [];
	const patches: FrontmatterPatch<F>[] = [];
	for (const status of statuses) {
		const block = line.filter((c) => c.status === status);
		const kanban = sortByRank(cards.filter((c) => c.status === status));
		if (block.every((c, i) => kanban[i] === c)) continue;
		const others = kanban.filter((c) => !inLine.has(c));
		const plan = planRankInsert(others, block, 0, (c) => c.rank, orderProperty);
		columns.push(status);
		patches.push(...plan.patches);
	}
	return { lineKey, columns, patches };
}

/** True when two plans write the same thing (the re-plan check after the dialog). */
export function sameCopyPlan(a: CopyOrderPlan, b: CopyOrderPlan): boolean {
	const writes = (p: CopyOrderPlan) =>
		p.patches
			.map((x) => `${x.file.path}\t${JSON.stringify(Object.entries(x.set).sort())}`)
			.sort()
			.join("\n");
	return a.lineKey === b.lineKey && writes(a) === writes(b);
}
