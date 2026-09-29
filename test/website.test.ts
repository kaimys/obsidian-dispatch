import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assertDesign,
	blankInlineCode,
	build,
	buildUpdates,
	compareVersions,
	convertMarkdown,
	extractReleaseBody,
	frontMatter,
	guardOutput,
	headingSlug,
	isReady,
	newestReleaseTag,
	parseNote,
	readSiteSettings,
	scanPaths,
	segments,
	stage,
	summaryOf,
	teraString,
	titleAndBody,
} from "../dispatch/scripts/website.mjs";

const FIXTURES = "test/fixtures/website";
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const fakeDiagram = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const docs = {
	tag: "1.0.1",
	files: new Map<string, Buffer>([
		["overview.md", Buffer.from("# Overview\n\nSee [installation](installation.md#the-google-block--optional-import) and ![Board](assets/board.png).\n\n<img src=\"assets/board.png\" alt=\"Board\" width=\"33%\">\n\n| Document |\n| --- |\n| [[Product Vision]] |\n\n```json\n{ \"repo\": \"C:\\\\Users\\\\me\\\\Workspace\\\\app\" }\n```\n")],
		["installation.md", Buffer.from("# Installation\n\nVariables: `{{id}}` and `{{file}}`.\n\n## The google block — optional import\n\nText.\n")],
		["assets/board.png", Buffer.from("png")],
	]),
};

/** A site root with the real starter theme — and, with `design`, the project's own templates and
 * static files — and a config pointing at the fixture layout. */
function fixtureSite({ design = false } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "dispatch-website-test-"));
	const site = join(dir, "site");
	mkdirSync(site);
	cpSync("dispatch/website/themes", join(site, "themes"), { recursive: true });
	if (design) for (const part of ["templates", "static"]) cpSync(`dispatch/website/${part}`, join(site, part), { recursive: true });
	writeFileSync(
		join(site, "config.toml"),
		read("dispatch/website/config.toml").replace('releases = "08_Delivery_and QA/Releases"', 'releases = "08_Releases"'),
	);
	return { site, buildDir: join(dir, ".build") };
}

const stageFixture = (vault: "clean" | "broken") => {
	const { site, buildDir } = fixtureSite();
	return stage({ wikiRoot: join(FIXTURES, vault), siteDir: site, buildDir, docs, renderDiagram: fakeDiagram });
};

describe("reading notes and settings", () => {
	it("reads website frontmatter as strings, lists included, and knows where the body starts", () => {
		const note = parseNote("---\ntitle: \"A: title\"\ndate: 2026-09-24\nauthor:\n  - Kai\n  - Someone\nempty:\n---\n# Heading\n");
		expect(note.data).toEqual({ title: "A: title", date: "2026-09-24", author: ["Kai", "Someone"], empty: "" });
		expect(note.bodyLine).toBe(9);
		expect(note.body).toBe("# Heading\n");
	});

	it("publishes only status: ready — a typo, a draft and a missing property are all not ready", () => {
		expect(isReady({ status: "ready" })).toBe(true);
		for (const data of [{ status: "Ready" }, { status: "draft" }, {}, { is_published: "true" }]) expect(isReady(data)).toBe(false);
	});

	it("reads the [extra.dispatch] table and nothing else", () => {
		const settings = readSiteSettings(read("dispatch/website/config.toml"));
		expect(settings).toMatchObject({ source: "10_Website", releases: "08_Delivery_and QA/Releases", docs: "docs" });
		expect(settings.docs_order).toEqual(["overview", "installation", "page-types", "skills", "wiki-structure"]);
		expect(readSiteSettings("[extra]\n[[extra.social]]\nlabel = \"X\"\n[extra.dispatch]\nsource = \"W\"\n").source).toBe("W");
		expect(() => readSiteSettings("[extra.dispatch]\nsource = 10\n")).toThrow("string");
	});

	it("takes the title from title:, else from the leading # heading, which it removes", () => {
		expect(titleAndBody({}, "# From heading\n\nBody")).toEqual({ title: "From heading", body: "\n\nBody" });
		expect(titleAndBody({ title: "Given" }, "# Given\n\nBody").body).toBe("\n\nBody");
		expect(titleAndBody({ title: "Given" }, "Intro\n\n# Later").body).toBe("Intro\n\n# Later");
	});

	it("summarises the first prose paragraph as plain text", () => {
		expect(summaryOf("## Heading\n\n![img](x.png)\n\nA [link](u) and [[Note|label]] with **bold**.\n\nSecond.")).toBe("A link and label with bold.");
		expect(summaryOf("No `node_modules`, *stress* and _this_; see https://github.com/x/y.")).toBe("No node_modules, stress and this; see github.com/x/y.");
		expect(summaryOf("word ".repeat(80), 20).endsWith("…")).toBe(true);
	});
});

