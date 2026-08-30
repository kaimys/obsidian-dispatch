![Dispatch](docs/assets/Dispatch-Logo-OCR.png)

*"Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase."*\
— Andrej Karpathy, [LLM-Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

**Dispatch is a board for Obsidian that gives a small agent-native team a working
process: skills that run through the wiki and the team chat, and a chip on every card
that sends an agent at the work.**

![Dispatch Boards](docs/assets/animation.gif)

Your coding agents ship faster than you can decide. **You are now the bottleneck** — what remains of the development cycle is deciding *what* to build, agreeing on it as a team, and reviewing what comes back. Dispatch turns an agent-friendly wiki (à la [Karpathy's LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)) into the cockpit for that human side: tickets are plain notes, boards are live views over their frontmatter, and every card can dispatch a coding agent — Claude Code, Codex, any CLI — into the right repository.

- **Refinement is the new development.** The agent posts a ticket's open questions into your team chat (Slack via MCP), the team answers where it already talks, and the answers flow back into the spec. Every card shows its refinement state as a `? N` badge that burns down to green — green means build-ready.
- **Release planning is drag & drop.** The Release Plan view groups tickets by target version: live weighted progress per release, velocity-based forecasts that accumulate across versions, linked release notes for everything shipped. Drag a card — the plan is up to date the moment you drop it.
- **Meetings run themselves around you.** The agenda is prepared from the board; after the call, a NoteTaker transcript (e.g. Google Gemini) becomes an interpreted report in your vault, decisions are folded into the affected tickets automatically, and the action items show up per person on the Meetings and Todos tabs.
- **Testing works like refinement.** Manual test plans cover only what the automated suites don't; a `✓ N` badge counts the open checks through review and turns green when a ticket is safe to ship.
- **Claude Skills and MCP are the glue.** Chips on the board are one-liners (`/refine US00042`); the workflow logic behind them lives as Claude skills in your code repository — versioned with the code, reviewed like code, shared through git — while MCP connects the agent to your team's Slack, your tracker and your NoteTaker. Wiki, team and codebase become one loop, and the agents run it with you.

Under the hood, two primitives: **boards** (kanban views driven by note properties — drag & drop writes frontmatter) and **chips** (buttons that launch coding agents with the ticket as context). Desktop only — chips and automations spawn local processes.

## Documentation

| Page | What's in it |
| --- | --- |
| [Overview](docs/overview.md) | The four boards — Kanban, Release Plan, Meetings, Todos — and how each one behaves |
| [Wiki structure](docs/wiki-structure.md) | The three layers, an example folder tree to adapt, and where the wiki lives relative to your code |
| [Page types](docs/page-types.md) | The frontmatter contract: every page, tickets (incl. the freeze rule), ADRs, releases, meetings |
| [Workflow skills](docs/skills.md) | The skill catalog to adapt — ticket loop, releases, meetings, recurring maintenance |
| [Installation & configuration](docs/installation.md) | Install, settings, chips and tool commands, run lifecycle, automations, security model |

New to the idea? Read [Overview](docs/overview.md), then [Wiki structure](docs/wiki-structure.md).

## Quick start

**1. Install.** Open *Settings → Community plugins → Browse*, search for **Dispatch**, install
and enable it — or go straight to the
[directory listing](https://community.obsidian.md/plugins/dispatch).

**2. Let an agent set it up.** An unconfigured board says so and offers a
**Set up with claude** button, which starts [Claude Code](https://claude.com/claude-code) in
your vault folder with the right prompt. It shows you the exact command before running
anything.

The skill behind that button lives in this repo's plugin marketplace:

```
/plugin marketplace add kaimys/obsidian-dispatch
/plugin install dispatch-setup
```

The prompt carries those two lines itself, so the button works before you have installed the
skill. The setup interviews you about your wiki, writes both configuration layers, scaffolds
ticket templates and workflow commands, and verifies the result.

Prefer to do it by hand? Every setting the skill writes is documented in
[Installation & configuration](docs/installation.md).

## License

[MIT](LICENSE)


## Conclusion

In the words of Andrej Karpathy:

"*... an internal wiki maintained by LLMs, fed by Slack threads, meeting transcripts, project documents, customer calls. Possibly with humans in the loop reviewing updates. The wiki stays current because the LLM does the maintenance that no one on the team wants to do.*"\
— Andrej Karpathy, [LLM-Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
