import { App, PluginSettingTab, Setting } from "obsidian";
import type DispatchPlugin from "./main";

export class DispatchSettingTab extends PluginSettingTab {
	plugin: DispatchPlugin;

	constructor(app: App, plugin: DispatchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Board").setHeading();

		new Setting(containerEl)
			.setName("Source folders")
			.setDesc("Vault folders scanned for cards, one per line.")
			.addTextArea((ta) =>
				ta
					.setPlaceholder("02_Requirements/User-Stories")
					.setValue(this.plugin.shared.board.sourceFolders.join("\n"))
					.onChange(async (v) => {
						this.plugin.shared.board.sourceFolders = splitLines(v);
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Status property")
			.setDesc("Frontmatter property that holds the column value.")
			.addText((t) =>
				t.setValue(this.plugin.shared.board.statusProperty).onChange(async (v) => {
					this.plugin.shared.board.statusProperty = v.trim() || "status";
					await this.plugin.saveShared();
				})
			);

		new Setting(containerEl)
			.setName("Order property")
			.setDesc(
				"Frontmatter property storing the manual sort position within a column (written on drag & drop). Leave empty to disable manual ordering."
			)
			.addText((t) =>
				t.setValue(this.plugin.shared.board.orderProperty).onChange(async (v) => {
					this.plugin.shared.board.orderProperty = v.trim();
					await this.plugin.saveShared();
				})
			);

		new Setting(containerEl)
			.setName("Columns")
			.setDesc(
				"One column per line: status value | display label | milestone progress | WIP limit. Label may be empty; progress is 0–100 (how complete a card with this status counts on the Milestones tab) or - to exclude the status from milestone progress; the WIP limit highlights the column when reached (amber) or exceeded (red)."
			)
			.addTextArea((ta) =>
				ta
					.setPlaceholder("Backlog | | 0\nIn progress | Doing | 50 | 5\nDone | | 100\nRejected | | -")
					.setValue(
						this.plugin.shared.board.columns
							.map((c) => {
								const progress = c.excluded ? "-" : c.progress !== undefined ? String(c.progress) : "";
								const wip = c.wip !== undefined ? String(c.wip) : "";
								let line = c.value;
								if (c.label || progress || wip) line += ` | ${c.label ?? ""}`;
								if (progress || wip) line += ` | ${progress}`;
								if (wip) line += ` | ${wip}`;
								return line;
							})
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.shared.board.columns = splitLines(v).map((line) => {
							const parts = line.split("|").map((s) => s.trim());
							const col: {
								value: string;
								label?: string;
								progress?: number;
								excluded?: boolean;
								wip?: number;
							} = { value: parts[0] };
							if (parts[1]) col.label = parts[1];
							if (parts[2]) {
								if (parts[2] === "-") col.excluded = true;
								else if (!Number.isNaN(Number(parts[2])))
									col.progress = Math.max(0, Math.min(100, Number(parts[2])));
							}
							if (parts[3] && !Number.isNaN(Number(parts[3])) && Number(parts[3]) > 0) {
								col.wip = Math.floor(Number(parts[3]));
							}
							return col;
						});
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Title property")
			.setDesc("Frontmatter property shown before the file name on each card (e.g. a ticket id).")
			.addText((t) =>
				t.setValue(this.plugin.shared.board.titleProperty).onChange(async (v) => {
					this.plugin.shared.board.titleProperty = v.trim();
					await this.plugin.saveShared();
				})
			);

		new Setting(containerEl)
			.setName("Assignee property")
			.setDesc(
				"Frontmatter property naming the ticket's assignee — shown as an @-badge on the card and always offered in the slice-by bar. Empty = off."
			)
			.addText((t) =>
				t
					.setPlaceholder("assignee")
					.setValue(this.plugin.shared.board.assigneeProperty)
					.onChange(async (v) => {
						this.plugin.shared.board.assigneeProperty = v.trim();
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Badge properties")
			.setDesc("Comma-separated frontmatter properties rendered as badges on each card.")
			.addText((t) =>
				t
					.setValue(this.plugin.shared.board.badgeProperties.join(", "))
					.onChange(async (v) => {
						this.plugin.shared.board.badgeProperties = v
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Open-questions property")
			.setDesc(
				"Numeric frontmatter property counting unanswered refinement questions. Shown as a \"? N\" badge on cards — green at 0 (refinement complete). Empty = off."
			)
			.addText((t) =>
				t
					.setPlaceholder("open_questions")
					.setValue(this.plugin.shared.board.questionsProperty)
					.onChange(async (v) => {
						this.plugin.shared.board.questionsProperty = v.trim();
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Open-tests property")
			.setDesc(
				"Numeric frontmatter property counting open manual test-plan items. Shown as a \"✓ N\" badge on cards — green at 0 (manual review complete). Empty = off."
			)
			.addText((t) =>
				t
					.setPlaceholder("open_tests")
					.setValue(this.plugin.shared.board.testsProperty)
					.onChange(async (v) => {
						this.plugin.shared.board.testsProperty = v.trim();
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Discussion property")
			.setDesc(
				"Frontmatter property holding a discussion URL (e.g. a Slack thread). Cards show a chat icon that opens the link. Empty = off."
			)
			.addText((t) =>
				t
					.setPlaceholder("discussion")
					.setValue(this.plugin.shared.board.discussionProperty)
					.onChange(async (v) => {
						this.plugin.shared.board.discussionProperty = v.trim();
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Required properties")
			.setDesc(
				"Comma-separated properties every card note must carry. Missing values, unrendered template stubs, and unknown statuses appear in the board's ⚠ problems panel."
			)
			.addText((t) =>
				t
					.setPlaceholder("id, status, updated")
					.setValue(this.plugin.shared.board.requiredProperties.join(", "))
					.onChange(async (v) => {
						this.plugin.shared.board.requiredProperties = v
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveShared();
					})
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Milestones").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"The Release Plan tab groups cards by target version, keyed by major.minor (v1.2.0 and 1.2.1 share the column 1.2). " +
				"Column progress = Σ(size × status progress) / Σ(size), using the progress values configured on the columns above.",
		});

		new Setting(containerEl)
			.setName("Version property")
			.setDesc("Frontmatter property that holds the target version.")
			.addText((t) =>
				t.setValue(this.plugin.shared.milestones.versionProperty).onChange(async (v) => {
					this.plugin.shared.milestones.versionProperty = v.trim() || "version";
					await this.plugin.saveShared();
				})
			);

		new Setting(containerEl)
			.setName("Planned versions")
			.setDesc(
				"One per line, in the exact form drops should write (e.g. v1.2.0). These columns are always shown, even when empty; versions found in notes appear automatically."
			)
			.addTextArea((ta) =>
				ta
					.setPlaceholder("v1.1.0\nv1.2.0")
					.setValue(this.plugin.shared.milestones.plannedVersions.join("\n"))
					.onChange(async (v) => {
						this.plugin.shared.milestones.plannedVersions = splitLines(v);
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Size property")
			.setDesc(
				"Numeric frontmatter property used as the ticket's weight in the progress metric. Missing or invalid values count as 1."
			)
			.addText((t) =>
				t.setValue(this.plugin.shared.milestones.sizeProperty).onChange(async (v) => {
					this.plugin.shared.milestones.sizeProperty = v.trim();
					await this.plugin.saveShared();
				})
			);

		new Setting(containerEl)
			.setName("Release notes folder")
			.setDesc(
				"Vault folder with release notes carrying version and date frontmatter. A version column whose initial (x.y.0) note exists shows the linked release date; estimates only appear for unreleased versions."
			)
			.addText((t) =>
				t
					.setPlaceholder("06_Delivery-and-QA/Releases")
					.setValue(this.plugin.shared.milestones.releaseNotesFolder)
					.onChange(async (v) => {
						this.plugin.shared.milestones.releaseNotesFolder = v
							.trim()
							.replace(/^\/+|\/+$/g, "");
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Completed property")
			.setDesc(
				"Frontmatter property holding a completion date (e.g. deployed, stamped by an automation rule). Powers the velocity-based forecast in the milestone headers. Empty = forecast off."
			)
			.addText((t) =>
				t
					.setPlaceholder("deployed")
					.setValue(this.plugin.shared.milestones.completedProperty)
					.onChange(async (v) => {
						this.plugin.shared.milestones.completedProperty = v.trim();
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Velocity window (days)")
			.setDesc("Look-back window for the completion velocity behind the forecast.")
			.addText((t) =>
				t
					.setValue(String(this.plugin.shared.milestones.velocityWindowDays))
					.onChange(async (v) => {
						const n = Number(v.trim());
						this.plugin.shared.milestones.velocityWindowDays =
							Number.isFinite(n) && n > 0 ? Math.floor(n) : 28;
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Version tags")
			.setDesc(
				"One per line: major.minor = tag (e.g. 1.1 = MVP). Also editable by clicking the tag in a column header."
			)
			.addTextArea((ta) =>
				ta
					.setPlaceholder("1.1 = MVP\n1.2 = Closed Beta")
					.setValue(
						Object.entries(this.plugin.shared.milestones.tags)
							.map(([k, v]) => `${k} = ${v}`)
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.shared.milestones.tags = parseKeyValueLines(v);
						await this.plugin.saveShared();
					})
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Meetings").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"The Meetings tab shows the notes of a folder (root only) in month columns — past and upcoming — with an open-action-items badge per meeting and per-person totals. " +
				"Unchecked '- [ ]' items count; a bold-only line (**Kai**) sets the owner for following items, '- [ ] **Kai:** …' overrides, no owner = unassigned.",
		});

		new Setting(containerEl)
			.setName("Meetings folder")
			.setDesc("Vault folder with meeting notes. Empty = tab hidden.")
			.addText((t) =>
				t
					.setPlaceholder("08_Meetings-and-Workshop-Notes")
					.setValue(this.plugin.shared.meetings.folder)
					.onChange(async (v) => {
						this.plugin.shared.meetings.folder = v.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Meeting properties")
			.setDesc("Date | participants | open-actions frontmatter property names.")
			.addText((t) =>
				t
					.setValue(
						[
							this.plugin.shared.meetings.dateProperty,
							this.plugin.shared.meetings.participantsProperty,
							this.plugin.shared.meetings.actionsProperty,
						].join(" | ")
					)
					.onChange(async (v) => {
						const parts = v.split("|").map((s) => s.trim());
						this.plugin.shared.meetings.dateProperty = parts[0] || "meeting_date";
						this.plugin.shared.meetings.participantsProperty = parts[1] || "participants";
						this.plugin.shared.meetings.actionsProperty = parts[2] || "open_actions";
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Meeting chip templates")
			.setDesc(
				"Chips offered on meeting cards (right-click + file menu). One per line: label | tool | repo | prompt — same variables as ticket chips."
			)
			.addTextArea((ta) => {
				ta.inputEl.rows = 3;
				ta.setPlaceholder("Read transcript | claude | my-project | /meeting report {{title}}")
					.setValue(
						this.plugin.shared.meetings.templates
							.map((t) => `${t.label} | ${t.tool ?? ""} | ${t.repo ?? ""} | ${t.prompt}`)
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.shared.meetings.templates = splitLines(v)
							.map((line) => {
								const parts = line.split("|");
								if (parts.length < 4) return null;
								const label = parts[0].trim();
								const tool = parts[1].trim();
								const repo = parts[2].trim();
								const prompt = parts.slice(3).join("|").trim();
								if (!label || !prompt) return null;
								return { label, tool: tool || undefined, repo: repo || undefined, prompt };
							})
							.filter((t): t is NonNullable<typeof t> => t !== null);
						await this.plugin.saveShared();
					});
			});

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Automations").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				'Rules evaluated when a card enters a column, as a JSON array. Rule shape: {"when": ["Deployed"], "set": {"deployed": "{{date}}"}, "repo": "my-project", "command": "node scripts/move-ticket.mjs {{file}} {{from}} {{to}}"}. ' +
				"Empty \"when\" = every status change. \"set\" writes frontmatter atomically with the status ({{date}}, {{datetime}}, {{from}}, {{to}}). " +
				"Commands run in the repo alias and only on devices that enable automations under “This device”.",
		});

		let automationError: HTMLElement | null = null;
		new Setting(containerEl)
			.setName("Rules")
			.addTextArea((ta) => {
				ta.inputEl.rows = 8;
				ta.setValue(JSON.stringify(this.plugin.shared.board.automations, null, 2)).onChange(
					async (v) => {
						try {
							const parsed: unknown = v.trim() === "" ? [] : JSON.parse(v);
							if (!Array.isArray(parsed)) throw new Error("must be a JSON array");
							this.plugin.shared.board.automations = parsed.map((r) => ({
								when: Array.isArray((r as { when?: unknown }).when)
									? ((r as { when: unknown[] }).when.map(String))
									: [],
								set:
									typeof (r as { set?: unknown }).set === "object" &&
									(r as { set?: unknown }).set !== null
										? Object.fromEntries(
												Object.entries(
													(r as { set: Record<string, unknown> }).set
												).map(([k, val]) => [k, String(val)])
											)
										: {},
								command: String((r as { command?: unknown }).command ?? ""),
								repo: String((r as { repo?: unknown }).repo ?? ""),
							}));
							automationError?.setText("");
							await this.plugin.saveShared();
						} catch (e) {
							automationError?.setText(
								`Not saved — ${e instanceof Error ? e.message : String(e)}`
							);
						}
					}
				);
			});
		automationError = containerEl.createEl("p", { cls: "dispatch-settings-error", text: "" });

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Todos").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"The Todos tab collects unchecked '- [ ]' items from allowlisted sections across the folders below into one column per person. " +
				"Clicking an item opens its note at the exact line — ticking happens in the document, the board follows.",
		});

		new Setting(containerEl)
			.setName("Todo folders")
			.setDesc("Vault folders (root only) scanned for todo items, one per line. Empty = tab hidden.")
			.addTextArea((ta) =>
				ta
					.setPlaceholder("08_Meetings-and-Workshop-Notes\n02_Requirements/User-Stories")
					.setValue(this.plugin.shared.todos.folders.join("\n"))
					.onChange(async (v) => {
						this.plugin.shared.todos.folders = splitLines(v);
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Todo sections")
			.setDesc(
				"Section headings whose unchecked items count as todos (case-insensitive prefix match), one per line — keeps acceptance criteria and test plans off the board unless allowlisted."
			)
			.addTextArea((ta) =>
				ta
					.setPlaceholder("Action items\nOpen action items")
					.setValue(this.plugin.shared.todos.sections.join("\n"))
					.onChange(async (v) => {
						this.plugin.shared.todos.sections = splitLines(v);
						await this.plugin.saveShared();
					})
			);

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Chips").setHeading();

		new Setting(containerEl)
			.setName("Default tool")
			.setDesc("Tool used when a chip block does not specify one.")
			.addText((t) =>
				t.setValue(this.plugin.shared.chips.defaultTool).onChange(async (v) => {
					this.plugin.shared.chips.defaultTool = v.trim();
					await this.plugin.saveShared();
				})
			);

		new Setting(containerEl)
			.setName("Column chips")
			.setDesc(
				"Batch chips offered when clicking a Kanban column header — one agent session over all tickets in the column. Same line format as chip templates; prompt variables: {{ids}} (space-separated ticket IDs in board order), {{status}}, {{count}}."
			)
			.addTextArea((ta) => {
				ta.inputEl.rows = 4;
				ta.setPlaceholder(
					"Update all | claude | my-project | Process these tickets sequentially with /update-ticket: {{ids}}"
				)
					.setValue(
						this.plugin.shared.chips.columnTemplates
							.map((t) => `${t.label} | ${t.tool ?? ""} | ${t.repo ?? ""} | ${t.prompt}`)
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.shared.chips.columnTemplates = splitLines(v)
							.map((line) => {
								const parts = line.split("|");
								if (parts.length < 4) return null;
								const label = parts[0].trim();
								const tool = parts[1].trim();
								const repo = parts[2].trim();
								const prompt = parts.slice(3).join("|").trim();
								if (!label || !prompt) return null;
								return {
									label,
									tool: tool || undefined,
									repo: repo || undefined,
									prompt,
								};
							})
							.filter((t): t is NonNullable<typeof t> => t !== null);
						await this.plugin.saveShared();
					});
			});

		new Setting(containerEl)
			.setName("Chip templates")
			.setDesc(
				"Virtual chips shown for every card note (board right-click + file menu) — no markdown block needed. One per line: label | tool | repo | prompt. Empty tool/repo = defaults. Prompt variables: {{id}}, {{status}}, {{file}}, {{title}}."
			)
			.addTextArea((ta) => {
				ta.inputEl.rows = 5;
				ta.setPlaceholder("Refine | claude | my-project | /refine {{id}}")
					.setValue(
						this.plugin.shared.chips.templates
							.map((t) => `${t.label} | ${t.tool ?? ""} | ${t.repo ?? ""} | ${t.prompt}`)
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.shared.chips.templates = splitLines(v)
							.map((line) => {
								const parts = line.split("|");
								if (parts.length < 4) return null;
								const label = parts[0].trim();
								const tool = parts[1].trim();
								const repo = parts[2].trim();
								const prompt = parts.slice(3).join("|").trim();
								if (!label || !prompt) return null;
								return {
									label,
									tool: tool || undefined,
									repo: repo || undefined,
									prompt,
								};
							})
							.filter((t): t is NonNullable<typeof t> => t !== null);
						await this.plugin.saveShared();
					});
			});

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("This device").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				`Machine-specific settings, stored outside the vault at ${this.plugin.localSettingsPath()} — ` +
				"vault sync (Google Drive, Obsidian Sync, git) never sees them, and every team member keeps their own paths.",
		});

		new Setting(containerEl)
			.setName("Repositories")
			.setDesc("One per line: alias = absolute path on this machine.")
			.addTextArea((ta) =>
				ta
					.setPlaceholder("my-project = C:\\Users\\me\\Workspace\\my-project")
					.setValue(
						Object.entries(this.plugin.local.repos)
							.map(([k, v]) => `${k} = ${v}`)
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.local.repos = parseKeyValueLines(v);
						await this.plugin.saveLocal();
					})
			);

		new Setting(containerEl)
			.setName("Tools")
			.setDesc(
				"One per line: name = command template. Variables: {{cwd}}, {{prompt}}, {{promptFile}} — quoted; append Raw for the unquoted value (no promptRaw)."
			)
			.addTextArea((ta) =>
				ta
					.setPlaceholder('claude = start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}')
					.setValue(
						Object.entries(this.plugin.local.tools)
							.map(([k, v]) => `${k} = ${v.command}`)
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.local.tools = Object.fromEntries(
							Object.entries(parseKeyValueLines(v)).map(([name, command]) => [
								name,
								{ command },
							])
						);
						await this.plugin.saveLocal();
					})
			);

		new Setting(containerEl)
			.setName("Enable automation commands on this device")
			.setDesc("Off by default — shared automation commands only run where this is enabled (frontmatter 'set' assignments always apply).")
			.addToggle((t) =>
				t.setValue(this.plugin.local.enableHooks).onChange(async (v) => {
					this.plugin.local.enableHooks = v;
					await this.plugin.saveLocal();
				})
			);

		new Setting(containerEl)
			.setName("Confirm before running a chip")
			.setDesc("Show the exact command in a dialog before launching a tool.")
			.addToggle((t) =>
				t.setValue(this.plugin.local.confirmBeforeRun).onChange(async (v) => {
					this.plugin.local.confirmBeforeRun = v;
					await this.plugin.saveLocal();
				})
			);
	}
}

function splitLines(v: string): string[] {
	return v
		.split("\n")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function parseKeyValueLines(v: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of splitLines(v)) {
		const idx = line.indexOf("=");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key && value) out[key] = value;
	}
	return out;
}
