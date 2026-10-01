#!/usr/bin/env node
/**
 * Build and publish the project website from the vault (US00018).
 *
 * Usage:
 *   node dispatch/scripts/website.mjs build      # convert, guard, zola build → dispatch/website/.build/public
 *   node dispatch/scripts/website.mjs serve      # build, then zola serve (the starter theme is allowed)
 *   node dispatch/scripts/website.mjs publish    # build, then push the output to the gh-pages branch
 *   node dispatch/scripts/website.mjs publish --dry-run   # everything but the push
 *
 * Dispatch-scope (ADR-0027): US00069 lifts this file into dispatch-setup unchanged, so it is
 * dependency-free ESM and reads only the project's `dispatch/website/config.toml`.
 *
 * What it publishes (ADR-0039, ADR-0040):
 *   - from `<source>/` in the vault: Articles/, FAQ.md, Links/ and Testimonials/ with
 *     `status: ready` (a testimonial needs all four fields), Home page.md and every Legal/ note;
 *   - from the release notes: only the fenced `## GitHub release body` of a version marked
 *     released and published on GitHub; a public section it cannot delimit is a finding;
 *   - from the repository: `docs/*.md` and `docs/assets/` at the newest release GitHub shows as
 *     published (never a draft, pre-release or bare tag), never the working tree.
 * A note that is not published is never written into the staging root. The leak guard runs on the
 * source and on the built HTML, and any finding fails the build with file and line.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SITE_DIR = join("dispatch", "website");
export const BUILD_DIR = join(SITE_DIR, ".build");
export const WIKI_DIR = join("dispatch", "wiki");
export const MERMAID_CLI = "@mermaid-js/mermaid-cli@11.17.0";
const MERMAID_CONFIG = { flowchart: { htmlLabels: false } };
const DEFAULTS = {
	source: "10_Website",
	releases: "08_Delivery_and QA/Releases",
	docs: "docs",
	docs_order: [],
};

const say = (message = "") => process.stdout.write(`${message}\n`);

// ─── Small readers ──────────────────────────────────────────────────────────

/** The `[extra.dispatch]` table of a Zola config: string and string-array values only. */
export function readSiteSettings(configText) {
	const settings = { ...DEFAULTS };
	let inTable = false;
	for (const raw of String(configText || "").split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("[")) {
			inTable = line === "[extra.dispatch]";
			continue;
		}
		if (!inTable || !line || line.startsWith("#")) continue;
		const match = /^([A-Za-z_][\w-]*)\s*=\s*(.+)$/.exec(line);
		if (!match) throw new Error(`config.toml [extra.dispatch]: cannot read "${line}"`);
		const [, key, value] = match;
		if (/^".*"$/.test(value)) settings[key] = JSON.parse(value);
		else if (/^\[.*\]$/.test(value)) settings[key] = JSON.parse(value.replace(/,\s*\]$/, "]"));
		else throw new Error(`config.toml [extra.dispatch]: ${key} must be a string or a list of strings`);
	}
	return settings;
}