describe("release notes", () => {
	it("extracts only the fenced GitHub release body, four-backtick fences included", () => {
		const note = "# v1\n\nInternal.\n\n## GitHub release body\n\n````markdown\n## Title\n\n```js\ncode\n```\n````\n\n## After\n";
		expect(extractReleaseBody(note)).toBe("## Title\n\n```js\ncode\n```\n");
		expect(extractReleaseBody("# v1\n\n## Build\n")).toBeNull();
		expect(extractReleaseBody("## GitHub release body\n\n## Next\n\n```\nnot the body\n```\n")).toBeNull();
	});

	it("finds the newest release tag and orders versions numerically", () => {
		expect(newestReleaseTag(["0.2.9", "0.3.1", "v0.3.10", "0.3.2", "nightly", ""])).toBe("v0.3.10");
		expect(newestReleaseTag(["not-a-release"])).toBeNull();
		expect(["0.3.10", "0.3.9", "v1.0.0"].sort(compareVersions)).toEqual(["0.3.9", "0.3.10", "v1.0.0"]);
	});
});

describe("Markdown conversion", () => {
	const notes = new Map([["other", "@/articles/other/index.md"], ["path:articles/other.md", "@/articles/other/index.md"]]);
	const assets = new Map([["pic.png", "assets/pic.png"], ["path:assets/pic.png", "assets/pic.png"]]);
	const convert = (body: string, extra = {}) => convertMarkdown(body, { notes, assets, dir: "Articles", file: "a.md", line: 1, ...extra });

	it("rewrites wikilinks, embeds, relative links, callouts, highlights and comments", () => {
		const { markdown, errors, assets: used } = convert(
			"[[Other]] and [[Other#Some Heading|there]].\n![[pic.png|Alt text|300]]\n![Rel](../assets/pic.png) [Other](Other.md)\n==hi== %%hidden%%\n> [!tip] Title\n> Body",
		);
		expect(errors).toEqual([]);
		expect(markdown).toContain("[Other](@/articles/other/index.md) and [there](@/articles/other/index.md#some-heading)");
		expect(markdown).toContain('<figure>\n<img src="pic.png" alt="Alt text" width="300">\n</figure>');
		expect(markdown).toContain("![Rel](pic.png) [Other](@/articles/other/index.md)");
		expect(markdown).toContain("<mark>hi</mark>");
		expect(markdown).not.toContain("hidden");
		expect(markdown).toContain('{% callout(type="tip", title="Title") %}\nBody\n{% end %}');
		expect(used).toEqual(["assets/pic.png"]);
	});

	it("resolves Obsidian's bare-name links vault-wide, and docs links only relatively", () => {
		expect(convert("![A](pic.png)").errors).toEqual([]);
		expect(convert("![A](pic.png)", { github: true, dir: "" }).errors).toEqual(["a.md:1: link pic.png points outside the published set"]);
	});

	it("never touches code: fenced blocks and inline spans keep links and paths verbatim", () => {
		const body = "```\n[[Missing]] C:\\Users\\x\n```\n`[[Missing]]` and `C:\\Users\\x`";
		expect(convert(body)).toMatchObject({ markdown: body, errors: [] });
		expect(scanPaths(body)).toEqual([]);
	});

	it("gives every heading a GitHub-style id, numbering repeats", () => {
		const { markdown } = convert("## Setup\n## Setup\n## The google block — optional import\n## Already {#kept}");
		expect(markdown).toBe("## Setup {#setup}\n## Setup {#setup-1}\n## The google block — optional import {#the-google-block--optional-import}\n## Already {#kept}");
		expect(headingSlug("The `google` block — optional Meet transcript import")).toBe("the-google-block--optional-meet-transcript-import");
	});

	it("makes a title-only callout an inline shortcode, since Zola rejects an empty body", () => {
		expect(convert("> [!quote] Only a title\n\nNext").markdown).toBe('{{ callout(type="quote", title="Only a title") }}\n\nNext');
		expect(teraString('He said "no"')).toBe("'He said \"no\"'");
	});

	it("renders a Mermaid block as a figure with its accTitle as alt text and accDescr as description", () => {
		const { markdown, diagrams } = convert("```mermaid\nflowchart TD\n    accTitle: Flow <1>\n    accDescr: A to B.\n    A --> B\n```");
		expect(diagrams).toHaveLength(1);
		expect(markdown).toContain('<img src="diagram-1.svg" alt="Flow &lt;1&gt;" aria-describedby="diagram-1-description">');
		expect(markdown).toContain('<figcaption>Flow &lt;1&gt;. <a class="figure-desc" href="#diagram-1-description">Diagram description</a></figcaption>');
		expect(markdown).toContain('<details class="figure-long">\n<summary>Diagram description</summary>\n<p id="diagram-1-description">A to B.</p>\n</details>');
	});

	it("sets an image alone on its line as a figure, and one inside text as an image", () => {
		expect(convert("![A picture](../assets/pic.png)").markdown).toBe('<figure>\n<img src="pic.png" alt="A picture">\n</figure>');
		expect(convert("Text ![A picture](../assets/pic.png) more").markdown).toBe("Text ![A picture](pic.png) more");
	});

	it("links a bare URL, shown without its scheme, and leaves every other URL alone", () => {
		expect(convert("See https://github.com/x/y/issues/5.").markdown).toBe("See [github.com/x/y/issues/5](https://github.com/x/y/issues/5).");
		for (const kept of ["[t](https://a.b/c)", "<https://a.b/c>", '<a href="https://a.b/c">t</a>', "`https://a.b/c`"]) expect(convert(kept).markdown).toBe(kept);
	});

	it("rewrites raw HTML images and requires their alt text", () => {
		const { markdown, errors } = convert('<img src="../assets/pic.png" alt="Pic" width="33%">\n<img src="../assets/pic.png">');
		expect(markdown).toContain('<img src="pic.png" alt="Pic" width="33%">');
		expect(errors).toEqual(["a.md:2: image ../assets/pic.png has no alt text"]);
	});

	it("reports each path once, forward-slash drive paths included, and leaves URLs alone", () => {
		expect(scanPaths("Open file:///C:/Users/kai/x.md or C:/Users/kai/y.md, not https://example.com/Users/z.").map((f) => f.message)).toEqual([
			"a file:// URL: file:///C:/Users/kai/x.md",
			"a local filesystem path: C:/Users/kai/y.md,",
		]);
	});

	it("blanks inline code without moving offsets", () => {
		expect(blankInlineCode("a `b` c")).toBe("a     c");
		expect(segments("x\n```js\ncode\n```\ny").map((s) => s.code)).toEqual([false, true, false]);
	});
});

