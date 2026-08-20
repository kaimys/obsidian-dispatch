import { describe, expect, it } from "vitest";
import {
	compareRanks,
	comparePatchKeys,
	patchKey,
	resolveAssignee,
	sliceKey,
	versionKey,
} from "../src/parse";

const TEAM = ["Alex", "Robin", "Morgan"];

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

	it("renders a nested object as [object Object] today", () => {
		// Documents current behaviour, not desired behaviour: the typing pass
		// replaces this with an empty string so the UI can't show that string.
		expect(sliceKey({ level: "high" })).toBe("[object Object]");
	});
});