function unquote(value) {
	const text = value.trim();
	if (/^"(.*)"$/.test(text)) return JSON.parse(text);
	if (/^'(.*)'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
	return text;
}

/**
 * Frontmatter as website notes write it: `key: value` scalars and `key:` followed by `- item`
 * lists. Values stay strings, so a date is `"2026-09-24"` and never a Date. `bodyLine` is the
 * 1-based line on which the body starts, so findings can name the source line.
 */
export function parseNote(text) {
	const source = String(text || "").replace(/\r\n/g, "\n");
	const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
	if (!match) return { data: {}, body: source, bodyLine: 1, lines: {} };
	const data = {};
	// The file line each key sits on, so a finding in a frontmatter value can name it.
	const lines = {};
	let listKey = null;
	match[1].split("\n").forEach((line, i) => {
		const item = /^\s+-\s*(.*)$/.exec(line);
		if (item && listKey) {
			data[listKey].push(unquote(item[1]));
			return;
		}
		const pair = /^([^\s:#][^:]*):(?:\s+(.*))?$/.exec(line);
		if (!pair) return;
		const key = pair[1].trim();
		lines[key] = i + 2;
		const value = (pair[2] ?? "").trim();
		if (value === "") {
			data[key] = [];
			listKey = key;
		} else {
			data[key] = unquote(value);
			listKey = null;
		}
	});
	for (const [key, value] of Object.entries(data)) if (Array.isArray(value) && value.length === 0) data[key] = "";
	return { data, body: source.slice(match[0].length), bodyLine: match[0].split("\n").length, lines };
}

export const isReady = (data) => data.status === "ready";
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

/** Zola-safe path segment: lowercase ASCII words joined by `-`. */
export function slugify(name) {
	return String(name)
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** GitHub's heading anchor, so a docs link written for GitHub keeps working on the site. */
export function headingSlug(text) {
	return String(text)
		.replace(/<[^>]+>/g, "")
		.replace(/[`*_~]/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

// ─── Code-aware scanning ────────────────────────────────────────────────────

const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Splits Markdown into prose and fenced-code segments. Every rewrite and every path check works on
 * prose only: a code block shows syntax, and Obsidian does not resolve links inside one either.
 */
export function segments(body) {
	const lines = String(body).split("\n");
	const out = [];
	let prose = [];
	let start = 0;
	for (let i = 0; i < lines.length; i++) {
		const open = FENCE.exec(lines[i]);
		if (!open) {
			if (prose.length === 0) start = i;
			prose.push(lines[i]);
			continue;
		}
		if (prose.length) out.push({ code: false, text: prose.join("\n"), line: start });
		prose = [];
		const marker = open[2];
		let j = i + 1;
		while (j < lines.length && !new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[j])) j++;
		out.push({ code: true, info: open[3].trim(), text: lines.slice(i, Math.min(j + 1, lines.length)).join("\n"), line: i, inner: lines.slice(i + 1, j).join("\n") });
		i = j;
	}
	if (prose.length) out.push({ code: false, text: prose.join("\n"), line: start });
	return out;
}

/** Replaces inline code spans with spaces of the same length, so offsets and lines still match. */
export function blankInlineCode(text) {
	return String(text).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Removes Obsidian `%%comments%%` in one pass over the whole note, as Obsidian hides them: a
 * comment may span lines, and a code fence *inside* a comment is hidden with it rather than
 * splitting it. Outside a comment, a fenced block or an inline code span shows `%%` literally, so
 * a comment example in code stays. Line breaks are kept, so every later finding names the same
 * line as the source. Everything derived from a note — title, summary, body, leak guard — reads
 * this result, never the raw text.
 */
export function blankComments(body) {
	let inComment = false;
	let closer = null;
	return String(body)
		.split("\n")
		.map((line) => {
			if (!inComment && closer) {
				if (closer.test(line)) closer = null;
				return line;
			}
			if (!inComment) {
				const open = FENCE.exec(line);
				if (open) {
					closer = new RegExp(`^\\s{0,3}${open[2][0] === "`" ? "`" : "~"}{${open[2].length},}\\s*$`);
					return line;
				}
			}
			const masked = blankInlineCode(line);
			let out = "";
			let i = 0;
			while (i < line.length) {
				if (inComment) {
					const end = line.indexOf("%%", i);
					if (end < 0) break;
					inComment = false;
					i = end + 2;
				} else {
					const start = masked.indexOf("%%", i);
					if (start < 0) {
						out += line.slice(i);
						break;
					}
					out += line.slice(i, start);
					inComment = true;
					i = start + 2;
				}
			}
			return out;
		})
		.join("\n");
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * The start tags of HTML or SVG markup, read the way a browser tokenizes them: a quoted attribute
 * value may contain `<`, `>` and attribute-looking text, and only an unquoted `>` ends the tag.
 * Comments are skipped. Returns `{ start, end, name, attrs }`; each attribute is
 * `{ name, start, end, raw, quote }` with offsets into `markup`, so findings keep source lines.
 * The one tokenizer behind every URL and alt-text check — no quote-blind regex decides a boundary.
 */
export function scanTags(markup) {
	const text = String(markup);
	const tags = [];
	const space = /\s/;
	let i = 0;
	while ((i = text.indexOf("<", i)) >= 0) {
		if (text.startsWith("<!--", i)) {
			const close = text.indexOf("-->", i + 4);
			i = close < 0 ? text.length : close + 3;
			continue;
		}
		const name = /^<([a-zA-Z][\w:-]*)/.exec(text.slice(i, i + 100));
		if (!name) {
			i++;
			continue;
		}
		const tag = { start: i, end: -1, name: name[1].toLowerCase(), attrs: [] };
		let j = i + name[0].length;
		while (j < text.length) {
			while (j < text.length && space.test(text[j])) j++;
			if (text[j] === ">") {
				tag.end = j + 1;
				break;
			}
			if (text[j] === "/") {
				j++;
				continue;
			}
			const attrStart = j;
			while (j < text.length && !space.test(text[j]) && !"=>/".includes(text[j])) j++;
			const attrName = text.slice(attrStart, j);
			let k = j;
			while (k < text.length && space.test(text[k])) k++;
			let raw = "";
			let quote = "";
			if (text[k] === "=") {
				k++;
				while (k < text.length && space.test(text[k])) k++;
				if (text[k] === '"' || text[k] === "'") {
					quote = text[k];
					const close = text.indexOf(quote, k + 1);
					if (close < 0) break; // an unclosed quote: not a tag a browser would finish either
					raw = text.slice(k + 1, close);
					k = close + 1;
				} else {
					const from = k;
					while (k < text.length && !space.test(text[k]) && text[k] !== ">") k++;
					raw = text.slice(from, k);
				}
				j = k;
			}
			if (attrName) tag.attrs.push({ name: attrName.toLowerCase(), start: attrStart, end: j, raw, quote });
			else j++;
		}
		if (tag.end < 0) {
			i++;
			continue;
		}
		tags.push(tag);
		i = tag.end;
	}
	return tags;
}

/**
 * Every URL-carrying attribute (`href`, `src`, `xlink:href`) inside a tag of HTML or SVG markup,
 * quoted with `"`, `'` or not at all — all three are valid, so all three must be checked. One
 * reader for the source, the built pages and SVG files, so no quoting style slips past one of them.
 * Returns `{ start, end, name, raw, quote }`, with `start`/`end` the attribute's offsets in `markup`.
 */
export function resourceAttributes(markup) {
	return scanTags(markup).flatMap((tag) => tag.attrs.filter((a) => /^((xlink:)?href|src)$/.test(a.name)));
}

/** A reference that stays on the web or inside the file itself: never a local dependency. */
const isExternal = (url) => /^(https?:|mailto:|tel:|data:|#)/i.test(url) || url.startsWith("//");

// In order of precedence: where two rules match the same text (`file:///C:/Users/…`), the first
// one names it and the others stay quiet.
const PATH_RULES = [
	// `file:///x`, `file://host/x` and `file:/x` are all local; a bare "file:" in prose is not.
	{ re: /file:\/[^\s"'<>)]*/g, message: "a file:// URL" },
	{ re: /dispatch\/wiki\/[^\s"'<>)`]*/g, message: "a path into the vault (dispatch/wiki/…)" },
	{ re: /\b[A-Za-z]:\\+(?:[^\\\s"'<>|]+\\+)*[^\\\s"'<>|]*/g, message: "a local filesystem path" },
	{ re: /(?<![\w/])[A-Za-z]:\/(?!\/)[^\s"'<>)]+/g, message: "a local filesystem path" },
	{ re: /(?<![\w.-])\/(?:Users|home)\/[^\s"'<>)]+/g, message: "a local filesystem path" },
];

/** Path findings in prose (code blocks and inline code excluded), as `{ line, message }`. */
export function scanPaths(body, firstLine = 1) {
	const findings = [];
	for (const part of segments(body)) {
		if (part.code) continue;
		// Decoded as a browser would, so `file:&#x2F;&#x2F;…` is caught in the source, not only in
		// the output. References never contain a line break, so lines still match.
		const prose = decodeEntities(blankInlineCode(part.text));
		const taken = [];
		for (const { re, message } of PATH_RULES) {
			for (const m of prose.matchAll(re)) {
				const [start, end] = [m.index, m.index + m[0].length];
				if (taken.some(([s, e]) => start < e && end > s)) continue;
				taken.push([start, end]);
				findings.push({ at: start, line: firstLine + part.line + lineOf(prose, start) - 1, message: `${message}: ${m[0]}` });
			}
		}
		findings.sort((a, b) => a.line - b.line || a.at - b.at);
	}
	return findings.map(({ line, message }) => ({ line, message }));
}

// ─── Release notes ──────────────────────────────────────────────────────────

/**
 * The fenced block under `## GitHub release body`. A note without the heading has no public
 * section and returns null (Q15: skipped). A heading whose fence is missing, or never closed by a
 * fence at least as long, is malformed and throws, with `line` set to the heading's line within
 * `body`. The rest of an internal note must never be taken for the public section.
 */
export function extractReleaseBody(body) {
	const text = String(body).replace(/\r\n/g, "\n");
	const heading = /^## GitHub release body[ \t]*$/m.exec(text);
	if (!heading) return null;
	const malformed = (reason) => Object.assign(new Error(`## GitHub release body ${reason}`), { line: lineOf(text, heading.index) });
	const rest = text.slice(heading.index + heading[0].length);
	const open = /^(`{3,}|~{3,})[^\n]*\n/m.exec(rest);
	const nextHeading = /^## /m.exec(rest);
	if (!open || (nextHeading && nextHeading.index < open.index)) throw malformed("has no fenced block under it");
	const after = rest.slice(open.index + open[0].length);
	const close = new RegExp(`^${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}\\s*$`, "m").exec(after);
	if (!close) throw malformed(`opens a ${open[1]} fence that is never closed`);
	return after.slice(0, close.index).replace(/\s+$/, "") + "\n";
}

/** Orders `0.3.10` after `0.3.9`; a leading `v` is ignored. */
export function compareVersions(a, b) {
	const [x, y] = [a, b].map((v) => String(v).replace(/^v/, "").split(".").map(Number));
	return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Newest-first version tags (`0.3.1`, `v0.4.0`); anything else is not a release. */
export function newestReleaseTag(tags) {
	const releases = tags.map((tag) => tag.trim()).filter((tag) => /^v?\d+\.\d+\.\d+$/.test(tag));
	releases.sort((a, b) => compareVersions(b, a));
	return releases[0] ?? null;
}

// ─── Collecting the published set ───────────────────────────────────────────

function markdownFiles(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((name) => name.endsWith(".md")).sort((a, b) => a.localeCompare(b));
}

function listFiles(dir, prefix = "") {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
		else out.push(rel);
	}
	return out;
}

/** Title from `title:`, else the first `# ` heading, which is then removed from the body. */
export function titleAndBody(data, body) {
	const heading = /^# (.+)$/m.exec(body);
	const firstProse = body.replace(/^\s+/, "");
	const leadsWithHeading = heading && firstProse.startsWith(heading[0]);
	const stripped = leadsWithHeading ? body.replace(heading[0], "") : body;
	if (data.title) return { title: String(data.title), body: leadsWithHeading ? stripped : body };
	return { title: heading ? heading[1].trim() : "", body: stripped };
}

/** The body without Obsidian comments; the same single pass as `blankComments`. */
export const withoutComments = blankComments;

/** First prose paragraph as plain text, for summaries. Comments never reach it. */
export function summaryOf(body, limit = 160) {
	for (const part of segments(withoutComments(body))) {
		if (part.code) continue;
		for (const para of part.text.split(/\n\s*\n/)) {
			const text = para.trim();
			if (!text || /^(#|>|!\[|\||-|\*|\d+\.|<)/.test(text)) continue;
			const plain = text
				.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
				.replace(/\[\[([^\]]+)\]\]/g, "$1")
				.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/`/g, "")
				// Emphasis markers only: `node_modules` keeps its underscore.
				.replace(/(\*\*|__)(.+?)\1/g, "$2")
				.replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2")
				.replace(/https?:\/\//g, "")
				.replace(/\s+/g, " ");
			return plain.length > limit ? `${plain.slice(0, limit - 1).replace(/\s+\S*$/, "")}…` : plain;
		}
	}
	return "";
}

/**
 * Reads the vault's website folder and release notes into the published set. Notes that are
 * not published are listed in `skipped` and never read further.
 */
export function collectVault(wikiRoot, settings) {
	const root = join(wikiRoot, settings.source);
	if (!existsSync(root)) throw new Error(`website source ${settings.source}/ not found in the vault`);
	// Comments go first, before anything reads the body: a commented-out `# heading` must not
	// become the title, nor a hidden paragraph the summary.
	const read = (rel) => {
		const note = parseNote(readFileSync(join(root, rel), "utf8"));
		return { rel: `${settings.source}/${rel}`, ...note, body: blankComments(note.body) };
	};
	const set = { home: null, articles: [], faq: null, links: [], testimonials: [], legal: [], releases: [], skipped: [], errors: [] };
	// An optional `slug:` sets the page's URL segment; otherwise the file name does.
	const slugOf = (note, name) => slugify(note.data.slug || name.replace(/\.md$/, ""));
	const need = (note, fields) => {
		const missing = fields.filter((f) => !String(note.data[f] ?? "").trim());
		if (missing.length) set.errors.push(`${note.rel}:1: missing ${missing.join(", ")}`);
		for (const f of fields.filter((f) => ["date", "consent"].includes(f) && note.data[f] && !isDate(note.data[f]))) {
			set.errors.push(`${note.rel}:1: ${f} must be YYYY-MM-DD, not "${note.data[f]}"`);
		}
		return missing.length === 0;
	};
	// Frontmatter values reach pages verbatim (titles, descriptions, quotes), so they get the
	// body's leak guard: no wikilink and no local or vault path. A title taken from the `# `
	// heading is checked on the heading's line.
	const guard = (note, fields) => {
		for (const field of fields) {
			const title = field === "title" && !note.data.title;
			const values = title ? [note.title] : [].concat(note.data[field] ?? []);
			const line = title ? note.bodyLine + lineOf(note.body, Math.max(0, note.body.indexOf(`# ${note.title}`))) - 1 : (note.lines?.[field] ?? 1);
			for (const value of values.map(String).filter(Boolean)) {
				for (const m of value.matchAll(/!?\[\[[^\]]*\]\]/g)) set.errors.push(`${note.rel}:${line}: ${field} contains ${m[0]}, and a wikilink cannot be published from ${title ? "a title" : "frontmatter"}`);
				for (const f of scanPaths(value)) set.errors.push(`${note.rel}:${line}: ${field} contains ${f.message}`);
			}
		}
	};

	// Home's pitch is editorial too, so it lives in the vault; it is published by existing.
	if (existsSync(join(root, "Home page.md"))) {
		const note = read("Home page.md");
		const { title } = titleAndBody(note.data, note.body);
		note.title = title;
		guard(note, ["title", "eyebrow", "description", "requirements"]);
		set.home = { eyebrow: note.data.eyebrow || "", title, lede: note.data.description || "", requirements: note.data.requirements || "", readMore: note.data.read_more || "" };
		if (!title) set.errors.push(`${note.rel}:1: missing title (no title: and no # heading)`);
	}

	for (const name of markdownFiles(join(root, "Articles"))) {
		const note = read(`Articles/${name}`);
		if (!isReady(note.data)) {
			set.skipped.push(`${note.rel} (status: ${note.data.status || "unset"})`);
			continue;
		}
		const { title, body } = titleAndBody(note.data, note.body);
		note.title = title;
		note.content = body;
		if (!title) set.errors.push(`${note.rel}:1: missing title (no title: and no # heading)`);
		guard(note, ["title", "description", "author"]);
		need(note, ["date"]);
		note.slug = slugOf(note, name);
		note.dir = "Articles";
		set.articles.push(note);
	}
	// Home's second button names an article; it shows only while that article is published.
	if (set.home) {
		const name = String(set.home.readMore).replace(/^\[\[|\]\]$/g, "").trim().toLowerCase();
		const article = set.articles.find((a) => basename(a.rel, ".md").toLowerCase() === name);
		set.home.read_more = article ? { url: `articles/${article.slug}/`, title: article.title } : undefined;
		delete set.home.readMore;
	}

	if (existsSync(join(root, "FAQ.md"))) {
		const note = read("FAQ.md");
		if (isReady(note.data)) {
			const { title, body } = titleAndBody(note.data, note.body);
			Object.assign(note, { title: title || "FAQ", content: body, slug: "faq", dir: "" });
			guard(note, ["title", "description"]);
			set.faq = note;
		} else set.skipped.push(`${note.rel} (status: ${note.data.status || "unset"})`);
	}
	for (const name of markdownFiles(join(root, "Links"))) {
		const note = read(`Links/${name}`);
		if (!isReady(note.data)) {
			set.skipped.push(`${note.rel} (status: ${note.data.status || "unset"})`);
			continue;
		}
		if (need(note, ["title", "url", "date"]) && !/^https?:\/\//.test(note.data.url)) {
			set.errors.push(`${note.rel}:${note.lines.url ?? 1}: url must be an absolute http(s) URL`);
		}
		guard(note, ["title"]);
		set.links.push(note);
	}
	// A testimonial publishes like an article: only with `status: ready`, so a quote can wait in
	// the vault until the person approves it. A ready one needs all four fields.
	for (const name of markdownFiles(join(root, "Testimonials"))) {
		const note = read(`Testimonials/${name}`);
		if (!isReady(note.data)) {
			set.skipped.push(`${note.rel} (status: ${note.data.status || "unset"})`);
			continue;
		}
		need(note, ["quote", "name", "role", "consent"]);
		guard(note, ["quote", "name", "role"]);
		set.testimonials.push(note);
	}
	for (const name of markdownFiles(join(root, "Legal"))) {
		const note = read(`Legal/${name}`);
		const { title, body } = titleAndBody(note.data, note.body);
		Object.assign(note, { title: title || name.replace(/\.md$/, ""), content: body, slug: slugOf(note, name), dir: "Legal" });
		guard(note, ["title", "description"]);
		set.legal.push(note);
	}
	// An optional `weight:` orders the legal pages; unweighted ones follow, by file name.
	const weightOf = (note) => (/^\d+$/.test(String(note.data.weight ?? "")) ? Number(note.data.weight) : Infinity);
	set.legal.sort((a, b) => weightOf(a) - weightOf(b));

	const releaseDir = join(wikiRoot, settings.releases);
	for (const name of markdownFiles(releaseDir)) {
		const rel = `${settings.releases}/${name}`;
		const parsed = parseNote(readFileSync(join(releaseDir, name), "utf8"));
		const note = { rel, ...parsed, body: blankComments(parsed.body) };
		if (note.data.status !== "released") continue;
		let content;
		try {
			content = extractReleaseBody(note.body);
		} catch (error) {
			set.errors.push(`${rel}:${note.bodyLine + error.line - 1}: ${error.message}`);
			continue;
		}
		if (content === null) {
			set.skipped.push(`${rel} (no GitHub release body)`);
			continue;
		}
		const version = String(note.data.version || "").replace(/^v/, "");
		if (!/^\d+\.\d+\.\d+$/.test(version) || !isDate(note.data.date)) {
			set.errors.push(`${rel}:1: a released note needs version: vX.Y.Z and date: YYYY-MM-DD`);
			continue;
		}
		const bodyAt = note.body.indexOf(content.trimEnd().split("\n")[0]);
		const bodyLine = note.bodyLine + (bodyAt < 0 ? 0 : lineOf(note.body, bodyAt) - 1);
		set.releases.push({ rel, data: note.data, version, date: note.data.date, title: `v${version}`, content, bodyLine, slug: slugify(version), dir: "Releases" });
	}
	set.releases.sort((a, b) => compareVersions(b.version, a.version));
	set.assets = listFiles(root).filter((path) => !path.endsWith(".md"));
	set.errors.push(...routeCollisions([
		...set.articles.map((n) => ({ route: `articles/${n.slug}`, slug: n.slug, rel: n.rel })),
		...set.legal.map((n) => ({ route: `legal/${n.slug}`, slug: n.slug, rel: n.rel })),
		...set.releases.map((n) => ({ route: `releases/${n.slug}`, slug: n.slug, rel: n.rel })),
	]));
	return set;
}

/**
 * Every page needs an address of its own. An empty slug (a name of only non-Latin characters)
 * or two notes on one address (`slug: same`, or `A B.md` beside `A-B.md`) would make one page
 * silently replace the other, so both are findings, naming every note involved.
 */
export function routeCollisions(pages) {
	const errors = [];
	const byRoute = new Map();
	for (const page of pages) {
		if (!page.slug) errors.push(`${page.rel}:1: its name gives an empty page address; set slug: to a Latin name`);
		else byRoute.set(page.route, [...(byRoute.get(page.route) ?? []), page.rel]);
	}
	for (const [route, rels] of byRoute) {
		if (rels.length > 1) errors.push(`${rels[0]}:1: ${route}/ is also the address of ${rels.slice(1).join(", ")}; give one of them its own slug:`);
	}
	return errors;
}

// ─── Converting Obsidian Markdown ───────────────────────────────────────────

/**
 * Converts one note's body to Zola Markdown and runs the input half of the leak guard on it.
 *
 * ctx.notes   Map of lowercase note name → Zola `@/` path, for the published notes only
 * ctx.assets  Map of lowercase file name → vault-relative path, for files inside the source folder
 * ctx.dir     the note's folder, relative to the source folder (for relative Markdown links)
 * ctx.file    the note's vault path, for findings
 * ctx.line    the line the body starts on
 * ctx.github  true for docs: GitHub Markdown, where `[[…]]` is literal text, not a link
 */
export function convertMarkdown(source, ctx) {
	// The one comment pass (idempotent, so a body collectVault already cleaned is unchanged).
	const body = ctx.github ? source : blankComments(source);
	const errors = [];
	const assets = new Set();
	const diagrams = [];
	const anchors = new Map();
	const fail = (line, message) => errors.push(`${ctx.file}:${line}: ${message}`);
	const out = [];

	for (const part of segments(body)) {
		const first = (ctx.line ?? 1) + part.line;
		if (part.code) {
			if (part.info === "mermaid") {
				const title = /^\s*accTitle:\s*(.+)$/m.exec(part.inner)?.[1].trim();
				const description = /^\s*accDescr:\s*(.+)$/m.exec(part.inner)?.[1].trim();
				if (!title || !description) {
					fail(first, "a Mermaid diagram needs accTitle: and accDescr: lines");
					continue;
				}
				const n = diagrams.length + 1;
				const id = `diagram-${n}-description`;
				diagrams.push({ file: `diagram-${n}.svg`, source: part.inner, title, description });
				// The caption is the title; the long description sits folded under the figure, and
				// screen readers get it through aria-describedby.
				out.push(
					`<figure class="diagram">\n<img src="diagram-${n}.svg" alt="${escapeHtml(title)}" aria-describedby="${id}">\n` +
						`<figcaption>${escapeHtml(title)}</figcaption>\n</figure>\n` +
						`<details class="figure-long">\n<summary>Diagram description</summary>\n<p id="${id}">${escapeHtml(description)}</p>\n</details>`,
				);
			} else out.push(part.text);
			continue;
		}
		out.push(convertProse(part.text, first));
	}
	return { markdown: out.join("\n"), errors, assets: [...assets], diagrams };

	function convertProse(text, first) {
		const lines = text.split("\n");
		const done = [];
		for (let i = 0; i < lines.length; i++) {
			const callout = /^>\s*\[!(\w+)\][-+]?\s*(.*)$/.exec(lines[i]);
			if (callout && !ctx.github) {
				const inner = [];
				while (i + 1 < lines.length && /^>/.test(lines[i + 1])) inner.push(lines[++i].replace(/^>\s?/, ""));
				// No written title stays untitled, so the site's text matches what the note says.
				const title = callout[2].trim();
				const args = `type="${callout[1].toLowerCase()}", title=${teraString(title)}`;
				// Zola rejects a body shortcode with an empty body, so a title-only callout is inline.
				if (inner.join("").trim()) done.push(`{% callout(${args}) %}`, convertLine(inner.join("\n"), first + i - inner.length), "{% end %}");
				else done.push(`{{ callout(${args}) }}`);
				continue;
			}
			done.push(convertLine(lines[i], first + i));
		}
		return done.join("\n");
	}

	function convertLine(line, lineNo) {
		const masked = blankInlineCode(line);
		const edits = [];
		const widths = new Map();
		const at = (index) => lineNo + lineOf(masked, index) - 1;
		const replace = (m, value) => edits.push({ start: m.index, end: m.index + m[0].length, value });

		const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(masked);
		if (heading && !/\{#[^}]+\}$/.test(heading[2])) {
			let id = headingSlug(line.slice(heading[1].length).trim());
			const seen = anchors.get(id) ?? 0;
			anchors.set(id, seen + 1);
			if (seen) id = `${id}-${seen}`;
			edits.push({ start: line.length, end: line.length, value: ` {#${id}}` });
		}
		if (!ctx.github) {
			for (const m of masked.matchAll(/==([^=\n]+)==/g)) replace(m, `<mark>${line.slice(m.index + 2, m.index + m[0].length - 2)}</mark>`);
			for (const m of masked.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
				const [target, ...rest] = line.slice(m.index + m[1].length + 2, m.index + m[0].length - 2).split("|");
				if (m[1]) {
					const name = target.trim();
					const asset = ctx.assets.get(basename(name).toLowerCase());
					if (!asset) {
						fail(at(m.index), `embed ![[${name}]] is not a file in the published set`);
						continue;
					}
					const alt = rest.map((s) => s.trim()).filter((s) => s && !/^\d+(x\d+)?$/.test(s)).join(" ");
					if (!alt) fail(at(m.index), `image ${name} has no alt text (write ![[${name}|Alt text]])`);
					assets.add(asset);
					const url = encodeURI(basename(asset));
					const width = rest.map((s) => s.trim()).find((s) => /^\d+$/.test(s));
					if (width) widths.set(url, width);
					replace(m, `![${alt}](${url})`);
				} else {
					const [name, heading] = target.split("#");
					const page = ctx.notes.get(name.trim().toLowerCase());
					if (!page) {
						fail(at(m.index), `[[${target.trim()}]] links to a page that is not published`);
						continue;
					}
					const label = rest.length ? rest.join("|").trim() : (heading ? `${name.trim()} › ${heading.trim()}` : name.trim());
					replace(m, `[${label}](${page}${heading ? `#${headingSlug(heading)}` : ""})`);
				}
			}
		}
		// A relative link becomes a Zola `@/` link (a published note) or a file copied next to the
		// page (a published asset); anything else points outside the published set.
		const target = (raw, index) => {
			// An attribute may be entity-encoded; a browser decodes it before choosing a scheme.
			const url = decodeEntities(raw);
			if (/^file:/i.test(url)) {
				fail(at(index), `a file:// URL: ${url}`);
				return { keep: true };
			}
			if (/^([a-z][a-z0-9+.-]*:|#|@\/)/i.test(url)) return { keep: true };
			const [path, hash] = decodeURI(url).split("#");
			const resolved = posix.normalize(posix.join(ctx.dir || ".", path)).toLowerCase();
			// Obsidian writes a vault link relative, or as a bare name it resolves vault-wide
			// ("shortest path"); GitHub, for the docs, only knows relative.
			const byName = !ctx.github && !path.includes("/") ? basename(path).toLowerCase() : null;
			const isNote = path.endsWith(".md");
			const note = isNote ? (ctx.notes.get(`path:${resolved}`) ?? (byName && ctx.notes.get(byName.replace(/\.md$/, "")))) : null;
			if (note) return { url: `${note}${hash ? `#${hash}` : ""}` };
			const asset = isNote ? null : (ctx.assets.get(`path:${resolved}`) ?? (byName && ctx.assets.get(byName)));
			if (asset) {
				assets.add(asset);
				return { url: encodeURI(basename(asset)), asset: true };
			}
			fail(at(index), `link ${url} points outside the published set`);
			return { keep: true };
		};
		for (const m of masked.matchAll(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
			const url = line.slice(m.index, m.index + m[0].length).match(/\]\(\s*<?([^)\s>]+)/)[1];
			const text = line.slice(m.index + m[1].length + 1, m.index + m[1].length + 1 + m[2].length);
			const found = target(url, m.index);
			if (found.keep) continue;
			if (m[1] && !text.trim()) fail(at(m.index), `image ${url} has no alt text`);
			replace(m, `${m[1]}[${text}](${found.url})`);
		}
		// Raw HTML in a note: every URL attribute of every tag, in any quoting, goes through the same
		// resolution as a Markdown link, and keeps its own quote style when rewritten.
		for (const tag of scanTags(line).filter((t) => t.name === "img")) {
			if (masked.slice(tag.start, tag.end).trim() === "") continue; // inside inline code
			if (!tag.attrs.some((a) => a.name === "alt" && a.raw.trim())) {
				const src = tag.attrs.find((a) => a.name === "src");
				fail(at(tag.start), `image ${src ? src.raw : "(no src)"} has no alt text`);
			}
		}
		for (const a of resourceAttributes(line)) {
			if (masked.slice(a.start, a.end).trim() === "") continue; // inside inline code
			if (!a.raw) continue; // a bare `href` names nothing
			const found = target(a.raw, a.start);
			if (!found.keep) edits.push({ start: a.start, end: a.end, value: `${a.name}=${a.quote}${found.url}${a.quote}` });
		}
		// A bare URL is a link on GitHub and in Obsidian, but plain text to Zola. It shows without
		// its scheme; trailing sentence punctuation stays outside the link.
		for (const m of masked.matchAll(/(?<![(<"'=[\]\w/])https?:\/\/[^\s<>()[\]]+/g)) {
			const url = m[0].replace(/[.,;:!?]+$/, "");
			replace({ index: m.index, 0: url }, `[${url.replace(/^https?:\/\//, "")}](${url})`);
		}
		edits.sort((a, b) => b.start - a.start);
		let result = line;
		for (const edit of edits) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
		// An image alone on its line is a figure, as the design sets it; an embed keeps its width.
		const only = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(result);
		if (only) {
			const width = widths.get(only[2]);
			return `<figure>\n<img src="${only[2]}" alt="${escapeHtml(only[1])}"${width ? ` width="${width}"` : ""}>\n</figure>`;
		}
		return result;
	}
}

/** A Tera string literal: Tera has no escapes, so pick a delimiter the text does not contain. */
export function teraString(text) {
	const delimiter = ['"', "'", "`"].find((d) => !String(text).includes(d));
	return delimiter ? `${delimiter}${text}${delimiter}` : `"${String(text).replace(/"/g, "”")}"`;
}

export function escapeHtml(text) {
	return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Zola content ───────────────────────────────────────────────────────────

/** TOML front matter from a whitelist: nothing from the vault note is passed through. */
export function frontMatter(fields) {
	const lines = ["+++"];
	const extra = [];
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null || value === "") continue;
		if (key === "extra") {
			for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== "") extra.push(`${k} = ${JSON.stringify(v)}`);
			continue;
		}
		if (key === "date") lines.push(`date = ${value}`);
		else if (typeof value === "number" || typeof value === "boolean") lines.push(`${key} = ${value}`);
		else lines.push(`${key} = ${JSON.stringify(String(value))}`);
	}
	if (extra.length) lines.push("[extra]", ...extra);
	lines.push("+++", "");
	return lines.join("\n");
}

/** Home's updates: releases, articles and links, newest first, with site-relative or external URLs. */
export function buildUpdates(set) {
	const items = [
		...set.releases.map((r) => ({ kind: "release", title: r.title, url: `releases/${r.slug}/`, date: r.date, summary: summaryOf(r.content) })),
		...set.articles.map((a) => ({ kind: "article", title: a.title, url: `articles/${a.slug}/`, date: a.data.date, summary: a.data.description || summaryOf(a.content) })),
		...set.links.map((l) => ({ kind: "link", title: l.data.title, url: l.data.url, date: l.data.date, summary: "" })),
	];
	// Releases come in newest-version order and the sort is stable, so two releases on one day
	// (0.3.0 and 0.3.1) still list the newer one first.
	// A note without a date is already a finding; it must not crash the build before that is shown.
	return items.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

export function buildTestimonials(set) {
	return set.testimonials.map((t) => ({ quote: t.data.quote, name: t.data.name, role: t.data.role, photo: t.photo }));
}

/** The published notes' names and paths → Zola `@/` links, for wikilinks and relative links. */
export function noteIndex(set, source) {
	const index = new Map();
	const add = (note, target) => {
		index.set(basename(note.rel, ".md").toLowerCase(), target);
		index.set(`path:${note.rel.slice(source.length + 1).toLowerCase()}`, target);
	};
	for (const a of set.articles) add(a, `@/articles/${a.slug}/index.md`);
	for (const l of set.legal) add(l, `@/legal/${l.slug}/index.md`);
	if (set.faq) add(set.faq, "@/faq/index.md");
	return index;
}

function assetIndex(paths) {
	const index = new Map();
	for (const path of paths) {
		index.set(basename(path).toLowerCase(), path);
		index.set(`path:${path.toLowerCase()}`, path);
	}
	return index;
}

// ─── Leak guard: output ─────────────────────────────────────────────────────

/** Removes <pre> and <code> content, keeping line breaks so offsets still map to lines. */
function withoutCode(html) {
	return html.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * HTML character references decoded as a browser would. None of them contains a line break, so
 * a decoded line is still the same line.
 */
export function decodeEntities(text) {
	const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
	return String(text)
		.replace(/&#x([0-9a-f]+);/gi, (e, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (e, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (e, name) => named[name]);
}

/**
 * The output half of the leak guard. Every emitted text file is checked, not just the pages:
 * `pages` are `{ path, html, fromVault }` for HTML and `{ path, text, fromVault }` for other text
 * (SVG, CSS, XML), with `path` relative to the output root; `exists(path)` answers for any output
 * file. Checks, after decoding character references: no filesystem or vault path outside code, no
 * `[[` in anything built from the vault, and every `href`/`src` either external over http(s) or
 * resolving to a file in the output — which is also what proves the subpath works.
 */
export function guardOutput(pages, baseUrl, exists) {
	const errors = [];
	const base = baseUrl.replace(/\/+$/, "");
	// Every URL attribute of a page or an SVG, in any quoting: decoded first — Tera escapes
	// data-driven URLs (`https:&#x2F;&#x2F;…`) and browsers decode them, and an encoded `file:` URL
	// is still a local path — then either external, or a file that exists in the output.
	const checkUrls = (page, markup) => {
		const dir = posix.dirname(`/${page.path}`);
		for (const a of resourceAttributes(markup)) {
			const url = decodeEntities(a.raw).trim();
			const at = lineOf(markup, a.start);
			const leaks = scanPaths(url);
			if (leaks.length) {
				errors.push(...leaks.map((f) => `${page.path}:${at}: ${f.message}`));
				continue;
			}
			if (/^file:/i.test(url)) {
				errors.push(`${page.path}:${at}: a file:// URL: ${url}`);
				continue;
			}
			if (!url || /^(#|mailto:|data:|tel:)/i.test(url)) continue;
			let path;
			if (url.startsWith(`${base}/`) || url === base) path = url.slice(base.length) || "/";
			else if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) continue;
			else if (url.startsWith("/")) {
				errors.push(`${page.path}:${at}: root-relative URL ${url} breaks under the site's subpath`);
				continue;
			} else path = posix.normalize(posix.join(dir, url));
			path = decodeURIComponent(path.split(/[?#]/)[0]);
			const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`];
			if (!candidates.some((c) => exists(c.replace(/^\/+/, "")))) errors.push(`${page.path}:${at}: broken link ${a.raw}`);
		}
	};
	for (const page of pages) {
		if (page.text !== undefined) {
			const text = decodeEntities(page.text);
			for (const { line, message } of scanPaths(text)) errors.push(`${page.path}:${line}: ${message}`);
			if (page.fromVault) for (const m of text.matchAll(/!?\[\[[^\]]*\]\]/g)) errors.push(`${page.path}:${lineOf(text, m.index)}: unconverted wikilink ${m[0]}`);
			checkUrls(page, page.text);
			continue;
		}
		// Tags blanked by the same tokenizer, so a quoted `>` does not leave half a tag as "text".
		let stripped = withoutCode(page.html);
		for (const tag of scanTags(stripped)) stripped = stripped.slice(0, tag.start) + stripped.slice(tag.start, tag.end).replace(/[^\n]/g, " ") + stripped.slice(tag.end);
		stripped = stripped.replace(/<\/[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
		const prose = decodeEntities(stripped);
		for (const { line, message } of scanPaths(prose)) errors.push(`${page.path}:${line}: ${message}`);
		if (page.fromVault) {
			for (const m of prose.matchAll(/!?\[\[[^\]]*\]\]/g)) errors.push(`${page.path}:${lineOf(prose, m.index)}: unconverted wikilink ${m[0]}`);
		}
		checkUrls(page, page.html);
	}
	return [...new Set(errors)];
}

// ─── Placeholder rule ───────────────────────────────────────────────────────

/** Publishing needs the project's own Home template; the starter theme alone is never deployed. */
export function assertDesign(siteDir) {
	if (!existsSync(join(siteDir, "templates", "index.html"))) {
		throw new Error(
			`${(relative(REPO_ROOT, siteDir) || siteDir).replaceAll("\\", "/")}/templates/index.html does not exist, so only the starter theme would render. ` +
				"The starter theme is for local tests; publish once the project's design is in place.",
		);
	}
}

// ─── The build ──────────────────────────────────────────────────────────────

function run(command, args, options = {}) {
	// npx is a .cmd on Windows, which Node only starts through a shell; quote for it.
	const shell = process.platform === "win32" && command === "npx";
	const quoted = [command, ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
	const result = shell ? spawnSync(quoted, { encoding: "utf8", shell: true, ...options }) : spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
	return result.stdout;
}

function git(args, options = {}) {
	return execFileSync("git", args, { cwd: REPO_ROOT, ...options });
}

/** `owner/repo` from the site's `[extra] repository` GitHub URL, or null. */
export function repositoryOf(configText) {
	return /^repository\s*=\s*"https:\/\/github\.com\/([^/"]+\/[^/"]+?)\/?"/m.exec(String(configText))?.[1] ?? null;
}

/**
 * The tags of releases GitHub shows as published: not drafts, not pre-releases. A tag alone
 * proves nothing — `/release` pushes its tag and the CI draft before a person publishes it, so a
 * build between the two must still show the previous release's docs.
 */
export function publishedTags(releases) {
	return releases.filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+$/.test(r.tag_name)).map((r) => r.tag_name);
}

function publishedReleasesOn(repository) {
	if (!repository) throw new Error("config.toml has no [extra] repository = \"https://github.com/owner/repo\"; the published release cannot be verified");
	const result = spawnSync("gh", ["api", "--paginate", `repos/${repository}/releases?per_page=100`], { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		throw new Error(`cannot list the published releases of ${repository} (gh api: ${(result.stderr || result.error?.message || "").trim()}); the docs and release notes are only built from a release GitHub shows as published`);
	}
	return JSON.parse(`[${result.stdout.trim().replace(/\]\s*\[/g, ",").replace(/^\[|\]$/g, "")}]`);
}

/**
 * `docs/*.md` and `docs/assets/*` at a verified published tag, as `{ tag, files: Map<path, Buffer> }`.
 * The tag is fetched when this checkout lacks it, and a local tag that differs from the remote one
 * is refused rather than trusted.
 */
export function readDocsAtTag(docsDir, tag) {
	const local = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim();
	const remote = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { encoding: "utf8" }).split(/\s/)[0];
	if (!remote) throw new Error(`the published release ${tag} has no tag on origin`);
	if (!local) git(["fetch", "--no-tags", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
	else if (local !== remote) throw new Error(`the local tag ${tag} (${local.slice(0, 7)}) differs from origin's (${remote.slice(0, 7)}); fix the local tag before building`);
	const paths = git(["ls-tree", "-r", "--name-only", tag, "--", `${docsDir}/`], { encoding: "utf8" })
		.split("\n")
		.filter((p) => new RegExp(`^${docsDir}/([^/]+\\.md|assets/.+)$`).test(p));
	const files = new Map(paths.map((p) => [p.slice(docsDir.length + 1), git(["show", `${tag}:${p}`])]));
	return { tag, files };
}

function renderMermaid(diagram, cacheDir) {
	const hash = createHash("sha256").update(MERMAID_CLI + JSON.stringify(MERMAID_CONFIG) + diagram.source).digest("hex").slice(0, 16);
	const cached = join(cacheDir, `${hash}.svg`);
	if (!existsSync(cached)) {
		mkdirSync(cacheDir, { recursive: true });
		const input = join(cacheDir, `${hash}.mmd`);
		const config = join(cacheDir, "mermaid-config.json");
		writeFileSync(input, diagram.source);
		writeFileSync(config, JSON.stringify(MERMAID_CONFIG));
		say(`Rendering a Mermaid diagram with ${MERMAID_CLI} (the first run downloads a headless browser)…`);
		run("npx", ["-y", MERMAID_CLI, "-i", input, "-o", cached, "-c", config, "-b", "transparent"]);
	}
	return readFileSync(cached);
}

function writePage(contentDir, dir, fields, markdown) {
	mkdirSync(join(contentDir, dir), { recursive: true });
	writeFileSync(join(contentDir, dir, "index.md"), frontMatter(fields) + markdown.replace(/^\n+/, ""));
}

/**
 * Converts the vault and the docs into a staged Zola root. Returns the stage path, the report,
 * and every finding; the caller decides whether findings stop the build (they always do).
 */
export function stage({ repoRoot = REPO_ROOT, wikiRoot = join(repoRoot, WIKI_DIR), siteDir = join(repoRoot, SITE_DIR), buildDir = join(repoRoot, BUILD_DIR), docs, published, renderDiagram = renderMermaid } = {}) {
	const configText = readFileSync(join(siteDir, "config.toml"), "utf8");
	const settings = readSiteSettings(configText);
	if (!existsSync(wikiRoot)) throw new Error(`vault link ${relative(repoRoot, wikiRoot)} not found — create it (see dispatch/invariants.md)`);
	const set = collectVault(wikiRoot, settings);
	const errors = [...set.errors];

	// Only what GitHub shows as published counts as released: the docs come from the newest such
	// tag, and a release note appears only for a published version, so the two move together.
	const tags = published ?? publishedTags(publishedReleasesOn(repositoryOf(configText)));
	const docsTag = newestReleaseTag(tags);
	if (!docsTag) throw new Error("no published release found; Documentation is built from the newest published release");
	const versions = new Set(tags.map((t) => t.replace(/^v/, "")));
	set.releases = set.releases.filter((r) => {
		if (versions.has(r.version)) return true;
		set.skipped.push(`${r.rel} (v${r.version} is not a published release on GitHub)`);
		return false;
	});
	const root = join(buildDir, "site");
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	for (const entry of readdirSync(siteDir)) {
		if (entry === ".build" || entry === "content" || entry === "public") continue;
		cpSync(join(siteDir, entry), join(root, entry), { recursive: true });
	}
	const content = join(root, "content");
	const notes = noteIndex(set, settings.source);
	const assets = assetIndex(set.assets);
	const sourceRoot = join(wikiRoot, settings.source);
	const vaultPages = [];

	// A text asset (an SVG, say) is published as it is, so it gets the leak guard as it is copied,
	// with findings naming the vault file; the output guard checks it again after Zola.
	const copied = new Set();
	const copyAsset = (asset, dir) => {
		mkdirSync(dir, { recursive: true });
		cpSync(join(sourceRoot, asset), join(dir, basename(asset)));
		if (copied.has(asset) || !TEXT_OUTPUT.test(asset)) return;
		copied.add(asset);
		const text = decodeEntities(readFileSync(join(sourceRoot, asset), "utf8"));
		const rel = `${settings.source}/${asset}`;
		errors.push(...scanPaths(text).map((f) => `${rel}:${f.line}: ${f.message}`));
		for (const m of text.matchAll(/!?\[\[[^\]]*\]\]/g)) errors.push(`${rel}:${lineOf(text, m.index)}: contains ${m[0]}, which cannot be published`);
		// An asset is copied as it is, without its own dependencies: anything it references locally
		// would be missing on the site, or reach outside the published set. Embed it instead.
		const raw = readFileSync(join(sourceRoot, asset), "utf8");
		for (const a of resourceAttributes(raw)) {
			const url = decodeEntities(a.raw).trim();
			if (url && !isExternal(url) && !/^file:/i.test(url)) errors.push(`${rel}:${lineOf(raw, a.start)}: references ${url}, a local file an asset cannot bring along; embed it instead`);
		}
	};

	const convertNote = (note, outDir) => {
		errors.push(...scanPaths(note.content, note.bodyLine).map((f) => `${note.rel}:${f.line}: ${f.message}`));
		const result = convertMarkdown(note.content, { notes, assets, dir: note.dir, file: note.rel, line: note.bodyLine });
		errors.push(...result.errors);
		mkdirSync(join(content, outDir), { recursive: true });
		for (const asset of result.assets) copyAsset(asset, join(content, outDir));
		for (const diagram of result.diagrams) writeFileSync(join(content, outDir, diagram.file), renderDiagram(diagram, join(buildDir, "cache", "mermaid")));
		vaultPages.push(outDir.replace(/\\/g, "/"));
		return result.markdown;
	};

	// Every section names the templates it renders with. The starter theme provides each one, so
	// a project's design may override any of them and needs none.
	const section = (dir, fields) => {
		mkdirSync(join(content, dir), { recursive: true });
		writeFileSync(join(content, dir, "_index.md"), frontMatter({ ...fields, insert_anchor_links: "right" }));
	};
	section("", { title: "Home" });

	section("articles", { title: "Articles", sort_by: "date" });
	for (const a of set.articles) {
		const md = convertNote(a, `articles/${a.slug}`);
		// An optional teaser image, a published asset copied next to the article.
		let teaser;
		if (a.data.teaser) {
			const asset = assets.get(basename(String(a.data.teaser)).toLowerCase());
			if (asset) {
				teaser = basename(asset);
				copyAsset(asset, join(content, "articles", a.slug));
			} else errors.push(`${a.rel}:1: teaser ${a.data.teaser} is not a file in the published set`);
		}
		// `lead` marks a written description; a generated one serves lists and the meta tag, but
		// shown above the text it would only repeat the first paragraph.
		const extra = { author: [].concat(a.data.author || []).join(", "), teaser, teaser_cover: a.data.teaser_cover === "true" || undefined, lead: Boolean(a.data.description) || undefined };
		writePage(content, `articles/${a.slug}`, { title: a.title, date: a.data.date, description: a.data.description || summaryOf(a.content), extra }, md);
	}

	section("legal", { title: "Legal", sort_by: "weight", page_template: "legal.html" });
	set.legal.forEach((l, i) => {
		const md = convertNote(l, `legal/${l.slug}`);
		writePage(content, `legal/${l.slug}`, { title: l.title, weight: i + 1, description: l.data.description, extra: { effective: l.data.effective, lang: l.data.lang, robots: l.data.robots } }, md);
	});

	if (set.faq) writePage(content, "faq", { title: set.faq.title }, convertNote(set.faq, "faq"));

	// Releases sort by weight, newest first, so two versions shipped on one day keep their order;
	// in a template `page.lower` is then the newer release and `page.higher` the older one.
	section("releases", { title: "Releases", sort_by: "weight", template: "releases.html", page_template: "release.html" });
	set.releases.forEach((r, i) => {
		errors.push(...scanPaths(r.content, r.bodyLine).map((f) => `${r.rel}:${f.line}: ${f.message}`));
		const result = convertMarkdown(r.content, { notes: new Map(), assets: new Map(), dir: "", file: r.rel, line: r.bodyLine });
		errors.push(...result.errors);
		writePage(content, `releases/${r.slug}`, { title: r.title, date: r.date, weight: i + 1, description: summaryOf(r.content), extra: { version: r.version } }, result.markdown);
		vaultPages.push(`releases/${r.slug}`);
	});

	const docsSource = docs ?? readDocsAtTag(settings.docs, docsTag);
	if (docsSource.tag !== docsTag) errors.push(`docs were read at ${docsSource.tag}, but the newest published release is ${docsTag}`);
	section("docs", { title: "Documentation", sort_by: "weight", page_template: "docs-page.html", extra: { release: docsSource.tag } });
	const docPages = [...docsSource.files.keys()].filter((p) => p.endsWith(".md")).map((p) => p.replace(/\.md$/, ""));
	const order = [...settings.docs_order.filter((n) => docPages.includes(n)), ...docPages.filter((n) => !settings.docs_order.includes(n)).sort()];
	errors.push(...routeCollisions(order.map((n) => ({ route: `docs/${slugify(n)}`, slug: slugify(n), rel: `${settings.docs}/${n}.md@${docsSource.tag}` }))));
	const docNotes = new Map(order.map((n) => [`path:${n.toLowerCase()}.md`, `@/docs/${slugify(n)}/index.md`]));
	const docAssets = assetIndex([...docsSource.files.keys()].filter((p) => !p.endsWith(".md")));
	order.forEach((name, i) => {
		const file = `${settings.docs}/${name}.md@${docsSource.tag}`;
		const text = docsSource.files.get(`${name}.md`).toString("utf8").replace(/\r\n/g, "\n");
		const { title, body } = titleAndBody({}, text);
		errors.push(...scanPaths(body).map((f) => `${file}:${f.line}: ${f.message}`));
		const result = convertMarkdown(body, { notes: docNotes, assets: docAssets, dir: "", file, line: 1, github: true });
		errors.push(...result.errors);
		const dir = `docs/${slugify(name)}`;
		mkdirSync(join(content, dir), { recursive: true });
		for (const asset of result.assets) writeFileSync(join(content, dir, basename(asset)), docsSource.files.get(asset));
		writePage(content, dir, { title: title || name, weight: i + 1, description: summaryOf(body) }, result.markdown);
	});

	writeFileSync(join(root, "home.json"), JSON.stringify(set.home ?? {}, null, "\t"));
	writeFileSync(join(root, "updates.json"), JSON.stringify(buildUpdates(set), null, "\t"));
	// An optional photo on a ready testimonial: an image in the published assets, copied (and
	// leak-checked) under the site's testimonials/ folder. It is published with the quote, so the
	// person's approval has to cover it too — the template's GUIDE says so.
	for (const t of set.testimonials) {
		if (!t.data.photo) continue;
		const name = basename(String(t.data.photo));
		const asset = assets.get(name.toLowerCase());
		const line = t.lines?.photo ?? 1;
		if (!asset) errors.push(`${t.rel}:${line}: photo ${t.data.photo} is not a file in the published set`);
		else if (!/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(asset)) errors.push(`${t.rel}:${line}: photo ${t.data.photo} is not an image`);
		else {
			copyAsset(asset, join(root, "static", "testimonials"));
			t.photo = `testimonials/${encodeURI(basename(asset))}`;
		}
	}
	writeFileSync(join(root, "testimonials.json"), JSON.stringify(buildTestimonials(set), null, "\t"));

	const baseUrl = /^base_url\s*=\s*"([^"]+)"/m.exec(configText)?.[1];
	if (!baseUrl) throw new Error("config.toml has no base_url");
	// Two checks can name one place (an encoded file: link is both a path and a link); report once.
	return { root, set, errors: [...new Set(errors)], vaultPages, baseUrl, docsTag: docsSource.tag };
}

const TEXT_OUTPUT = /\.(svg|css|xml|txt|json)$/i;

/**
 * Stage, run Zola, run the output guard over every emitted text file. Throws with every finding,
 * or returns the output path. Everything but the documentation pages carries vault-derived text —
 * Home and every listing repeat titles and summaries — so only a docs page (public in git already,
 * and free to show Obsidian syntax) is exempt from the `[[` check.
 */
export function build(options = {}) {
	const staged = stage(options);
	if (staged.errors.length) throw new BuildError(staged.errors);
	const output = join(staged.root, "..", "public");
	rmSync(output, { recursive: true, force: true });
	run("zola", ["--root", staged.root, "build", "--output-dir", output, "--force"]);
	const fromVault = (path) => !(path.startsWith("docs/") && path !== "docs/index.html");
	const files = listFiles(output);
	const pages = files.filter((p) => p.endsWith(".html")).map((path) => ({ path, html: readFileSync(join(output, path), "utf8"), fromVault: fromVault(path) }));
	const texts = files.filter((p) => TEXT_OUTPUT.test(p)).map((path) => ({ path, text: readFileSync(join(output, path), "utf8"), fromVault: fromVault(path) }));
	const errors = guardOutput([...pages, ...texts], staged.baseUrl, (path) => existsSync(join(output, path)) && statSync(join(output, path)).isFile());
	if (errors.length) throw new BuildError(errors);
	return { ...staged, output, pages: pages.length };
}

export class BuildError extends Error {
	constructor(findings) {
		super(`${findings.length} finding(s):\n${findings.map((f) => `  ${f}`).join("\n")}`);
		this.findings = findings;
	}
}

// ─── Publishing ─────────────────────────────────────────────────────────────

/**
 * Replaces the gh-pages tree with the built output, in a temporary detached worktree, and pushes
 * it as `HEAD:gh-pages`. No local gh-pages branch is created, so a dry run leaves nothing behind.
 */
export function publish(result, { dryRun = false } = {}) {
	const worktree = mkdtempSync(join(tmpdir(), "dispatch-gh-pages-"));
	rmSync(worktree, { recursive: true, force: true });
	const hasRemote = git(["ls-remote", "--heads", "origin", "gh-pages"], { encoding: "utf8" }).trim() !== "";
	const orphan = "dispatch-gh-pages-first-publish";
	try {
		if (hasRemote) {
			git(["fetch", "origin", "gh-pages"]);
			git(["worktree", "add", "--detach", worktree, "FETCH_HEAD"]);
		} else {
			git(["worktree", "add", "--detach", worktree]);
			execFileSync("git", ["checkout", "--orphan", orphan], { cwd: worktree });
		}
		for (const entry of readdirSync(worktree)) if (entry !== ".git") rmSync(join(worktree, entry), { recursive: true, force: true });
		cpSync(result.output, worktree, { recursive: true });
		writeFileSync(join(worktree, ".nojekyll"), "");
		execFileSync("git", ["add", "--all"], { cwd: worktree });
		const source = git(["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
		const changed = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: worktree }).status !== 0;
		if (!changed) return { pushed: false, message: "gh-pages already holds this build" };
		execFileSync("git", ["commit", "--quiet", "-m", `site: ${source} (docs ${result.docsTag})`], { cwd: worktree });
		if (dryRun) return { pushed: false, message: "dry run: committed in a temporary worktree, not pushed" };
		execFileSync("git", ["push", "origin", "HEAD:refs/heads/gh-pages"], { cwd: worktree, stdio: "inherit" });
		return { pushed: true, message: `pushed gh-pages: site ${source}, docs ${result.docsTag}` };
	} finally {
		spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO_ROOT });
		if (!hasRemote) spawnSync("git", ["branch", "-D", orphan], { cwd: REPO_ROOT });
	}
}

// ─── Command line ───────────────────────────────────────────────────────────

function report(result) {
	const s = result.set;
	say(`Built ${result.pages} page(s) into ${relative(REPO_ROOT, result.output)}`);
	say(`  articles ${s.articles.length}, releases ${s.releases.length}, links ${s.links.length}, testimonials ${s.testimonials.length}, legal ${s.legal.length}, FAQ ${s.faq ? "yes" : "no"}, docs from ${result.docsTag}`);
	if (s.skipped.length) say(`  not published:\n${s.skipped.map((x) => `    ${x}`).join("\n")}`);
}

export function main(args = process.argv.slice(2)) {
	const [command] = args;
	try {
		if (!["build", "serve", "publish"].includes(command)) {
			say("Usage: website.mjs build | serve | publish [--dry-run]");
			return 2;
		}
		if (spawnSync("zola", ["--version"]).status !== 0) throw new Error("zola is not on PATH — install it from https://www.getzola.org/documentation/getting-started/installation/");
		if (command === "publish") assertDesign(join(REPO_ROOT, SITE_DIR));
		if (command === "serve") {
			const staged = stage();
			if (staged.errors.length) throw new BuildError(staged.errors);
			return spawnSync("zola", ["--root", staged.root, "serve", "--output-dir", join(staged.root, "..", "serve"), "--force"], { stdio: "inherit" }).status ?? 1;
		}
		const result = build();
		report(result);
		if (command === "publish") say(publish(result, { dryRun: args.includes("--dry-run") }).message);
		return 0;
	} catch (error) {
		process.stderr.write(`Website ${command} failed: ${error.message}\n`);
		return 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exitCode = main();
