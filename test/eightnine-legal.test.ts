import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linkPages, PAGES, renderPage, textDiff, visibleText } from "../dispatch/scripts/eightnine-legal.mjs";

const note = (name: string) => readFileSync(`test/fixtures/website/clean/10_Website/Legal/${name}.md`, "utf8");
const privacy = PAGES.find((p: { file: string }) => p.file === "privacy.html");
const impressum = PAGES.find((p: { file: string }) => p.file === "impressum.html");

describe("regenerating the eightnine.de legal pages", () => {
	it("renders a note into the existing page shell", () => {
		const html = renderPage(privacy, note("Privacy Policy"));
		expect(html).toContain('<html lang="en">');
		expect(html).toContain("<title>Privacy Policy — Dispatch</title>");
		expect(html).toContain('<meta name="description" content="What we do not collect.">');
		expect(html).toContain('<nav class="crumb"><a href="./">Dispatch</a> → Privacy Policy</nav>');
		expect(html).toContain('<p class="effective"><strong>Effective 2 September 2026.</strong></p>');
		expect(html).toContain('<a href="impressum.html">legal notice</a>');
		expect(html).toContain('<p class="note">A note paragraph.</p>');
		expect(html).toMatch(/<div class="table-scroll">\n<table>[\s\S]*<\/table>\n<\/div>/);
		expect(html).toContain('<a href="terms.html">Terms of Service</a> ·\n<a href="impressum.html">Impressum</a>');
		expect(html).not.toContain("robots");
	});

	it("carries the note's language and robots setting", () => {
		const html = renderPage(impressum, note("Impressum"));
		expect(html).toContain('<html lang="de">');
		expect(html).toContain('<meta name="robots" content="noindex">');
		expect(html).toContain("Kai<br>Straße 1");
	});

	it("refuses a wikilink to anything but the three legal pages", () => {
		expect(linkPages("[[Terms of Service|terms]] and [[Impressum]]", "x")).toBe("[terms](terms.html) and [Impressum](impressum.html)");
		expect(() => linkPages("see [[Private note]]", "privacy.html")).toThrow("privacy.html: [[Private note]] is not one of the legal pages");
	});
});

describe("the text comparison that guards the published legal text", () => {
	const page = (body: string) => `<head><title>x</title></head><main>${body}</main><footer>ignored</footer>`;

	it("ignores markup, line breaks, entities and spacing before punctuation", () => {
		expect(visibleText(page("<p>Hello\n<strong>world</strong> .</p><p>Don&#39;t &amp; won&rsquo;t</p>"))).toEqual(["Hello", "world.", "Don't", "&", "won’t"]);
		expect(textDiff(page("<p>One two\nthree.</p>"), page("<h2>One</h2>\n<p>two three.</p>"))).toEqual([]);
	});

	it("shows every word that is removed or added", () => {
		expect(textDiff(page("<p>published on this page</p>"), page("<p>published in this document</p>"))).toEqual([
			"- on",
			"+ in",
			"- page",
			"+ document",
		]);
	});
});
