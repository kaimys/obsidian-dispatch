#!/usr/bin/env node
/**
 * Regenerates the eightnine.de legal pages from the vault's legal notes (US00018, Q8).
 *
 * Usage:
 *   node dispatch/scripts/eightnine-legal.mjs           # compare only: print what would change
 *   node dispatch/scripts/eightnine-legal.mjs --write   # write docs/privacy.html, terms.html, impressum.html
 *
 * Project-scope and temporary. `docs/*.html` is the page Google's OAuth consent screen names as
 * the Meet import's home page, which is the only reason eightnine.de keeps its own copy of the
 * legal text. US00069 does not lift this file; when US00068 removes the OAuth client, this file
 * and those pages can go.
 *
 * The notes are the single source; the HTML is uploaded by hand. Before any upload, the visible
 * text of each regenerated page is compared with the committed one, so a change to the published
 * legal text is always seen by a person first.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { REPO_ROOT, parseNote } from "./website.mjs";

export const LEGAL_DIR = join("dispatch", "wiki", "10_Website", "Legal");
export const PAGES = [
	{ note: "Privacy Policy", file: "privacy.html" },
	{ note: "Terms of Service", file: "terms.html" },
	{ note: "Impressum", file: "impressum.html" },
];

const say = (message = "") => process.stdout.write(`${message}\n`);

function escapeHtml(text) {
	return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Wikilinks between the legal notes become links between the pages; any other one is an error. */
export function linkPages(body, file) {
	const byNote = new Map(PAGES.map((p) => [p.note.toLowerCase(), p.file]));
	return body.replace(/%%[\s\S]*?%%/g, "").replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, target, label) => {
		const page = byNote.get(target.trim().toLowerCase());
		if (!page) throw new Error(`${file}: ${m} is not one of the legal pages`);
		return `[${label ?? target}](${page})`;
	});
}

/** One page in the existing eightnine.de shell: crumb, the note's HTML, footer to the others. */
export function renderPage(page, note) {
	const { data, body } = parseNote(note);
	// A `> [!note]` callout is the page's `<p class="note">`; its lines lose the quote marker.
	const notes = [];
	const source = linkPages(body, page.file).replace(/^> \[!note\][^\n]*\n((?:>[^\n]*(?:\n|$))+)/gm, (m, inner) => {
		notes.push(marked.parseInline(inner.replace(/^>\s?/gm, "").trim(), { gfm: true }));
		return `NOTE-${notes.length - 1}\n\n`;
	});
	let html = marked.parse(source, { gfm: true, breaks: false }).trim();
	html = html.replace(/<p>NOTE-(\d+)<\/p>/g, (m, i) => `<p class="note">${notes[Number(i)]}</p>`);
	// The paragraph under the title is the effective date or the language notice; the stylesheet
	// sets it apart by this class, as the hand-written pages did. Tables scroll on narrow screens.
	html = html.replace(/(<\/h1>\s*)<p>/, '$1<p class="effective">');
	html = html.replace(/<table>[\s\S]*?<\/table>/g, (table) => `<div class="table-scroll">\n${table}\n</div>`);
	const others = PAGES.filter((p) => p.file !== page.file).map((p) => `<a href="${p.file}">${p.note}</a>`);
	return `<!doctype html>
<html lang="${escapeHtml(data.lang || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.note)} — Dispatch</title>
<meta name="description" content="${escapeHtml(data.description || "")}">
${data.robots ? `<meta name="robots" content="${escapeHtml(data.robots)}">\n` : ""}<link rel="stylesheet" href="style.css">
</head>
<body>
<main>

<nav class="crumb"><a href="./">Dispatch</a> → ${escapeHtml(page.note)}</nav>

${html}

<footer>
<a href="./">Dispatch</a> · ${others.join(" ·\n")} ·
<a href="https://eightnine.de/">eightnine.de</a>
</footer>

</main>
</body>
</html>
`;
}

/** The words a reader sees in `<main>`, one per line, so a diff shows only real text changes. */
export function visibleText(html) {
	const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
	return String(html)
		.replace(/^[\s\S]*?<main>/, "")
		.replace(/<\/main>[\s\S]*$/, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&(#?\w+);/g, (m, name) => entities[name] ?? (name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : m))
		.replace(/\s+([.,;:!?)])/g, "$1")
		.split(/\s+/)
		.filter(Boolean);
}

/** Words removed from and added to the visible text, in order; empty when the text is unchanged. */
export function textDiff(before, after) {
	const [a, b] = [visibleText(before), visibleText(after)];
	const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
	for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	const out = [];
	let [i, j] = [0, 0];
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			i++;
			j++;
		} else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`- ${a[i++]}`);
		else out.push(`+ ${b[j++]}`);
	}
	return out;
}

export function main(args = process.argv.slice(2), root = REPO_ROOT) {
	try {
		let changed = 0;
		for (const page of PAGES) {
			const source = join(root, LEGAL_DIR, `${page.note}.md`);
			if (!existsSync(source)) throw new Error(`${LEGAL_DIR}/${page.note}.md not found`);
			const target = join(root, "docs", page.file);
			const html = renderPage(page, readFileSync(source, "utf8"));
			const diff = existsSync(target) ? textDiff(readFileSync(target, "utf8"), html) : ["+ (new file)"];
			if (diff.length) {
				changed++;
				say(`docs/${page.file}: the visible text changes`);
				for (const line of diff) say(`  ${line}`);
			} else say(`docs/${page.file}: text unchanged`);
			if (args.includes("--write")) writeFileSync(target, html);
		}
		if (args.includes("--write")) say("Written. Review the diff above before uploading to eightnine.de by hand.");
		return changed && !args.includes("--write") ? 1 : 0;
	} catch (error) {
		process.stderr.write(`eightnine-legal failed: ${error.message}\n`);
		return 2;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exitCode = main();