describe("front matter", () => {
	it("writes only the fields it is given, as TOML, with dates unquoted", () => {
		expect(frontMatter({ title: 'Say "hi"', date: "2026-09-24", weight: 2, empty: "", extra: { author: "Kai", none: "" } })).toBe(
			'+++\ntitle = "Say \\"hi\\""\ndate = 2026-09-24\nweight = 2\n[extra]\nauthor = "Kai"\n+++\n',
		);
	});
});

describe("the clean fixture vault", () => {
	const staged = stageFixture("clean");
	const content = (path: string) => read(join(staged.root, "content", path));

	it("stages with no finding", () => expect(staged.errors).toEqual([]));

	it("publishes the ready articles only, and says what it skipped and why", () => {
		expect(staged.set.articles.map((a: { slug: string }) => a.slug)).toEqual(["getting-started", "second-article"]);
		expect(staged.set.skipped).toEqual([
			"10_Website/Articles/Capital ready.md (status: Ready)",
			"10_Website/Articles/Draft.md (status: draft)",
			"10_Website/Articles/No status.md (status: unset)",
			"10_Website/FAQ.md (status: draft)",
			"10_Website/Links/Unready.md (status: unset)",
			"08_Releases/Release 0.9.0.md (no GitHub release body)",
		]);
		expect(existsSync(join(staged.root, "content", "articles", "draft"))).toBe(false);
		expect(existsSync(join(staged.root, "content", "faq"))).toBe(false);
	});

	it("never passes a vault property through to a page", () => {
		const page = content("articles/getting-started/index.md");
		expect(page.startsWith('+++\ntitle = "Getting started"\ndate = 2026-09-20\n')).toBe(true);
		expect(page).not.toMatch(/^status|^owner|^source_of_truth/m);
		expect(content("legal/impressum/index.md")).toContain('lang = "de"\nrobots = "noindex"');
	});

	it("copies only the assets a page uses, next to that page, and renders its diagram", () => {
		const dir = join(staged.root, "content", "articles", "getting-started");
		expect(existsSync(join(dir, "pic.png"))).toBe(true);
		expect(existsSync(join(dir, "diagram-1.svg"))).toBe(true);
		expect(existsSync(join(staged.root, "content", "articles", "second-article", "diagram-1.svg"))).toBe(false);
		expect(existsSync(join(staged.root, "content", "articles", "second-article", "secret.png"))).toBe(false);
	});

	it("publishes a released note's GitHub body only, and skips planned notes and notes without one", () => {
		expect(staged.set.releases.map((r: { version: string }) => r.version)).toEqual(["1.0.1", "1.0.0"]);
		const page = content("releases/1-0-0/index.md");
		expect(page).toContain("The first release.");
		expect(page).not.toContain("Internal notes");
		expect(page).not.toContain("Tag 1.0.0");
	});

	it("lists updates newest first, the newer release first on a shared date, links included", () => {
		const updates = JSON.parse(read(join(staged.root, "updates.json")));
		expect(updates.map((u: { title: string }) => u.title)).toEqual(["Second article", "A podcast about Dispatch", "Getting started", "v1.0.1", "v1.0.0"]);
		expect(updates[1]).toEqual({ kind: "link", title: "A podcast about Dispatch", url: "https://example.com/podcast", date: "2026-09-21", summary: "" });
		expect(updates[0]).toMatchObject({ kind: "article", url: "articles/second-article/", summary: "The second one." });
	});

	it("takes Home's pitch from the Home note, and its button only while the article is published", () => {
		expect(JSON.parse(read(join(staged.root, "home.json")))).toEqual({
			eyebrow: "Obsidian plugin",
			title: "A pitch in one line",
			lede: "The lede: it says what Dispatch does.",
			requirements: "Desktop only.",
			read_more: { url: "articles/getting-started/", title: "Getting started" },
		});
	});

	it("copies an article's teaser next to it and names it in the page's extra", () => {
		expect(existsSync(join(staged.root, "content", "articles", "second-article", "pic.png"))).toBe(true);
		expect(content("articles/second-article/index.md")).toContain('teaser = "pic.png"\nteaser_cover = true');
	});

	it("orders legal pages by weight, then file name, and honours slug", () => {
		expect(staged.set.legal.map((l: { slug: string }) => l.slug)).toEqual(["privacy", "impressum"]);
		expect(content("legal/_index.md")).toContain('page_template = "legal.html"');
	});

	it("names each section's templates and turns on heading anchors", () => {
		expect(content("releases/_index.md")).toContain('sort_by = "weight"\ntemplate = "releases.html"\npage_template = "release.html"\ninsert_anchor_links = "right"');
		expect(content("releases/1-0-1/index.md")).toContain("weight = 1");
		expect(content("releases/1-0-0/index.md")).toContain("weight = 2");
		expect(content("_index.md")).toContain('insert_anchor_links = "right"');
	});

	it("writes an empty testimonial list when there is no testimonial note", () => {
		expect(JSON.parse(read(join(staged.root, "testimonials.json")))).toEqual([]);
	});

	it("renders docs from the given tag, rewriting links, anchors and assets and leaving {{…}} alone", () => {
		const overview = content("docs/overview/index.md");
		expect(overview).toContain("[installation](@/docs/installation/index.md#the-google-block--optional-import)");
		expect(overview).toContain("![Board](board.png)");
		expect(overview).toContain('<img src="board.png" alt="Board" width="33%">');
		expect(overview).toContain("| [[Product Vision]] |");
		expect(content("docs/installation/index.md")).toContain("`{{id}}`");
		expect(content("docs/_index.md")).toContain('release = "1.0.1"');
	});
});

