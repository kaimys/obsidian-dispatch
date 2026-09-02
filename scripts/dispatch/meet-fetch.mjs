#!/usr/bin/env node
/**
 * Fetch a Google Meet meeting's Gemini document into the vault (US00001).
 *
 * Usage
 * -----
 *   node scripts/dispatch/meet-fetch.mjs --auth
 *       One-time consent. Opens a loopback OAuth flow and stores the refresh
 *       token in the vault's device file. Every later run is non-interactive.
 *
 *   node scripts/dispatch/meet-fetch.mjs --title "<meeting title>" \
 *        --date YYYY-MM-DD --dir <folder>
 *       Finds the meeting's document by title + date, exports it as Markdown
 *       and writes it into <folder>. Prints one line per outcome.
 *
 *   node scripts/dispatch/meet-fetch.mjs --list [--date YYYY-MM-DD]
 *       Show the meeting documents in reach, with the title and date each one
 *       parses to. Use it when a fetch reports no match.
 *
 *   --dry-run   report what would be fetched, write nothing
 *
 * Matching
 * --------
 * The DATE is the key; the title only disambiguates two meetings on one day.
 * The note's title and Google's need not agree — Google names the document
 * after the calendar event, and on 2026-09-02 "Dispatch Introduction" and
 * "Einführung in Dispatch" shared no word at all. Requiring them to match is
 * what made that meeting unfindable.
 *
 * What Google actually produces
 * -----------------------------
 * ONE Google Doc per meeting: `<Title> - YYYY/MM/DD HH:MM TZ - Notes by Gemini`,
 * holding the Gemini summary followed by the full transcript with speaker
 * labels. There is no separate "Transcript by Gemini" file any more — see
 * US00001's 2026-09-02 correction. A meeting recorded with note-taking but
 * without transcription yields the same document minus the dialogue, which is
 * why the transcript check is on content, not on a filename.
 *
 * Discovery
 * ---------
 * The CALENDAR FEED, and only that: the ICS carries each meeting's document as
 * an `ATTACH` property, and reading it costs no Google permission at all.
 * Recurring meetings work — Google attaches the notes to the occurrence, which
 * appears in the feed in its own right. When the feed has no link, because the
 * meeting has aged out of its window or the series has ended, the user pastes
 * the link with `--doc` or downloads the document by hand. Nothing searches
 * Drive.
 *
 * Scopes
 * ------
 * Exactly one: `documents.readonly`, which is *sensitive* rather than
 * restricted. Nothing else is ever requested.
 *
 * Config: the vault's own device file, `~/.dispatch/<vault>-<hash>.json`, under
 * a `google` key — this is a Dispatch-scope script, so its settings are ordinary
 * device settings (ADR-0027). Google's own downloaded client JSON works
 * unmodified. A pre-ADR-0027 `~/.dispatch/google.json` is migrated in and
 * removed on first run. Nothing is ever written into the vault except the
 * finished document.
 *
 * Zero dependencies. Node 18+.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DISPATCH_DIR = join(homedir(), ".dispatch");
/** Withdrawn by ADR-0027; still read once, to migrate it. */
const LEGACY_CONFIG = join(DISPATCH_DIR, "google.json");
const DOCS_SCOPE = "https://www.googleapis.com/auth/documents.readonly";

/**
 * ONE scope, and it is a *sensitive* one rather than a restricted one.
 *
 * `drive.meet.readonly` was requested until 2026-09-02, for discovery. It is
 * RESTRICTED, which means verifying an OAuth client on it needs an annual
 * third-party CASA assessment — the single reason a user would otherwise have
 * to create their own Google Cloud project just to import a transcript. The
 * calendar feed identifies the document without it, so it is gone rather than
 * demoted: a permission the code can still ask for is a permission the privacy
 * policy has to describe.
 */
const SCOPES = DOCS_SCOPE;

const TOKEN_KEY = "refresh_token";

// `console` is off-limits repo-wide (the Obsidian plugin ruleset lints scripts/
// too); the other scripts here write through process.stdout for the same reason.
const say = (m = "") => process.stdout.write(`${m}\n`);

// ───────────────────────────────────────────────────────────── the pure core
// Everything below this line is free of network and filesystem side effects
// except where stated, so the tests can assert it without stubbing Google.

/**
 * `<Title> - YYYY/MM/DD HH:MM TZ - Notes by Gemini` → its parts, or null.
 *
 * Two spellings exist and both are seen: Drive stores the date with slashes and
 * colons, and anything written to disk has them replaced (they are illegal in a
 * Windows filename), so a file fetched earlier parses back with underscores.
 */
