/**
 * The pure core of the Meet fetch (US00001). Everything network-facing is a
 * thin shell over these, which is what keeps the suite meaningful without
 * stubbing Google — the OAuth flow and real Drive responses are the spike's job
 * and the manual test plan's, not CI's.
 *
 * The cases here are the ones that actually bit during the spike: two filename
 * spellings for the same document, presence checked by id rather than name, and
 * a document that carries no transcript because transcription was switched off.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	artifactKind,
	docsToMarkdown,
	driveQuery,
	parseDocId,
	parseIcsEvents,
	pickIcsEvent,
	resolveConfigPath,
	hasTranscriptSection,
	matchesMeeting,
	parseArtifactName,
	pickCandidate,
	renderFrontmatter,
	safeFileName,
	scanFetched,
	titlesMatch,
} from "../scripts/dispatch/meet-fetch.mjs";

const DRIVE_NAME = "Einführung in Dispatch - 2026/09/01 14:28 CEST - Notes by Gemini";
const DISK_NAME = "Einführung in Dispatch - 2026_09_01 14_28 CEST - Notes by Gemini";

describe("parseArtifactName", () => {
	it("reads the Drive spelling, with slashes and a colon", () => {
		expect(parseArtifactName(DRIVE_NAME)).toEqual({
			title: "Einführung in Dispatch",
			date: "2026-09-01",
			time: "14:28",
			tz: "CEST",
			label: "Notes by Gemini",
		});
	});

	it("reads the on-disk spelling identically", () => {
		// A fetched file has the filesystem-illegal characters replaced, so the
		// same document parses back to the same meeting. If these two ever
		// diverge, every already-fetched file stops being recognisable.
		expect(parseArtifactName(DISK_NAME)).toEqual(parseArtifactName(DRIVE_NAME));
	});

	it("tolerates a .md extension, so a fetched file round-trips", () => {
		expect(parseArtifactName(`${DISK_NAME}.md`)).toEqual(parseArtifactName(DRIVE_NAME));
	});

	it("keeps a hyphen that belongs to the title", () => {
		const parsed = parseArtifactName("Q3 Review - Sales - 2026/07/14 09:15 CEST - Notes by Gemini");
		expect(parsed?.title).toBe("Q3 Review - Sales");
		expect(parsed?.date).toBe("2026-07-14");
	});

	it("returns null for a name that is not an artifact", () => {
		expect(parseArtifactName("2026-09-01 - Dispatch Introduction.md")).toBeNull();
		expect(parseArtifactName("")).toBeNull();
	});
});

describe("matchesMeeting", () => {
	const parsed = parseArtifactName(DRIVE_NAME);

	it("matches on title and date", () => {
		expect(matchesMeeting(parsed, "Einführung in Dispatch", "2026-09-01")).toBe(true);
	});

	it("ignores case, accents and punctuation in the title", () => {
		// The board's note title and Google's filename are typed by different
		// people at different times; only the words are reliably the same.
		expect(matchesMeeting(parsed, "einfuhrung, in dispatch!", "2026-09-01")).toBe(true);
	});

	it("rejects the right title on the wrong day", () => {
		expect(matchesMeeting(parsed, "Einführung in Dispatch", "2026-09-02")).toBe(false);
	});

	it("separates two meetings held the same day when a time is given", () => {
		const morning = parseArtifactName("Standup - 2026/09/01 09:00 CEST - Notes by Gemini");
		const evening = parseArtifactName("Standup - 2026/09/01 17:00 CEST - Notes by Gemini");
		expect(matchesMeeting(morning, "Standup", "2026-09-01 09:00")).toBe(true);
		expect(matchesMeeting(evening, "Standup", "2026-09-01 09:00")).toBe(false);
		// Without a time, either is an acceptable match for that day.
		expect(matchesMeeting(evening, "Standup", "2026-09-01")).toBe(true);
	});

	it("is false for an unparseable name rather than throwing", () => {
		expect(matchesMeeting(null, "Anything", "2026-09-01")).toBe(false);
	});
});

describe("driveQuery", () => {
	it("restricts to untrashed Google Docs", () => {
		const q = driveQuery("Einführung in Dispatch", "2026-09-01");
		expect(q).toContain("mimeType = 'application/vnd.google-apps.document'");
		expect(q).toContain("trashed = false");
	});

	it("filters on the date, not the title, when a date is known", () => {
		// Measured against the real corpus on 2026-09-02: Drive's `name contains`
		// is token-AND with prefix matching, so one wrong word zeroes the result
		// server-side and no client-side leniency can recover it. The date has no
		// such failure mode.
		const q = driveQuery("Dispatch Introduction", "2026-09-01");
		expect(q).toContain("name contains '2026-09-01'");
		expect(q).not.toContain("Dispatch Introduction");
	});

	it("falls back to the title when no date is given", () => {
		expect(driveQuery("Einführung in Dispatch", undefined)).toContain(
			"name contains 'Einführung in Dispatch'"
		);
	});

	it("ignores a date it cannot use", () => {
		expect(driveQuery("Standup", "last Tuesday")).toContain("name contains 'Standup'");
	});

	it("escapes a quote instead of breaking the query", () => {
		expect(driveQuery("Kai's Meeting", undefined)).toContain("name contains 'Kai\\'s Meeting'");
	});
});

describe("titlesMatch", () => {
	it("accepts a title that contains the other", () => {
		expect(titlesMatch("Product Weekly", "Charles Product Weekly")).toBe(true);
		expect(titlesMatch("Charles Product Weekly", "Product Weekly")).toBe(true);
	});

	it("rejects two unrelated titles", () => {
		expect(titlesMatch("Dispatch Introduction", "Einführung in Dispatch")).toBe(false);
	});

	it("is false for an empty side rather than matching everything", () => {
		expect(titlesMatch("", "Standup")).toBe(false);
		expect(titlesMatch("Standup", "  ")).toBe(false);
	});
});

describe("pickCandidate", () => {
	const file = (name: string, id = name) => ({ id, name });

	const dispatch = file(DRIVE_NAME, "1Add4g");
	const weeklyA = file("Charles Product Weekly - 2026/07/28 09:14 CEST - Notes by Gemini", "w1");
	const standupAm = file("Standup - 2026/09/03 09:00 CEST - Notes by Gemini", "s1");
	const standupPm = file("Standup - 2026/09/03 17:00 CEST - Notes by Gemini", "s2");
	const other = file("Retro - 2026/09/03 11:00 CEST - Notes by Gemini", "r1");

	it("matches on the date when the titles share nothing at all", () => {
		// The 2026-09-02 failure, exactly: the wiki note is "Dispatch
		// Introduction", the calendar event was "Einführung in Dispatch".
		const picked = pickCandidate([dispatch], "Dispatch Introduction", "2026-09-01");
		expect(picked?.file.id).toBe("1Add4g");
		expect(picked?.titleAgrees).toBe(false);
	});

	it("reports that the title agreed when it did", () => {
		const picked = pickCandidate([dispatch], "Einführung in Dispatch", "2026-09-01");
		expect(picked?.titleAgrees).toBe(true);
	});

	it("ignores documents from other days", () => {
		expect(pickCandidate([dispatch, weeklyA], "anything", "2026-09-01")?.file.id).toBe("1Add4g");
	});

	it("uses the title to separate two meetings on one day", () => {
		expect(pickCandidate([standupAm, other], "Retro", "2026-09-03")?.file.id).toBe("r1");
	});

	it("uses the time to separate the same meeting held twice", () => {
		expect(pickCandidate([standupAm, standupPm], "Standup", "2026-09-03 17:00")?.file.id).toBe("s2");
	});

	it("returns null rather than guessing between two equal candidates", () => {
		// Two same-titled meetings that day and no time given: reporting beats
		// picking one and writing a report from the wrong transcript.
		expect(pickCandidate([standupAm, standupPm], "Standup", "2026-09-03")).toBeNull();
	});

	it("returns null when nothing was recorded that day", () => {
		expect(pickCandidate([dispatch], "Einführung in Dispatch", "2026-09-05")).toBeNull();
	});

	it("survives an empty list and unparseable names", () => {
		expect(pickCandidate([], "Standup", "2026-09-03")).toBeNull();
		expect(pickCandidate([file("not an artifact.md")], "Standup", "2026-09-03")).toBeNull();
	});
});

describe("scanFetched", () => {
	function vaultWith(files: Record<string, string>): string {
		const dir = mkdtempSync(join(tmpdir(), "meet-fetch-"));
		mkdirSync(dir, { recursive: true });
		for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
		return dir;
	}

	const fetched = (id: string) =>
		renderFrontmatter({
			meeting_date: "2026-09-01",
			artifact: "notes",
			doc_id: id,
			fetched: "2026-09-02",
		}) + "# Notizen\n";

	it("returns the doc_id of each fetched file", () => {
		const dir = vaultWith({ [`${DISK_NAME}.md`]: fetched("1Add4g") });
		expect(scanFetched(dir).has("1Add4g")).toBe(true);
	});

	it("still finds a file that was renamed on disk", () => {
		// This is the property the doc_id decision bought: presence is exact and
		// survives both a human renaming a file and Google renaming its
		// artifacts, which it last did in July 2026.
		const dir = vaultWith({ "something else entirely.md": fetched("1Add4g") });
		expect(scanFetched(dir).has("1Add4g")).toBe(true);
	});

	it("ignores a hand-downloaded file with no frontmatter", () => {
		// Accepted cost, recorded in the plan's risks: the five files already in
		// the folder have no frontmatter, so the first run re-downloads them.
		const dir = vaultWith({ [`${DISK_NAME}.md`]: "# Notizen\n\nNo frontmatter here.\n" });
		expect(scanFetched(dir).size).toBe(0);
	});

	it("returns an empty set for a folder that does not exist yet", () => {
		expect(scanFetched(join(tmpdir(), "meet-fetch-does-not-exist")).size).toBe(0);
	});
});

describe("hasTranscriptSection", () => {
	const dialogue = [
		"**Kai Mysliwiec:** Also, kurz zum Board.",
		"**felix Schneider:** Ja, verstehe.",
		"**Cinthia Bertsch:** Und die Chips?",
		"**Kai Mysliwiec:** Die starten den Agenten.",
		"**Rouwen Hirth:** Okay.",
	].join("\n");

	it("recognises a document whose transcript is appended", () => {
		expect(hasTranscriptSection(`# Notizen\n\nZusammenfassung.\n\n${dialogue}\n`)).toBe(true);
	});

	it("reports a notes-only document rather than throwing", () => {
		// Transcription and Gemini note-taking are separate toggles in Meet, so
		// a document with a summary and no dialogue is an ordinary outcome.
		expect(hasTranscriptSection("# Notizen\n\nEine Zusammenfassung des Transkripts.\n")).toBe(false);
	});

	it("is not fooled by a single bold line in the summary", () => {
		expect(hasTranscriptSection("# Notizen\n\n**Ergebnis:** wir bauen es.\n")).toBe(false);
	});
});

describe("resolveConfigPath", () => {
	const VAULTS = ["Dispatch-Wiki-7ea0c874.json", "Constanze-Obsidian-96d7f2ee.json"];

	it("prefers an explicit --config over everything", () => {
		const r = resolveConfigPath("/explicit.json", "/from-env.json", VAULTS);
		expect(r.path).toBe("/explicit.json");
		expect(r.how).toBe("--config");
	});

	it("expands a leading ~, which nothing else does", () => {
		// Node never expands it, and PowerShell leaves a QUOTED ~ alone when
		// passing it to a native command — so `--config "~/.dispatch/x.json"`
		// looked for a directory literally named "~". Docs and agents both write
		// paths this way, so the script has to cope rather than object.
		const r = resolveConfigPath("~/.dispatch/Dispatch-Wiki-7ea0c874.json", undefined, []);
		expect(r.path).not.toContain("~");
		expect(r.path).toContain("Dispatch-Wiki-7ea0c874.json");
		expect(r.path).toMatch(/[/\\]\.dispatch[/\\]/);
	});

	it("expands ~ in the injected path too", () => {
		expect(resolveConfigPath(undefined, "~/.dispatch/x.json", []).path).not.toContain("~");
	});

	it("leaves an ordinary absolute path exactly as given", () => {
		// Only a LEADING ~ is special; a path that merely contains one is a real
		// path and must survive untouched.
		expect(resolveConfigPath("/srv/vaults/~backup/x.json", undefined, []).path).toBe(
			"/srv/vaults/~backup/x.json"
		);
	});

	it("uses the injected path when there is no explicit one", () => {
		// The channel Dispatch uses when it launches the script, the same way
		// run-state.mjs receives DISPATCH_RUNS_FILE.
		expect(resolveConfigPath(undefined, "/from-env.json", VAULTS).path).toBe("/from-env.json");
	});

	it("falls back to the single vault on the machine", () => {
		const r = resolveConfigPath(undefined, undefined, ["Dispatch-Wiki-7ea0c874.json"]);
		expect(r.path).toContain("Dispatch-Wiki-7ea0c874.json");
	});

	it("refuses to guess between two vaults", () => {
		// ADR-0027's narrow rule, matching findAdoptionCandidate: stopping and
		// asking beats fetching a transcript into the wrong vault.
		const r = resolveConfigPath(undefined, undefined, VAULTS);
		expect(r.path).toBeNull();
		expect(r.how).toContain("2 vaults");
	});

	it("ignores files that are not vault settings", () => {
		// google.json used to live here (ADR-0024, withdrawn). It must not be
		// mistaken for a vault, or the count goes wrong.
		const r = resolveConfigPath(undefined, undefined, ["google.json", "Dispatch-Wiki-7ea0c874.json"]);
		expect(r.path).toContain("Dispatch-Wiki-7ea0c874.json");
	});

	it("reports having found nothing at all", () => {
		const r = resolveConfigPath(undefined, undefined, []);
		expect(r.path).toBeNull();
		expect(r.how).toContain("no vault");
	});
});

describe("parseIcsEvents", () => {
	// Folded exactly as Google folds it — RFC 5545 wraps at 75 octets with a
	// leading space, and the ATTACH URLs are always long enough to wrap.
	const FEED = [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"DTSTART:20260901T123000Z",
		"SUMMARY:Einführung in Dispatch",
		"UID:3lvie9bi4hf0ua5ogcj0v57nnu@google.com",
		"ATTACH;FILENAME=Notizen von Gemini;FMTTYPE=application/vnd.google-apps.docu",
		" ment:https://docs.google.com/document/d/1Add4g__42SvoPqt38tL3yYx_SBINXalKcf",
		" BlAM13kYM/edit?usp=meet_tnfm_calendar",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"DTSTART;TZID=Europe/Berlin:20260721T091500",
		"SUMMARY:Charles Product Weekly",
		"UID:6dvsas511jska3u6rudc3hb8o3@google.com",
		"RRULE:FREQ=WEEKLY;UNTIL=20260727T215959Z;BYDAY=TU",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

	it("unfolds continuation lines to recover the document link", () => {
		// The id spans three physical lines. Matching without unfolding first
		// yields a truncated id that looks plausible and 404s.
		const events = parseIcsEvents(FEED);
		expect(events[0].docId).toBe("1Add4g__42SvoPqt38tL3yYx_SBINXalKcfBlAM13kYM");
	});

	it("reads title, date and uid", () => {
		const [first] = parseIcsEvents(FEED);
		expect(first.title).toBe("Einführung in Dispatch");
		expect(first.date).toBe("2026-09-01");
		expect(first.uid).toBe("3lvie9bi4hf0ua5ogcj0v57nnu@google.com");
	});

	it("handles DTSTART with a TZID parameter", () => {
		expect(parseIcsEvents(FEED)[1].date).toBe("2026-07-21");
	});

	it("marks a recurring master, which carries no attachment", () => {
		// Measured 2026-09-02 against the real feed: the series master has no
		// ATTACH and the feed holds no per-occurrence override, so a weekly
		// meeting is not discoverable this way. Named so the gap is visible.
		const weekly = parseIcsEvents(FEED)[1];
		expect(weekly.recurring).toBe(true);
		expect(weekly.docId).toBe("");
	});

	it("survives an empty or junk feed", () => {
		expect(parseIcsEvents("")).toEqual([]);
		expect(parseIcsEvents("not a calendar")).toEqual([]);
		expect(parseIcsEvents(undefined)).toEqual([]);
	});
});

describe("pickIcsEvent", () => {
	const ev = (title: string, date: string, docId = "doc-" + date, recurring = false) => ({
		title,
		date,
		uid: `${date}@google.com`,
		docId,
		recurring,
	});

	it("matches on the date when the titles differ entirely", () => {
		const picked = pickIcsEvent([ev("Einführung in Dispatch", "2026-09-01")], "Dispatch Introduction", "2026-09-01");
		expect(picked?.docId).toBe("doc-2026-09-01");
		expect(picked?.titleAgrees).toBe(false);
	});

	it("ignores events with no attached document", () => {
		expect(pickIcsEvent([ev("Weekly", "2026-09-01", "")], "Weekly", "2026-09-01")).toBeNull();
	});

	it("uses the title to separate two meetings on one day", () => {
		const events = [ev("Standup", "2026-09-03", "a"), ev("Retro", "2026-09-03", "b")];
		expect(pickIcsEvent(events, "Retro", "2026-09-03")?.docId).toBe("b");
	});

	it("returns null rather than guessing between two equal candidates", () => {
		const events = [ev("Standup", "2026-09-03", "a"), ev("Standup", "2026-09-03", "b")];
		expect(pickIcsEvent(events, "Standup", "2026-09-03")).toBeNull();
	});

	it("survives an empty feed", () => {
		expect(pickIcsEvent([], "Anything", "2026-09-01")).toBeNull();
		expect(pickIcsEvent(undefined, "Anything", "2026-09-01")).toBeNull();
	});
});

describe("parseDocId", () => {
	const ID = "1Add4g__42SvoPqt38tL3yYx_SBINXalKcfBlAM13kYM";

	it("takes the id out of whatever the user pasted", () => {
		expect(parseDocId(`https://docs.google.com/document/d/${ID}/edit?tab=t.0`)).toBe(ID);
		expect(parseDocId(`https://docs.google.com/document/d/${ID}`)).toBe(ID);
		expect(parseDocId(ID)).toBe(ID);
		expect(parseDocId(`  ${ID}  `)).toBe(ID);
	});

	it("returns null rather than guessing at something unusable", () => {
		expect(parseDocId("https://example.com/nothing")).toBeNull();
		expect(parseDocId("Dispatch Introduction")).toBeNull();
		expect(parseDocId("")).toBeNull();
		expect(parseDocId(undefined)).toBeNull();
	});
});

describe("docsToMarkdown", () => {
	const run = (content: string, textStyle = {}) => ({ textRun: { content, textStyle } });
	const para = (elements: unknown[], extra = {}) => ({ paragraph: { elements, ...extra } });
	const tab = (content: unknown[], title?: string) => ({
		...(title ? { tabProperties: { title } } : {}),
		documentTab: { body: { content } },
	});

	it("emits each tab's title as a heading, as Drive's export does", () => {
		// "📝 Notizen" / "📖 Transkript" are what tell a reader where the summary
		// stops and the dialogue starts. Dropping them was the last gap against
		// the export — 74 headings instead of 76.
		const md = docsToMarkdown({
			tabs: [
				tab([para([run("summary")])], "📝 Notizen"),
				tab([para([run("dialogue")])], "📖 Transkript"),
			],
		});
		expect(md).toContain("# 📝 Notizen");
		expect(md).toContain("# 📖 Transkript");
	});

	it("walks every tab, not just the first", () => {
		// The Gemini meeting document has two: notes, then transcript. Without
		// includeTabsContent the API returns only the first — 200 OK, and the
		// dialogue silently absent.
		const md = docsToMarkdown({
			tabs: [tab([para([run("notes half")])]), tab([para([run("transcript half")])])],
		});
		expect(md).toContain("notes half");
		expect(md).toContain("transcript half");
	});

	it("falls back to body when the response has no tabs", () => {
		expect(docsToMarkdown({ body: { content: [para([run("plain")])] } })).toContain("plain");
	});

	it("keeps emphasis markers hugging the text", () => {
		// Google's bold range usually swallows the trailing space, and
		// `**Name: **` is not emphasis in Markdown — it renders literally.
		const md = docsToMarkdown({
			body: { content: [para([run("Kai Mysliwiec: ", { bold: true }), run("Also, kurz zum Board.")])] },
		});
		expect(md).toContain("**Kai Mysliwiec:** Also, kurz zum Board.");
		expect(md).not.toContain("**Kai Mysliwiec: **");
	});

	it("renders headings at their level", () => {
		const md = docsToMarkdown({
			body: {
				content: [
					para([run("Zusammenfassung")], { paragraphStyle: { namedStyleType: "HEADING_3" } }),
					para([run("Titel")], { paragraphStyle: { namedStyleType: "HEADING_1" } }),
				],
			},
		});
		expect(md).toContain("### Zusammenfassung");
		expect(md).toContain("# Titel");
	});

	it("renders links, bullets and italics", () => {
		const md = docsToMarkdown({
			body: {
				content: [
					para([run("Transkript", { link: { url: "https://docs.google.com/x" } })]),
					para([run("a point")], { bullet: {} }),
					para([run("betont ", { italic: true })]),
				],
			},
		});
		expect(md).toContain("[Transkript](https://docs.google.com/x)");
		expect(md).toContain("- a point");
		expect(md).toContain("*betont*");
	});

	it("renders smart chips, which are not textRuns", () => {
		// The two links missing from the first measurement were these: a person
		// chip after "Eingeladen" and a linked calendar event after "Anhänge".
		const md = docsToMarkdown({
			body: {
				content: [
					para([
						run("Eingeladen "),
						{ person: { personProperties: { name: "Felix Schneider" } } },
					]),
					para([
						run("Anhänge "),
						{
							richLink: {
								richLinkProperties: { title: "Einführung in Dispatch", uri: "https://cal/x" },
							},
						},
					]),
				],
			},
		});
		expect(md).toContain("Eingeladen Felix Schneider");
		expect(md).toContain("[Einführung in Dispatch](https://cal/x)");
	});

	it("survives an empty or malformed document", () => {
		expect(docsToMarkdown({})).toBe("\n");
		expect(docsToMarkdown({ tabs: [] , body: { content: [] } })).toBe("\n");
	});
});

describe("safeFileName", () => {
	it("replaces only what a filesystem rejects, keeping the name recognisable", () => {
		expect(safeFileName(DRIVE_NAME)).toBe(DISK_NAME);
	});

	it("produces a name that parses back to the same meeting", () => {
		expect(parseArtifactName(safeFileName(DRIVE_NAME))).toEqual(parseArtifactName(DRIVE_NAME));
	});
});

describe("artifactKind", () => {
	it("records what Google called it, in either language", () => {
		expect(artifactKind("Notes by Gemini")).toBe("notes");
		expect(artifactKind("Transcript by Gemini")).toBe("transcript");
		expect(artifactKind("Notizen von Gemini")).toBe("notes");
		expect(artifactKind("")).toBe("document");
	});
});

describe("renderFrontmatter", () => {
	it("emits the four properties the presence check and the board need", () => {
		const block = renderFrontmatter({
			meeting_date: "2026-09-01",
			artifact: "notes",
			doc_id: "1Add4g",
			fetched: "2026-09-02",
		});
		expect(block).toBe(
			"---\nmeeting_date: 2026-09-01\nartifact: notes\ndoc_id: 1Add4g\nfetched: 2026-09-02\n---\n"
		);
	});

	it("round-trips through scanFetched", () => {
		const dir = mkdtempSync(join(tmpdir(), "meet-fetch-rt-"));
		writeFileSync(
			join(dir, "x.md"),
			renderFrontmatter({
				meeting_date: "2026-09-01",
				artifact: "notes",
				doc_id: "round-trip",
				fetched: "2026-09-02",
			})
		);
		expect(scanFetched(dir).has("round-trip")).toBe(true);
	});
});