describe("the broken fixture vault — every mistake fails with file and line", () => {
	const { errors } = stageFixture("broken");
	const expected = [
		"10_Website/Articles/Links a draft.md:7: [[Draft]] links to a page that is not published",
		"10_Website/Articles/Embeds outside.md:7: embed ![[secret.png]] is not a file in the published set",
		"10_Website/Articles/Links outside.md:7: link ../../02_Private/Private%20note.md points outside the published set",
		"10_Website/Articles/Windows path.md:7: a local filesystem path: C:\\Users\\kai\\notes",
		"10_Website/Articles/Vault path.md:7: a path into the vault (dispatch/wiki/…): dispatch/wiki/05_Requirements/Tickets/US00001.md",
		"10_Website/Articles/File URL.md:7: a file:// URL: file:///C:/Users/kai/vault/note.md",
		"10_Website/Articles/Home path.md:7: a local filesystem path: /Users/kai/Documents/vault.",
		"10_Website/Articles/No alt.md:7: image pic.png has no alt text (write ![[pic.png|Alt text]])",
		"10_Website/Articles/Markdown no alt.md:7: image ../assets/pic.png has no alt text",
		"10_Website/Articles/Mermaid no description.md:7: a Mermaid diagram needs accTitle: and accDescr: lines",
		"10_Website/Articles/No date.md:1: missing date",
		"10_Website/Articles/Bad date.md:1: date must be YYYY-MM-DD, not \"29.09.2026\"",
		"10_Website/Testimonials/Missing consent.md:1: missing consent",
		"10_Website/Links/No date.md:1: missing date",
		"10_Website/Links/Relative url.md:1: url must be an absolute http(s) URL",
		"08_Releases/Release 2.0.0.md:17: [[Release 1.9.0]] links to a page that is not published",
		"08_Releases/Release 2.0.0.md:17: a path into the vault (dispatch/wiki/…): dispatch/wiki/08_Releases/x.md.",
		"08_Releases/Release 2.1.0.md:1: a released note needs version: vX.Y.Z and date: YYYY-MM-DD",
		"10_Website/Articles/Missing teaser.md:1: teaser nowhere.png is not a file in the published set",
	];
	for (const finding of expected) it(finding.replace(/:\d+: .*/, "") + " — " + finding.split(/:\d+: /)[1], () => expect(errors).toContain(finding));
	it("reports nothing else", () => expect([...errors].sort()).toEqual([...expected].sort()));
});

