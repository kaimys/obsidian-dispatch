#!/usr/bin/env node
/**
 * Fetch a Google Meet meeting's Gemini document into the vault (US00001).
 *
 * Usage
 * -----
 *   node scripts/dispatch/meet-fetch.mjs --auth
 *       One-time consent. Opens a loopback OAuth flow and stores the refresh
 *       token in ~/.dispatch/google.json. Every later run is non-interactive.
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
 * Scopes
 * ------
 *   drive.meet.readonly   discovery — files.list over Meet-created files
 *   documents.readonly    content — without it files.export returns 404 while
 *                         files.list and files.get both still return 200
 * `drive.readonly` is deliberately NOT requested: it would grant read of the
 * entire Drive to fetch one document.
 *
 * Config: ~/.dispatch/google.json — account-scoped rather than per-vault, so
 * one Google account serves every project (ADR-0024). Google's own downloaded
 * client JSON works unmodified. Nothing is ever written into the vault except
 * the finished document.
 *
 * Zero dependencies. Node 18+.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG = join(homedir(), ".dispatch", "google.json");
const SCOPES = [
	"https://www.googleapis.com/auth/drive.meet.readonly",
	"https://www.googleapis.com/auth/documents.readonly",
].join(" ");

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
 * Title + date identify a meeting, per the recorded decision — not the Meet
 * code, which never reaches the plugin (src/calendar.ts discards it).
 *
 * `when` is `YYYY-MM-DD`, optionally with ` HH:MM`. The time is what separates
 * a recurring meeting held twice in one day; omit it and any meeting that day
 * matches, which is the common case and the one the board's `meeting_date`
 * property can express.
 */