export function parseArtifactName(name) {
	const m = /^(.+?) - (\d{4})[/_](\d{2})[/_](\d{2})[ _](\d{2})[:_](\d{2})(?:[ _]([A-Za-z]{2,5}))?(?: - (.+?))?$/.exec(
		String(name).replace(/\.md$/i, "").trim()
	);
	if (!m) return null;
	const [, title, y, mo, d, h, mi, tz, label] = m;
	return {
		title: title.trim(),
		date: `${y}-${mo}-${d}`,
		time: `${h}:${mi}`,
		tz: tz || "",
		label: (label || "").trim(),
	};
}

/** Google's label for the artifact, normalised. Recorded, never matched on. */
export function artifactKind(label) {
	if (/transcript|transkript/i.test(label || "")) return "transcript";
	if (/notes|notizen/i.test(label || "")) return "notes";
	return "document";
}

/** Comparable form of a meeting title: case-, accent- and punctuation-blind. */
function normaliseTitle(title) {
	return String(title)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * Do two titles name the same meeting? Normalised equality, or either one
 * containing the other.
 *
 * Deliberately lenient, and mirrors `findNoteForEvent` (src/board.ts:949-955),
 * which has always matched calendar event to note this way. The two names come
 * from different places and are not required to agree: the note is called
 * whatever its author called it, while Google uses the calendar event's title.
 * On 2026-09-02 those were "Dispatch Introduction" and "Einführung in Dispatch"
 * — no shared token at all, which is why the date carries the match and the
 * title only disambiguates.
 */
export function titlesMatch(a, b) {
	const x = normaliseTitle(a);
	const y = normaliseTitle(b);
	if (!x || !y) return false;
	return x === y || x.includes(y) || y.includes(x);
}

/**
 * The `doc_id` of every document already in `dir`.
 *
 * The presence check is by id and not by filename, so renaming a fetched file
 * does not cause a re-download, and Google renaming its artifacts again does
 * not either. Reads the directory; that is the one side effect down here.
 */
export function scanFetched(dir) {
	const ids = new Set();
	if (!existsSync(dir)) return ids;
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".md")) continue;
		const head = readFileSync(join(dir, file), "utf8").slice(0, 2000);
		const m = /^doc_id:\s*(\S+)\s*$/m.exec(head);
		if (m) ids.add(m[1]);
	}
	return ids;
}

/** The frontmatter block that makes a fetched file recognisable next time. */
export function renderFrontmatter(meta) {
	return [
		"---",
		`meeting_date: ${meta.meeting_date}`,
		`artifact: ${meta.artifact}`,
		`doc_id: ${meta.doc_id}`,
		`fetched: ${meta.fetched}`,
		"---",
		"",
	].join("\n");
}

/**
 * Does this export actually contain the dialogue?
 *
 * Speaker labels are the signature, not the word "transcript" — the summary
 * half mentions it in prose. Several labels rather than one, so a single bold
 * line in the notes cannot pass for a transcript.
 */
export function hasTranscriptSection(body) {
	const labels = String(body).match(/^\*\*[^*\n]{2,60}:\*\*/gm);
	return (labels?.length ?? 0) >= 5;
}

/**
 * A Google Docs id from whatever the user pasted — a full URL, a sharing link,
 * or the bare id. Returns null rather than guessing at something unusable.
 */