describe("the output guard", () => {
	const base = "https://kaimys.github.io/obsidian-dispatch";
	const files = new Set(["index.html", "articles/a/index.html", "articles/a/pic.png", "starter.css"]);
	const guard = (html: string, fromVault = true) => guardOutput([{ path: "articles/a/index.html", html, fromVault }], base, (p: string) => files.has(p));

	it("passes internal links under the subpath, relative assets, anchors and external links", () => {
		expect(guard(`<a href="${base}/">h</a><a href="${base}/articles/a/">a</a><img src="pic.png" alt="x"><a href="#top">t</a><a href="https://example.com">e</a><link href="${base}/starter.css">`)).toEqual([]);
	});

	it("decodes entity-escaped URLs before judging them", () => {
		expect(guard(`<a href="https:&#x2F;&#x2F;example.com&#x2F;x">e</a><a href="${base.replaceAll("/", "&#x2F;")}&#x2F;articles&#x2F;a&#x2F;">a</a>`)).toEqual([]);
		expect(guard(`<a href="${base.replaceAll("/", "&#x2F;")}&#x2F;gone&#x2F;">g</a>`)).toHaveLength(1);
	});

	it("fails a broken internal link, a root-relative URL and a missing asset", () => {
		expect(guard(`<a href="${base}/nowhere/">x</a>\n<a href="/articles/a/">y</a>\n<img src="gone.png" alt="z">`)).toEqual([
			"articles/a/index.html:1: broken link https://kaimys.github.io/obsidian-dispatch/nowhere/",
			"articles/a/index.html:2: root-relative URL /articles/a/ breaks under the site's subpath",
			"articles/a/index.html:3: broken link gone.png",
		]);
	});

	it("fails an unconverted wikilink on a vault page, but not on a docs page, and never inside code", () => {
		expect(guard("<p>see [[Secret]]</p>")).toEqual(["articles/a/index.html:1: unconverted wikilink [[Secret]]"]);
		expect(guard("<p>see [[Product Vision]]</p>", false)).toEqual([]);
		expect(guard("<pre><code>[[x]]</code></pre>")).toEqual([]);
	});

	it("fails filesystem and vault paths in text, but not in code", () => {
		expect(guard("<p>in C:\\Users\\kai\\vault</p>\n<p>dispatch/wiki/05_Requirements/x.md</p>")).toEqual([
			"articles/a/index.html:1: a local filesystem path: C:\\Users\\kai\\vault",
			"articles/a/index.html:2: a path into the vault (dispatch/wiki/…): dispatch/wiki/05_Requirements/x.md",
		]);
		expect(guard("<pre><code>C:\\Users\\me\\x</code></pre><code>dispatch/wiki/a</code>")).toEqual([]);
	});
});