export function matchesMeeting(parsed, title, when) {
	if (!parsed) return false;
	if (!titlesMatch(parsed.title, title)) return false;
	if (!when) return true;
	const [date, time] = String(when).trim().split(/[ T]/);
	if (date && parsed.date !== date) return false;
	if (time && parsed.time !== time.slice(0, 5)) return false;
	return true;
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
 * Choose the document for a meeting from what the search returned.
 *
 * **Date first, title second.** The date is the strong key — the note is named
 * `YYYY-MM-DD - …` and carries `meeting_date:`, both machine-written — whereas
 * the title is typed by a human on one side and generated by Google on the
 * other. A day almost always holds one meeting, so the title is needed only to
 * separate two, and demanding it up front is what turned a translated title
 * into a dead end.
 *
 * Returns `{file, parsed, titleAgrees}`, or null when nothing fits or when two
 * candidates remain indistinguishable — the caller reports rather than guesses.
 */
export function pickCandidate(files, title, when) {
	const all = (files || [])
		.map((file) => ({ file, parsed: parseArtifactName(file.name) }))
		.filter((c) => c.parsed);

	const [date, time] = String(when || "").trim().split(/[ T]/);
	let pool = date ? all.filter((c) => c.parsed.date === date) : all;

	// A time narrows only when it actually hits; otherwise it is ignored rather
	// than allowed to empty the pool, since `meeting_date:` usually has no time.
	if (time) {
		const exact = pool.filter((c) => c.parsed.time === time.slice(0, 5));
		if (exact.length) pool = exact;
	}

	if (pool.length === 1) {
		return { ...pool[0], titleAgrees: titlesMatch(pool[0].parsed.title, title) };
	}
	const byTitle = pool.filter((c) => titlesMatch(c.parsed.title, title));
	if (byTitle.length === 1) return { ...byTitle[0], titleAgrees: true };
	return null;
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
 * The `files.list` q for a meeting. Pure, so it is assertable.
 *
 * **Filters on the date, not the title**, whenever a date is known. Drive's
 * `name contains` is token-AND with per-token prefix matching, order-blind and
 * not substring — measured 2026-09-02 against the real corpus:
 *
 *   contains 'Dispatch Einführung'  (wrong order)  -> 1 hit
 *   contains 'Einfüh'               (prefix)       -> 1 hit
 *   contains 'führung'              (infix)        -> 0 hits
 *   contains 'Dispatch Introduction'               -> 0 hits
 *
 * So one wrong word in the title zeroes the result server-side, and no
 * client-side leniency can recover a candidate the query never returned. The
 * date has no such failure mode: '2026/09/01', '2026-09-01' and '2026 09 01'
 * all match the same file, because the separators are tokenised away.
 */
export function driveQuery(title, date) {
	const quote = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
	const clauses = ["mimeType = 'application/vnd.google-apps.document'", "trashed = false"];
	const day = String(date || "").trim().slice(0, 10);
	if (/^\d{4}-\d{2}-\d{2}$/.test(day)) clauses.push(`name contains '${quote(day)}'`);
	else if (title) clauses.push(`name contains '${quote(title)}'`);
	return clauses.join(" and ");
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

/** Drive names carry characters no filesystem accepts. */
export function safeFileName(name) {
	return String(name)
		.replace(/[<>:"/\\|?*]/g, "_")
		.replace(/\s+/g, " ")
		.trim();
}

// ────────────────────────────────────────────────────────────── the I/O layer

class Failure extends Error {}

export function loadConfig(path = CONFIG) {
	if (!existsSync(path)) {
		throw new Failure(
			`No ${path}.\n` +
				`  Create the OAuth client in the Google Cloud Console (Desktop app), download\n` +
				`  its JSON unchanged to that path, then run: node scripts/dispatch/meet-fetch.mjs --auth`
		);
	}
	const raw = JSON.parse(readFileSync(path, "utf8"));
	// The console's own download nests credentials under "installed" (desktop)
	// or "web". Accept it as-is: it is what everyone has on disk, and a
	// hand-flattened copy is one more thing to get wrong.
	const cfg = { ...(raw.installed ?? raw.web ?? {}), ...raw };
	if (!cfg.client_id || !cfg.client_secret) {
		throw new Failure(`${path} has no client_id/client_secret, at the top level or under "installed".`);
	}
	return { cfg, raw, path };
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

/** An access token from the stored refresh token. The normal path. */
async function accessToken(cfg) {
	if (!cfg.refresh_token) {
		throw new Failure(
			`No refresh token in ${CONFIG}.\n` + `  Run: node scripts/dispatch/meet-fetch.mjs --auth`
		);
	}
	try {
		const tok = await tokenRequest({
			client_id: cfg.client_id,
			client_secret: cfg.client_secret,
			refresh_token: cfg.refresh_token,
			grant_type: "refresh_token",
		});
		return tok.access_token;
	} catch (e) {
		// A revoked or expired token surfaces here, typically long after setup
		// and inside an unrelated task — so the message has to carry the cure.
		throw new Failure(
			`${e.message}\n` +
				`  The stored refresh token is no longer valid (revoked, or the password changed).\n` +
				`  Run: node scripts/dispatch/meet-fetch.mjs --auth`
		);
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

	say(`\nOpen this URL and sign in${cfg.account ? ` as ${cfg.account}` : ""}:\n`);
	say(auth.toString());
	say(
		`\n  An "unverified app" screen is expected — Advanced -> Go to <app> (unsafe).\n` +
			`  The client is published but deliberately unverified; see docs/privacy.html.\n`
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
		writeFileSync(path, JSON.stringify({ ...raw, refresh_token: tok.refresh_token }, null, 2) + "\n");
		say(`Refresh token stored in ${path}. Later runs need no browser.`);
	} finally {
		// The single shutdown point, awaited so the handle is fully closed before
		// anything calls process.exit(). `closeAllConnections` drops the browser's
		// socket, without which `close()` waits for a connection nobody will end.
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	}
}

async function driveList(token, q) {
	const url = new URL("https://www.googleapis.com/drive/v3/files");
	url.searchParams.set("q", q);
	url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime)");
	url.searchParams.set("pageSize", "50");
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		throw new Failure(`Drive search failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
	}
	return (await res.json()).files || [];
}

async function exportMarkdown(token, id) {
	const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}/export`);
	url.searchParams.set("mimeType", "text/markdown");
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (res.status === 403) {
		const text = await res.text();
		if (/exportSizeLimitExceeded/i.test(text)) {
			throw new Failure(
				`The document is over Drive's 10 MB export limit and cannot be exported as Markdown.\n` +
					`  Download it by hand from Google Docs (File -> Download -> Markdown).`
			);
		}
		throw new Failure(`Export refused (HTTP 403): ${text.slice(0, 200)}`);
	}
	if (res.status === 404) {
		// The scope split that cost the spike two iterations: files.list and
		// files.get succeed on drive.meet.readonly alone, and only the export
		// reveals that content access was never granted.
		throw new Failure(
			`Export returned 404 for a document that was found by search.\n` +
				`  This is what a missing documents.readonly scope looks like — Drive answers\n` +
				`  "not found" rather than "not permitted". Re-run --auth to consent to both scopes.`
		);
	}
	if (!res.ok) throw new Failure(`Export failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
	return await res.text();
}

// ───────────────────────────────────────────────────────────────────── the CLI

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Print what the search actually returned, so a no-match is one line from being
 * diagnosed instead of needing a session of guessed titles.
 *
 * If the date-filtered query came back empty, widen to every Gemini document in
 * reach: the answer is then visible even when both the title and the date were
 * wrong.
 */
async function reportCandidates(token, candidates, date) {
	const show = (label, files) => {
		if (!files.length) {
			say(`  ${label}: none.`);
			return;
		}
		say(`  ${label}:`);
		for (const f of files) {
			const p = parseArtifactName(f.name);
			say(p ? `    · ${p.date} ${p.time}  "${p.title}"` : `    · ${f.name}`);
		}
	};

	show(date ? `Documents on ${date}` : "Documents considered", candidates);
	if (candidates.length) return;

	const all = await driveList(
		token,
		"mimeType = 'application/vnd.google-apps.document' and trashed = false and name contains 'Gemini'"
	);
	show("Every Gemini document this account can reach", all);
	say(`  Re-run with --title and --date taken from one of the lines above.`);
}

export async function main() {
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
		const token = await accessToken(store.cfg);
		await reportCandidates(token, await driveList(token, driveQuery(title, date)), date);
		return 0;
	}

	if (!title || !dir) {
		throw new Failure(
			`Usage: meet-fetch.mjs --title "<meeting title>" --date YYYY-MM-DD --dir <folder>\n` +
				`       meet-fetch.mjs --list [--date YYYY-MM-DD]\n` +
				`       meet-fetch.mjs --auth`
		);
	}

	const token = await accessToken(store.cfg);
	const candidates = await driveList(token, driveQuery(title, date));
	const match = pickCandidate(candidates, title, date);

	if (!match) {
		// Not a failure: a meeting whose document has not been generated yet is
		// an ordinary state. But "not generated yet" and "your title is wrong"
		// used to print the same line, which is how a translated title became a
		// dead end on 2026-09-02 — so always show what was actually considered.
		say(`No Gemini document matched "${title}"${date ? ` on ${date}` : ""}.`);
		await reportCandidates(token, candidates, date);
		return 1;
	}

	const { file, parsed, titleAgrees } = match;
	if (!titleAgrees) {
		// Taken on the date alone. Say so rather than silently accepting it: the
		// alternative is a report written from the wrong meeting's transcript.
		say(
			`Note: matched on the date alone — the document is called "${parsed.title}", ` +
				`you asked for "${title}". It is the only meeting on ${parsed.date}.`
		);
	}
	if (scanFetched(dir).has(file.id)) {
		say(`Already fetched: "${file.name}" (doc_id ${file.id}) — nothing to do.`);
		return 0;
	}
	if (dryRun) {
		say(`[dry-run] would fetch "${file.name}" (doc_id ${file.id}) into ${dir}`);
		return 0;
	}

	const body = await exportMarkdown(token, file.id);
	const target = join(dir, `${safeFileName(file.name)}.md`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		target,
		renderFrontmatter({
			meeting_date: parsed.date,
			artifact: artifactKind(parsed.label),
			doc_id: file.id,
			fetched: new Date().toISOString().slice(0, 10),
		}) + body
	);

	const transcript = hasTranscriptSection(body);
	say(
		`Fetched "${file.name}" -> ${target} (${body.length} bytes). ` +
			(transcript
				? `Transcript present.`
				: `NO TRANSCRIPT in this document — transcription was off for the meeting; ` +
					`only the Gemini summary is available.`)
	);
	return 0;
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