export function parseDocId(input) {
	const s = String(input || "").trim();
	if (!s) return null;
	const fromUrl = /\/document\/d\/([A-Za-z0-9_-]{20,})/.exec(s);
	if (fromUrl) return fromUrl[1];
	const fromQuery = /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
	if (fromQuery) return fromQuery[1];
	return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

/**
 * Render a `documents.get` response as Markdown.
 *
 * Needed because the Docs API returns a structure where Drive's export returns
 * finished Markdown — the price of dropping the Drive scope. Measured against
 * that export on the 2026-09-01 meeting: 448 of 448 speaker labels, 103,404 of
 * 105,288 bytes.
 *
 * Two things are easy to get wrong and both were:
 *  - **Tabs.** A Gemini meeting document has two, notes and transcript, and
 *    `documents.get` returns only the first unless `includeTabsContent=true` is
 *    set. It answers 200 either way, so the transcript goes missing silently.
 *  - **Whitespace inside a styled run.** Google's bold range usually includes
 *    the trailing space ("Kai Mysliwiec: "), and `**Name: **` is not emphasis
 *    in Markdown — it renders literally. The markers have to hug the text.
 */
export function docsToMarkdown(doc) {
	// Each tab contributes its title as a heading, which is what Drive's own
	// export does — for a Gemini meeting document those are "📝 Notizen" and
	// "📖 Transkript", i.e. the labels that tell a reader where the summary
	// stops and the dialogue starts.
	const bodies = [];
	const walk = (tabs) => {
		for (const tab of tabs || []) {
			const title = tab.tabProperties?.title;
			if (tab.documentTab?.body) bodies.push({ title, body: tab.documentTab.body });
			walk(tab.childTabs);
		}
	};
	walk(doc?.tabs);
	if (!bodies.length && doc?.body) bodies.push({ body: doc.body });

	const emphasise = (text, marker) => {
		const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
		return core ? `${lead}${marker}${core}${marker}${trail}` : text;
	};

	const out = [];
	const elements = bodies.flatMap(({ title, body }) => [
		...(title ? [{ tabTitle: title }] : []),
		...(body.content || []),
	]);
	for (const el of elements) {
		if (el.tabTitle) {
			out.push(`# ${el.tabTitle}`);
			continue;
		}
		const p = el.paragraph;
		if (!p) continue;
		const heading = /^HEADING_(\d)$/.exec(p.paragraphStyle?.namedStyleType || "");
		let line = "";
		for (const run of p.elements || []) {
			// Smart chips are their own element types, not textRuns — a person
			// chip and a linked calendar event both render as nothing if only
			// textRun is handled, which is where the two missing links went.
			if (run.person) {
				line += run.person.personProperties?.name || run.person.personProperties?.email || "";
				continue;
			}
			if (run.richLink) {
				const props = run.richLink.richLinkProperties || {};
				if (props.title) line += props.uri ? `[${props.title}](${props.uri})` : props.title;
				continue;
			}
			const t = run.textRun;
			if (!t?.content) continue;
			let text = t.content.replace(/\n$/, "");
			if (t.textStyle?.bold) text = emphasise(text, "**");
			if (t.textStyle?.italic) text = emphasise(text, "*");
			const url = t.textStyle?.link?.url;
			if (url && text.trim()) text = `[${text.trim()}](${url})`;
			line += text;
		}
		if (heading) out.push(`${"#".repeat(Math.min(6, Number(heading[1])))} ${line}`.trimEnd());
		else out.push(p.bullet ? `- ${line}`.trimEnd() : line.trimEnd());
	}
	return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/**
 * Google Calendar's ICS feed, parsed down to what discovery needs.
 *
 * The feed is the primary source for a meeting's document, because it costs no
 * Google OAuth scope at all — it is a secret URL the user already configured
 * for the Meetings tab, mirrored into `google.json` by the plugin. Each event
 * carries the Gemini document as an `ATTACH` property:
 *
 *   ATTACH;FILENAME=Notizen von Gemini;FMTTYPE=application/vnd.google-apps.document
 *    :https://docs.google.com/document/d/1Add4g…/edit?usp=meet_tnfm_calendar
 *
 * A recurring meeting appears twice: the series master, which carries no
 * attachment, and the occurrence that actually happened, which does. Filtering
 * to events that have a document is therefore enough — measured 2026-09-02
 * against a live weekly series, which fetched correctly.
 *
 * The real limit is the feed's window, not recurrence. A series that has
 * already ENDED shows only its master, so its documents are unreachable this
 * way; `--doc` covers those.
 */
export function parseIcsEvents(ics) {
	// RFC 5545 folds long lines with a leading space or tab; the ATTACH URLs are
	// always folded, so unfolding has to happen before anything is matched.
	const unfolded = String(ics || "").replace(/\r?\n[ \t]/g, "");
	const events = [];
	for (const block of unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []) {
		const prop = (name) => {
			const m = new RegExp(`^${name}[^:\\r\\n]*:(.*)$`, "m").exec(block);
			return m ? m[1].trim() : "";
		};
		const start = prop("DTSTART");
		const date = /^(\d{4})(\d{2})(\d{2})/.exec(start);
		const attach = /ATTACH[^:\r\n]*:(https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)[^\r\n]*)/.exec(
			block
		);
		events.push({
			title: prop("SUMMARY"),
			date: date ? `${date[1]}-${date[2]}-${date[3]}` : "",
			uid: prop("UID"),
			docId: attach ? attach[2] : "",
			recurring: /^RRULE[:;]/m.test(block),
		});
	}
	return events;
}

/**
 * The event whose document we want. The date
 * carries the match, the title only separates two meetings on one day.
 */
export function pickIcsEvent(events, title, when) {
	const withDoc = (events || []).filter((e) => e.docId);
	const [date, time] = String(when || "").trim().split(/[ T]/);
	void time;
	const pool = date ? withDoc.filter((e) => e.date === date) : withDoc;
	if (pool.length === 1) return { ...pool[0], titleAgrees: titlesMatch(pool[0].title, title) };
	const byTitle = pool.filter((e) => titlesMatch(e.title, title));
	return byTitle.length === 1 ? { ...byTitle[0], titleAgrees: true } : null;
}

/** Drive names carry characters no filesystem accepts. */
export function safeFileName(name) {
	return String(name)
		.replace(/[<>:"/\\|?*]/g, "_")
		.replace(/\s+/g, " ")
		.trim();
}

// ────────────────────────────────────────────────────────────── the I/O layer

class Failure extends Error {}

/**
 * Which device file to read (ADR-0027).
 *
 * This is a **Dispatch-scope** script — Dispatch ships it and it is the same for
 * every user — so its settings are ordinary device settings and live in the
 * per-vault file the plugin already writes. It must still run from a plain
 * shell (ADR-0023), so the vault is found in three steps and an injected path
 * is a convenience rather than the only channel:
 *
 *   1. `--config <path>`, explicit and always wins.
 *   2. `DISPATCH_LOCAL_SETTINGS`, injected when Dispatch launches the script —
 *      the same mechanism `run-state.mjs` gets `DISPATCH_RUNS_FILE` through.
 *   3. the single `~/.dispatch/<vault>-<hash>.json` on the machine.
 *
 * Step 3 requires **exactly one** match. Two vaults and the script stops and
 * asks, rather than guessing which one you meant — the same narrow rule
 * `findAdoptionCandidate` uses in the plugin.
 */
export function resolveConfigPath(explicit, env, files) {
	// `~` is not expanded by Node, and PowerShell passes it through untouched to
	// a native command — so `--config ~/.dispatch/x.json` looked for a directory
	// literally named "~". Humans and agents both write paths that way, and the
	// documentation prints them that way, so expanding it here is the fix rather
	// than telling people not to.
	const expand = (p) => {
		const s = String(p ?? "");
		if (s === "~") return homedir();
		if (!/^~[/\\]/.test(s)) return s;
		// Split on both separators and re-join, so the result uses the platform's
		// own and the path we echo back in an error is copy-pasteable.
		return join(homedir(), ...s.slice(2).split(/[/\\]/));
	};

	if (explicit) return { path: expand(explicit), how: "--config" };
	if (env) return { path: expand(env), how: "DISPATCH_LOCAL_SETTINGS" };
	const vaults = (files || []).filter((f) => /^.+-[0-9a-f]+\.json$/.test(f));
	if (vaults.length === 1) return { path: join(DISPATCH_DIR, vaults[0]), how: "the only vault on this machine" };
	return { path: null, how: vaults.length ? `${vaults.length} vaults` : "no vault" };
}

export function loadConfig(explicitPath) {
	const files = existsSync(DISPATCH_DIR) ? readdirSync(DISPATCH_DIR) : [];
	const { path, how } = resolveConfigPath(
		explicitPath ?? arg("config"),
		process.env.DISPATCH_LOCAL_SETTINGS,
		files
	);
	if (!path) {
		throw new Failure(
			`Could not tell which vault's settings to use — found ${how} under ${DISPATCH_DIR}.\n` +
				`  Pass --config <path to ~/.dispatch/<vault>-<hash>.json>. Dispatch shows the\n` +
				`  exact path in Settings -> Dispatch -> This device.`
		);
	}
	if (!existsSync(path)) {
		// Say what was actually looked for and what is actually there — the two
		// disagreeing is the whole of this failure, and guessing which vault the
		// user meant is exactly what the rule above refuses to do.
		const vaults = files.filter((f) => /^.+-[0-9a-f]+\.json$/.test(f));
		throw new Failure(
			`No ${path} (chosen via ${how}).\n` +
				(vaults.length
					? `  Device files present in ${DISPATCH_DIR}:\n` +
						vaults.map((f) => `    ${join(DISPATCH_DIR, f)}`).join("\n")
					: `  ${DISPATCH_DIR} holds no vault settings — open the vault in Obsidian once to create one.`)
		);
	}

	const raw = JSON.parse(readFileSync(path, "utf8"));
	const google = raw.google ?? {};
	// The console's own download nests credentials under "installed" (desktop)
	// or "web". Accept it as-is: it is what everyone has on disk, and a
	// hand-flattened copy is one more thing to get wrong.
	const cfg = {
		...(google.installed ?? google.web ?? {}),
		...google,
		calendar_url: raw.calendarUrl || "",
	};
	if (!cfg.client_id || !cfg.client_secret) {
		throw new Failure(
			`No Google OAuth client in ${path}.\n` +
				`  Create a Desktop client in the Google Cloud Console, then paste its client_id\n` +
				`  and client_secret into that file under "google", and run --auth. Setup is in\n` +
				`  docs/installation.md.`
		);
	}
	return { cfg, raw, path, how };
}

/**
 * One-time move of `~/.dispatch/google.json` into the vault's device file.
 *
 * ADR-0024 put the credentials in an account-scoped file of their own; ADR-0027
 * withdrew that. Migrating rather than asking the user to re-authenticate costs
 * a few lines and saves a browser round-trip per vault. The old file is removed
 * afterwards, so it cannot be picked up again or left holding a live token.
 */
function migrateLegacyConfig(targetPath) {
	if (!existsSync(LEGACY_CONFIG) || !existsSync(targetPath)) return false;
	try {
		const legacy = JSON.parse(readFileSync(LEGACY_CONFIG, "utf8"));
		const target = JSON.parse(readFileSync(targetPath, "utf8"));
		if (target.google?.client_id || target.google?.installed) return false;

		const { calendar_url: legacyCalendar, ...google } = legacy;
		target.google = google;
		if (legacyCalendar && !target.calendarUrl) target.calendarUrl = legacyCalendar;
		writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n");
		unlinkSync(LEGACY_CONFIG);
		say(`Migrated ${LEGACY_CONFIG} into ${targetPath} (ADR-0027) and removed the old file.`);
		return true;
	} catch (e) {
		say(`Could not migrate ${LEGACY_CONFIG}: ${e.message}. Move its contents under "google" by hand.`);
		return false;
	}
}

async function tokenRequest(params) {
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Failure(
			`Google rejected the token request (HTTP ${res.status}): ${json.error_description || json.error || "unknown"}`
		);
	}
	return json;
}

/**
 * The re-authorisation command, spelled out for THIS machine.
 *
 * It has to carry `--config`: with more than one vault the bare `--auth` stops
 * on the ambiguity rule, so a message that omits it hands the user a cure that
 * does not run — which is how a dead token became a dead end on 2026-09-02.
 */
function authCommand(path) {
	return `node scripts/dispatch/meet-fetch.mjs --config "${path}" --auth`;
}

/** An access token from the stored refresh token. The normal path. */
async function accessToken(store) {
	const { cfg, path } = store;
	if (!cfg[TOKEN_KEY]) {
		throw new Failure(`No google.${TOKEN_KEY} in ${path}.\n  Run: ${authCommand(path)}`);
	}
	try {
		const tok = await tokenRequest({
			client_id: cfg.client_id,
			client_secret: cfg.client_secret,
			refresh_token: cfg[TOKEN_KEY],
			grant_type: "refresh_token",
		});
		if (tok.scope) say(`Scopes on this token: ${tok.scope}`);
		return tok.access_token;
	} catch (e) {
		// A revoked or expired token surfaces here, typically long after setup
		// and inside an unrelated task — so the message has to carry the cure.
		throw new Failure(
			`${e.message}\n` +
				`  The stored refresh token is no longer valid (revoked, or the password changed).\n` +
				`  Run: ${authCommand(path)}`
		);
	}
}

/**
 * Open the consent page in the user's browser.
 *
 * Not a convenience. `--auth` blocks on a loopback server while the user
 * clicks through, and an agent running it cannot both wait for that and hand
 * the URL to the user — relaying it means ending the turn, which kills the
 * server before the redirect arrives. Opening the browser here removes the
 * relay: the caller just waits, and the flow completes inside one call.
 *
 * Best-effort. The URL is printed either way, so a headless or SSH session
 * still works by copying it.
 */
function openInBrowser(url) {
	// One argv entry, no shell — a consent URL is full of & and ? and would be
	// mangled by `cmd /c start`. rundll32 is the escaping-free route on Windows.
	const [cmd, args] =
		process.platform === "win32"
			? ["rundll32", ["url.dll,FileProtocolHandler", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	try {
		const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
		child.on("error", () => {
			/* no browser here; the printed URL is the fallback */
		});
		child.unref();
		return true;
	} catch {
		return false;
	}
}

/** One-time consent over a loopback redirect, storing the refresh token. */
async function authorize(store) {
	const { cfg, raw, path } = store;
	const state = randomBytes(16).toString("hex");

	// Bind first, so the redirect URI can name the port Google must call back on.
	const server = createServer();
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const redirect = `http://127.0.0.1:${server.address().port}`;

	const code = new Promise((resolve, reject) => {
		server.on("request", (req, res) => {
			const url = new URL(req.url, redirect);
			const c = url.searchParams.get("code");
			const err = url.searchParams.get("error");
			// `Connection: close` so the browser does not hold a keep-alive socket
			// open: a lingering connection is what keeps the server handle alive
			// past the point we want to exit.
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				Connection: "close",
			});
			res.end(
				`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">` +
					(c ? "Authorised — close this tab and return to the terminal." : `Failed: ${err}`) +
					`</body>`
			);
			// Deliberately NOT closing the server here. Closing it mid-response
			// leaves a half-torn-down handle, and process.exit() landing on top of
			// that aborts Node on Windows with
			//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), async.c:76
			// — after the token was already written, so the run looked successful
			// and still exited non-zero. The shutdown belongs in one place, below.
			if (url.searchParams.get("state") !== state) reject(new Failure("state mismatch"));
			else if (c) resolve(c);
			else reject(new Failure(err || "no code returned"));
		});
	});

	const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	auth.searchParams.set("client_id", cfg.client_id);
	auth.searchParams.set("redirect_uri", redirect);
	auth.searchParams.set("response_type", "code");
	auth.searchParams.set("scope", SCOPES);
	auth.searchParams.set("access_type", "offline");
	auth.searchParams.set("prompt", "consent");
	auth.searchParams.set("state", state);
	if (cfg.account) auth.searchParams.set("login_hint", cfg.account);

	const opened = openInBrowser(auth.toString());
	say(
		opened
			? `\nOpening the consent page in your browser${cfg.account ? ` — sign in as ${cfg.account}` : ""}.` +
					`\nIf nothing appears, open this URL by hand:\n`
			: `\nOpen this URL and sign in${cfg.account ? ` as ${cfg.account}` : ""}:\n`
	);
	say(auth.toString());
	say(
		`\n  An "unverified app" screen is expected — Advanced -> Go to <app> (unsafe).\n` +
			`  The client is published but deliberately unverified; see docs/privacy.html.\n` +
			`  Waiting for the redirect — this run finishes on its own once you approve.\n`
	);

	try {
		const tok = await tokenRequest({
			code: await code,
			client_id: cfg.client_id,
			client_secret: cfg.client_secret,
			redirect_uri: redirect,
			grant_type: "authorization_code",
		});
		if (!tok.refresh_token) {
			throw new Failure(
				`Google returned no refresh token. The OAuth client is probably still in\n` +
					`  "Testing" — publish it to production, or tokens expire after 7 days.`
			);
		}
		// Write back against the original shape, so the console's nested block is
		// preserved rather than replaced by a flattened copy.
		// Write back into the `google` block only, preserving every other device
		// setting in the file — repo aliases, tool commands, the calendar URL.
		// This file is the plugin's; the script owns exactly one key in it.
		const next = { ...raw, google: { ...(raw.google ?? {}), [TOKEN_KEY]: tok.refresh_token } };
		writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
		say(`Granted: ${tok.scope || "(not reported)"}`);
		say(`Stored as google.${TOKEN_KEY} in ${path}. Later runs need no browser.`);
	} finally {
		// The single shutdown point, awaited so the handle is fully closed before
		// anything calls process.exit(). `closeAllConnections` drops the browser's
		// socket, without which `close()` waits for a connection nobody will end.
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	}
}

/*
 * `driveList` used to live here, searching Drive for a meeting's document.
 * Removed 2026-09-02 with the Drive scope itself. The calendar feed names the
 * document, so the search bought only the recurring-series case — not worth a
 * restricted permission that every user would have to grant, and that a privacy
 * policy would then have to describe. That case falls back to a pasted link or
 * a hand-downloaded file.
 */

/** Content via the Docs API, the --docs-only path. */
async function documentsGet(token, id) {
	// includeTabsContent is not optional: without it the response is 200 with
	// only the first tab, i.e. the notes and no transcript.
	const url = new URL(`https://docs.googleapis.com/v1/documents/${id}`);
	url.searchParams.set("includeTabsContent", "true");
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (res.status === 403 || res.status === 404) {
		throw new Failure(
			`The Docs API refused document ${id} (HTTP ${res.status}).\n` +
				`  Either the id is wrong, or this token does not carry ${DOCS_SCOPE}.\n` +
				`  Re-run with --auth (add --docs-only to consent to the Docs scope alone).`
		);
	}
	if (!res.ok) throw new Failure(`Docs API failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
	return await res.json();
}

/*
 * `files.export` used to live here — Drive's own Markdown of the same document.
 * Removed 2026-09-02 along with the Drive content scope: `documents.get` needs
 * only `documents.readonly` and renders at parity (448 of 448 speaker labels,
 * 76 of 76 headings, 4 of 4 links). Keeping both would have meant maintaining a
 * second content path whose only distinction was needing a broader permission.
 *
 * Its 10 MB export cap went with it; the Docs API has no such limit.
 */

// ───────────────────────────────────────────────────────────────────── the CLI

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Print what the calendar feed actually holds, so a no-match is one line from
 * being diagnosed instead of needing a session of guessed titles.
 *
 * Events without a document are shown too, and why: a meeting that produced no
 * notes and a recurring series that carries none look identical from the
 * outside, and only the second has a remedy.
 */
async function reportCalendar(icsUrl, date) {
	if (!icsUrl) {
		say(`  No calendar feed configured, so there is nothing to look in.`);
		say(`  Set the calendar URL in Dispatch's settings, or pass --doc <url or id>.`);
		return;
	}
	let events;
	try {
		const res = await fetch(icsUrl);
		if (!res.ok) {
			say(`  Calendar feed returned HTTP ${res.status}.`);
			return;
		}
		events = parseIcsEvents(await res.text());
	} catch (e) {
		say(`  Calendar feed unreachable: ${e.message}`);
		return;
	}

	const shown = date ? events.filter((e) => e.date === date) : events;
	if (!shown.length) {
		say(date ? `  No event on ${date} in the feed.` : `  The feed holds no events.`);
		return;
	}
	say(`  ${date ? `Events on ${date}` : "Events in the feed"}:`);
	for (const e of shown) {
		const note = e.docId
			? `doc ${e.docId}`
			: e.recurring
				? "series master, no link — look for the occurrence's own row above"
				: "no document link yet";
		say(`    · ${e.date}  "${e.title}"  — ${note}`);
	}
}

/**
 * Look the meeting up in the calendar feed. Costs no Google scope: the ICS URL
 * is a secret address the user configured for the Meetings tab, which the
 * plugin mirrors into `google.json` (it cannot be read from the per-vault
 * device file, whose name is a hash of the vault path only the plugin knows).
 *
 * Never throws — a feed that is unreachable or has aged the meeting out is an
 * ordinary miss, and Drive search is still there to try.
 */
async function discoverViaCalendar(icsUrl, title, date) {
	try {
		const res = await fetch(icsUrl);
		if (!res.ok) {
			say(`Calendar feed returned HTTP ${res.status}; falling back to Drive search.`);
			return null;
		}
		const events = parseIcsEvents(await res.text());
		const found = pickIcsEvent(events, title, date);
		if (found) return found;

		const onDate = events.filter((e) => !date || e.date === date);
		if (onDate.length && onDate.every((e) => !e.docId)) {
			// Worth naming rather than silently falling through: a recurring
			// master carries no attachment, which is the feed's known blind spot.
			const why = onDate.some((e) => e.recurring)
				? `the calendar entry is a recurring series, and Google attaches the notes to the occurrence rather than the series`
				: `no notes are attached to it yet`;
			say(`The calendar feed has this meeting but no document link — ${why}.`);
		}
		return null;
	} catch (e) {
		say(`Calendar feed unreachable (${e.message}); falling back to Drive search.`);
		return null;
	}
}

/**
 * Fetch one document the caller already identified — no search, no matching.
 *
 * Content comes from the Docs API under --docs-only and from Drive's export
 * otherwise, so the two can be compared against the same document.
 */
async function fetchByDocId(store, docArg, dir, dryRun) {
	const id = parseDocId(docArg);
	if (!id) throw new Failure(`Not a Google Docs URL or id: ${docArg}`);
	if (!dir) throw new Failure(`--doc also needs --dir <folder>.`);

	const token = await accessToken(store);
	if (scanFetched(dir).has(id)) {
		say(`Already fetched: doc_id ${id} — nothing to do.`);
		return 0;
	}

	// One content path, always the Docs API. It needs only documents.readonly,
	// and renders at parity with Drive's own export — 448 of 448 speaker labels
	// and 76 of 76 headings on the 2026-09-01 meeting.
	const doc = await documentsGet(token, id);
	const name = doc.title || id;
	const body = docsToMarkdown(doc);
	say(`Docs API: "${name}" — ${(doc.tabs || []).length} tab(s), ${body.length} bytes rendered.`);

	if (dryRun) {
		say(`[dry-run] would write "${name}" (${body.length} bytes) into ${dir}`);
		return 0;
	}

	const parsed = parseArtifactName(name);
	const target = join(dir, `${safeFileName(name)}.md`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		target,
		renderFrontmatter({
			meeting_date: parsed?.date || "",
			artifact: artifactKind(parsed?.label),
			doc_id: id,
			fetched: new Date().toISOString().slice(0, 10),
		}) + body
	);
	say(
		`Fetched "${name}" -> ${target} (${body.length} bytes). ` +
			(hasTranscriptSection(body)
				? `Transcript present.`
				: `NO TRANSCRIPT in this document — transcription was off for the meeting.`)
	);
	return 0;
}

export async function main() {
	// Before reading anything: fold a pre-ADR-0027 ~/.dispatch/google.json into
	// the vault's device file, so an existing setup keeps working without
	// re-authenticating.
	{
		const files = existsSync(DISPATCH_DIR) ? readdirSync(DISPATCH_DIR) : [];
		const { path } = resolveConfigPath(
			arg("config"),
			process.env.DISPATCH_LOCAL_SETTINGS,
			files
		);
		if (path) migrateLegacyConfig(path);
	}

	const store = loadConfig();

	if (process.argv.includes("--auth")) {
		await authorize(store);
		return 0;
	}

	const title = arg("title");
	const date = arg("date");
	const dir = arg("dir");
	const dryRun = process.argv.includes("--dry-run");

	if (process.argv.includes("--list")) {
		// Needs no Google permission at all — the feed is a secret URL, not an API.
		await reportCalendar(store.cfg.calendar_url, date);
		return 0;
	}

	// --doc skips discovery entirely: the user supplies the document, so nothing
	// has to be searched for or matched.
	const docArg = arg("doc");
	if (docArg) return await fetchByDocId(store, docArg, dir, dryRun);

	// Before any lookup: a missing --title is a usage error, not a meeting that
	// could not be found. Reporting it as the latter produced `no document for
	// "undefined"`, which sends the reader looking for a calendar problem.
	if (!title || !dir) {
		throw new Failure(
			`Usage: meet-fetch.mjs --title "<meeting title>" --date YYYY-MM-DD --dir <folder>\n` +
				`       meet-fetch.mjs --doc <url or id> --dir <folder>\n` +
				`       meet-fetch.mjs --list [--date YYYY-MM-DD]\n` +
				`       meet-fetch.mjs --auth`
		);
	}

	// The calendar feed is the ONLY discovery path, because it costs no Google
	// permission: the ICS carries each meeting's document as an ATTACH.
	if (store.cfg.calendar_url && title) {
		const found = await discoverViaCalendar(store.cfg.calendar_url, title, date);
		if (found) {
			if (!found.titleAgrees) {
				say(
					`Note: matched on the date alone — the calendar event is "${found.title}", ` +
						`you asked for "${title}".`
				);
			}
			say(`Found via the calendar feed: ${found.date} "${found.title}" -> doc ${found.docId}`);
			return await fetchByDocId(store, found.docId, dir, dryRun);
		}
	}

	// Nothing in the feed. Not a failure — a meeting Gemini has not processed
	// yet is an ordinary state — so report what was actually looked at and name
	// both ways forward. Searching Drive is deliberately not one of them.
	say(`No document found for "${title}"${date ? ` on ${date}` : ""} in the calendar feed.`);
	await reportCalendar(store.cfg.calendar_url, date);
	say(
		`\n  Two ways on:\n` +
			`   1. Paste the document link:  --doc <url or id> --dir <folder>\n` +
			`   2. Download it by hand from Google Docs (File -> Download -> Markdown,\n` +
			`      both tabs) into ${dir}\n` +
			`  If Gemini simply has not finished yet, waiting a few minutes is the third.`
	);
	return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	// Set the code and let the loop drain; never process.exit().
	//
	// process.exit() tears the event loop down immediately, and if fetch's
	// connection pool then signals the main thread the run aborts with
	//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), async.c:76
	// (Windows exit code 0xC0000409). Every path here does a token exchange
	// just before returning, so the race was reachable from all of them — it
	// hit --auth *after* the refresh token had been written, making a
	// successful run report failure to whatever checked the exit code.
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((e) => {
			process.stderr.write(`${e instanceof Failure ? e.message : String(e?.stack || e)}\n`);
			process.exitCode = 1;
		});
}
