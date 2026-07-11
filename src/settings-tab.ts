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
			.setName("Columns")
			.setDesc(
				"One column per line: the status value, optionally followed by | and a display label."
			)
			.addTextArea((ta) =>
				ta
					.setPlaceholder("Backlog\nIn progress | Doing\nDone")
					.setValue(
						this.plugin.shared.board.columns
							.map((c) => (c.label ? `${c.value} | ${c.label}` : c.value))
							.join("\n")
					)
					.onChange(async (v) => {
						this.plugin.shared.board.columns = splitLines(v).map((line) => {
							const idx = line.indexOf("|");
							if (idx === -1) return { value: line.trim() };
							const value = line.slice(0, idx).trim();
							const label = line.slice(idx + 1).trim();
							return label ? { value, label } : { value };
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

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("Post-drop hook").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Optional command that runs after a card is dropped (e.g. to mirror the move into an external tracker). " +
				"Variables: {{file}}, {{from}}, {{to}}, {{cwd}} — quoted; append Raw for the unquoted value. " +
				"It runs in the repository alias below, and every device must opt in under “This device”.",
		});

		new Setting(containerEl)
			.setName("Hook repository alias")
			.setDesc("Alias resolved via this device's repository list.")
			.addText((t) =>
				t
					.setPlaceholder("my-project")
					.setValue(this.plugin.shared.board.postDropHook.repo)
					.onChange(async (v) => {
						this.plugin.shared.board.postDropHook.repo = v.trim();
						await this.plugin.saveShared();
					})
			);

		new Setting(containerEl)
			.setName("Hook command")
			.setDesc("Leave empty to disable the hook.")
			.addTextArea((ta) =>
				ta
					.setPlaceholder("node scripts/move-ticket.mjs {{file}} {{from}} {{to}}")
					.setValue(this.plugin.shared.board.postDropHook.command)
					.onChange(async (v) => {
						this.plugin.shared.board.postDropHook.command = v.trim();
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

		// ------------------------------------------------------------------
		new Setting(containerEl).setName("This device").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Machine-specific settings, stored in local.json next to the plugin. " +
				"Exclude that file from vault sync / git so every team member keeps their own paths.",
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
					.setPlaceholder("claude = wt.exe -d {{cwd}} cmd /k claude {{prompt}}")
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
			.setName("Enable post-drop hook on this device")
			.setDesc("Off by default — the shared hook command only runs where this is enabled.")
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
