import { describe, expect, it } from "vitest";
import {
	formatChipLabel,
	parseChipLabel,
	compareRanks,
	displayValue,
	comparePatchKeys,
	patchKey,
	resolveAssignee,
	sliceKey,
	versionKey,
} from "../src/parse";

const TEAM = ["Alex", "Robin", "Morgan"];

/**
 * R3: the chip-template row rebuilds the whole model on every keystroke, and
 * drops a row whose label is momentarily empty. Any scheme that recovers
 * `intent` from the previous list therefore loses it mid-rename, and cannot
 * tell two chips apart when they share a label. So the intent lives in the text.
 */
describe("parseChipLabel / formatChipLabel", () => {
	it("reads an intent off the label cell", () => {
		expect(parseChipLabel("Refine #refine")).toEqual({ label: "Refine", intent: "refine" });
	});

	it("leaves a plain label alone", () => {
		expect(parseChipLabel("Start development")).toEqual({ label: "Start development" });
	});

	it("does not mistake a # inside a label for an intent", () => {
		expect(parseChipLabel("C# helper")).toEqual({ label: "C# helper" });
		expect(parseChipLabel("Refine # not an intent")).toEqual({
			label: "Refine # not an intent",
		});
	});

	it("round-trips", () => {
		for (const chip of [
			{ label: "Refine", intent: "refine" },
			{ label: "Start development" },
			{ label: "Review", intent: "code-review" },
		]) {
			expect(parseChipLabel(formatChipLabel(chip))).toEqual(chip);
		}
	});

	it("survives a rename, because the intent is not tied to the name", () => {
		const renamed = parseChipLabel("Sharpen #refine");
		expect(renamed).toEqual({ label: "Sharpen", intent: "refine" });
	});

	it("survives clearing the name and typing a new one, across separate edits", () => {
		// The textarea fires per keystroke. Mid-rename the cell is just "#refine":
		// the row has no label, so it drops out for that event — and comes back
		// intact, because the intent was never anywhere but the text.
		const midRename = parseChipLabel("#refine");
		expect(midRename.label).toBe("");
		expect(midRename.intent).toBe("refine");
		expect(parseChipLabel("Sharpen #refine").intent).toBe("refine");
	});

	it("keeps two chips with the same label apart", () => {
		// The previous by-label recovery gave both of these the second intent,
		// which could launch the wrong workflow.
		expect(parseChipLabel("Run #refine").intent).toBe("refine");
		expect(parseChipLabel("Run #develop").intent).toBe("develop");
	});
});


describe("resolveAssignee", () => {
	it("matches a known name regardless of case and punctuation", () => {
		expect(resolveAssignee("Alex", TEAM)).toBe("Alex");
		expect(resolveAssignee("alex", TEAM)).toBe("Alex");
		expect(resolveAssignee("ALEX:", TEAM)).toBe("Alex");
	});

	it("matches on the first word, so full names resolve to the configured one", () => {
		expect(resolveAssignee("Alex", ["Alex Kim"])).toBe("Alex Kim");
		expect(resolveAssignee("Alex Kim", ["Alex"])).toBe("Alex");
	});

	it("rejects labels that only look like owners", () => {
		// The two that caused real misattribution on the Todos board.
		expect(resolveAssignee("US00055", TEAM)).toBeNull();
		expect(resolveAssignee("Friday", TEAM)).toBeNull();
		expect(resolveAssignee("Team", TEAM)).toBeNull();
	});

	it("accepts any label when no assignee list is configured", () => {
		expect(resolveAssignee("US00055", [])).toBe("US00055");
	});

	it("treats empty and punctuation-only labels as no owner", () => {
		expect(resolveAssignee("", TEAM)).toBeNull();
		expect(resolveAssignee("   ", TEAM)).toBeNull();
		expect(resolveAssignee("--", TEAM)).toBeNull();
		expect(resolveAssignee(undefined, TEAM)).toBeNull();
	});
});

describe("versionKey / patchKey", () => {
	it("normalizes the three ways people write the same release", () => {
		for (const raw of ["v1.4.0", "1.4.0", "1.4", " V1.4.2 "]) {
			expect(versionKey(raw)).toBe("1.4");
		}
	});

	it("keeps the patch component when there is one", () => {
		expect(patchKey("v1.4.0")).toBe("1.4.0");
		expect(patchKey("1.4.1")).toBe("1.4.1");
		expect(patchKey("v1.4")).toBe("1.4"); // no patch → collapses to the line
	});

	it("passes non-version values through untouched", () => {
		expect(versionKey("Icebox")).toBe("Icebox");
		expect(patchKey("Icebox")).toBe("Icebox");
		expect(versionKey("")).toBe("");
	});

	it("orders patches within a line, bare line key first", () => {
		const keys = ["1.4.2", "1.4", "1.4.0", "1.4.1"].sort(comparePatchKeys);
		expect(keys).toEqual(["1.4", "1.4.0", "1.4.1", "1.4.2"]);
	});
});

describe("compareRanks", () => {
	it("orders ranked cards ascending and unranked ones last", () => {
		expect(compareRanks(1024, 2048)).toBeLessThan(0);
		expect(compareRanks(2048, 1024)).toBeGreaterThan(0);
		expect(compareRanks(1024, undefined)).toBeLessThan(0);
		expect(compareRanks(undefined, 1024)).toBeGreaterThan(0);
	});

	it("treats equal ranks as ties, so the caller's next key decides", () => {
		// Two tickets carrying the same rank is a copy-paste people make often.
		expect(compareRanks(1024, 1024)).toBe(0);
		expect(compareRanks(undefined, undefined)).toBe(0);
	});
});

describe("displayValue", () => {
	it("renders the scalars people put in frontmatter", () => {
		expect(displayValue("high")).toBe("high");
		expect(displayValue(3)).toBe("3");
		expect(displayValue(0)).toBe("0"); // not "" — a real zero must survive
		expect(displayValue(false)).toBe("false");
	});

	it("renders a list as its items", () => {
		expect(displayValue(["a", "b"])).toBe("a,b");
		expect(displayValue([])).toBe("");
	});

	it("renders nothing for values a person cannot read", () => {
		expect(displayValue(undefined)).toBe("");
		expect(displayValue(null)).toBe("");
		expect(displayValue({ level: "high" })).toBe("");
		expect(displayValue([{ a: 1 }, "keep"])).toBe("keep"); // objects drop out of a list
	});
});

describe("sliceKey", () => {
	it("collapses missing and empty values into one bucket", () => {
		expect(sliceKey(undefined)).toBe("(none)");
		expect(sliceKey(null)).toBe("(none)");
		expect(sliceKey("")).toBe("(none)");
	});

	it("stringifies scalars and lists", () => {
		expect(sliceKey("high")).toBe("high");
		expect(sliceKey(3)).toBe("3");
		expect(sliceKey(false)).toBe("false");
		expect(sliceKey(["a", "b"])).toBe("a,b");
	});

	it("groups a nested object under (none) rather than showing [object Object]", () => {
		// Frontmatter holds whatever the writer typed. A slice chip labelled
		// "[object Object]" is never useful, so an object counts as no value.
		expect(sliceKey({ level: "high" })).toBe("(none)");
		expect(sliceKey([{ a: 1 }])).toBe("(none)");
	});
});