describe("the placeholder is never published, and nothing built is committed", () => {
	it("refuses to publish while only the starter theme would render", () => {
		const { site } = fixtureSite();
		expect(() => assertDesign(site)).toThrow("only the starter theme would render");
		mkdirSync(join(site, "templates"));
		writeFileSync(join(site, "templates", "index.html"), "{% extends \"base.html\" %}");
		expect(() => assertDesign(site)).not.toThrow();
	});

	it("git-ignores the staging folder", () => {
		expect(read(".gitignore").split("\n")).toContain("/dispatch/website/.build/");
		expect(spawnSync("git", ["check-ignore", "-q", "dispatch/website/.build/site/content/x.md"]).status).toBe(0);
	});

	it("keeps the updates order stable for equal dates", () => {
		const set = { releases: [{ title: "B", slug: "b", date: "2026-01-01", content: "" }, { title: "A", slug: "a", date: "2026-01-01", content: "" }], articles: [], links: [] };
		expect(buildUpdates(set).map((u: { title: string }) => u.title)).toEqual(["B", "A"]);
	});
});

const zola = spawnSync("zola", ["--version"]).status === 0;

describe.skipIf(!zola)("a real Zola build of the clean fixture (skipped without zola on PATH, as in CI)", () => {
	it("builds, and the output guard passes over every page", () => {
		const { site, buildDir } = fixtureSite();
		const result = build({ wikiRoot: join(FIXTURES, "clean"), siteDir: site, buildDir, docs, renderDiagram: fakeDiagram });
		const html = (path: string) => read(join(result.output, path));
		expect(result.pages).toBeGreaterThan(10);
		expect(html("index.html")).toContain("A podcast about Dispatch");
		expect(html("index.html")).not.toContain("testimonial");
		expect(html("articles/getting-started/index.html")).toContain('href="https://kaimys.github.io/obsidian-dispatch/articles/second-article/#details"');
		expect(html("legal/impressum/index.html")).toContain('<meta name="robots" content="noindex">');
		expect(html("docs/installation/index.html")).toContain('id="the-google-block--optional-import"');
	});

	it("builds with the project's design, and the output guard passes over every page", () => {
		const { site, buildDir } = fixtureSite({ design: true });
		const result = build({ wikiRoot: join(FIXTURES, "clean"), siteDir: site, buildDir, docs, renderDiagram: fakeDiagram });
		const html = (path: string) => read(join(result.output, path));
		const home = html("index.html");
		expect(home).toContain('<h1 id="pitch">A pitch in one line');
		expect(home).toContain("Read Getting started");
		expect(home).toContain('A podcast about Dispatch <span class="ext" aria-hidden="true">&#8599;</span><span class="visually-hidden">(external)</span>');
		expect(home).not.toContain('class="testimonials"');
		expect(home).toContain('<a href="https://www.linkedin.com/in/kaimysliwiec/">');
		expect(home).toMatch(/class="logo" href="[^"]+" aria-current="page"/);
		const article = html("articles/getting-started/index.html");
		expect(article).toMatch(/href="[^"]*\/articles\/" aria-current="page">Articles/);
		expect(article).toContain('<a class="zola-anchor" href="#setup" aria-label="Anchor link for: setup">#</a>');
		expect(article).not.toContain('<p class="description">');
		expect(html("articles/second-article/index.html")).toContain('<p class="description">The second one.</p>');
		expect(html("articles/index.html")).toContain('<span class="teaser teaser-cover"><img src="https://kaimys.github.io/obsidian-dispatch/articles/second-article/pic.png"');
		const newer = html("releases/1-0-0/index.html");
		expect(newer).toMatch(/<a href="[^"]*\/releases\/1-0-1\/">v1.0.1 &rarr;<\/a>/);
		expect(html("docs/overview/index.html")).toMatch(/class="next" href="[^"]*\/docs\/installation\/"/);
		expect(html("legal/impressum/index.html")).toContain('<html lang="de">');
		expect(html("legal/impressum/index.html")).toContain('hreflang="en">Privacy Policy</a>');
	});
});
