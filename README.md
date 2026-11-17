# Herdr Chat Plus

A native [Herdr](https://herdr.dev) layout for existing Claude Code and Codex terminals. **Chat / TUI** switches how you see the same running terminal. Chat does not create another shared terminal pane; TUI keeps Herdr's normal splits.

Based on [naruse/herdr-chat](https://github.com/naruse/herdr-chat). The original MIT license and author attribution are retained. Herdr Chat Plus is an independent layout project, not an official Herdr distribution.

![Herdr Chat Plus in dark theme](screenshots/chat-dark.png)

![Herdr Chat Plus in light theme](screenshots/chat-light.png)

## Features

- **Chat and TUI, one agent.** Switch views of the same Claude Code or Codex terminal, including agents on remote machines.
- **Files and changes beside the conversation.** Preview Markdown, source files and recorded diffs in a sidebar; hover a changed file for a quick diff preview.
- **Follow-ups without interrupting.** Queue messages while the agent works, send a selected message instantly, and retry failed deliveries.
- **A comfortable native chat UI.** Rich Markdown, attachments, image preview with zoom and copy, and matching Catppuccin light and dark themes.

### Multiple routes to one machine

In **Settings → Machines**, save multiple SSH addresses or aliases for the same machine. Add a route, switch with **Use**, or remove an unused route; the current route is highlighted. This lets you choose the appropriate connection for your network without adding the same machine again.

![Machine settings with multiple SSH routes and the current route highlighted](screenshots/machine-routes.png)

## Install and update

Requirements: Herdr App, Python 3.9+, and Claude Code or Codex on the machine running the agent. Development checks currently use **Herdr App 0.1.15 on macOS**. This is a development snapshot, not a validated cross-platform release.

Project repository: [AIPIXZ/herdr-chat-plus](https://github.com/AIPIXZ/herdr-chat-plus).

```sh
git clone https://github.com/AIPIXZ/herdr-chat-plus.git
cd herdr-chat-plus
python3 scripts/install.py --install
```

For a checkout already on this machine:

```sh
python3 scripts/deploy-mods.py --check  # detect stale/overwritten installed code
python3 scripts/deploy-mods.py --apply  # backed-up mod-only update; preserve the current layout
python3 scripts/install.py --diagnose  # read-only file/routing checks
python3 scripts/install.py --update   # back up and replace the layout/mod files
```

Use only this Herdr Chat Plus checkout for updates. The old `herdr-chat/customized` tree shares mod names and can overwrite fixes if copied over this installation.

Read `~/.config/herdr-app/AGENTS.md` before installing. `--install` refuses existing Chat names. `--update` backs up replaced files, preserves a conflicting New Chat shortcut, and selects the Chat layout. `--home PATH` or `HERDR_APP_HOME` chooses another app home. Without a mode, the installer only prints a dry run.

The seven mods and the runtime layout still use their established names: `chat`, `chat-file`, `chat-preview`, `chat-pane`, `chat-tabs`, `spaces-chat`, and `agents-chat`. This is intentional for existing customized installations. **The package shares the `chat` namespace with the original layout; they cannot be installed side by side under those names.** No session migration or core-document reset is part of the installer. Another Mac must separately configure its connection to the terminal's machine.

## Development

Node.js 22+ and Python 3.9+ are needed for local checks. There are no npm dependencies.

```sh
python3 scripts/check.py           # structure, syntax, shared copies, JS/Python tests
python3 scripts/check.py --native  # also check all seven mods in the installed Herdr runtime
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for module ownership and shared-code rules, [RECIPE.md](RECIPE.md) for the layout contract, and the [release checklist](docs/release-checklist.md) for remaining manual validation. The version and mod manifest live in [package.json](package.json); `private: true` prevents accidental npm publication; the GitHub repository is public.

## Limits

- Transcript adapters currently support Claude Code and Codex. Other agents, including Grok, need an adapter.
- Existing Codex terminals may require `/status` to establish identity. Chat does not choose the newest log as a substitute for identity.
- Queue state is local to this Chat client. Automatic delivery requires Herdr running; other clients have separate queues.
- File previews are read-only and refresh on request. Diff is the historical patch recorded in the transcript; File is current disk content. Source previews stop at 400,000 characters; binary image previews are limited to 5 MiB and can be opened in the zoom window. Line references are displayed in the path but do not yet move the code editor cursor.
- Native terminal drawing, scrollback and multi-client TUI behavior belong to Herdr App/Core; this layout cannot replace their renderer.

## Attribution

Original Herdr Chat by naruse, under [MIT](LICENSE). Catppuccin palettes retain their [MIT notice](docs/CATPPUCCIN-LICENSE). Earlier screenshots and documentation are preserved in the [historical README archive](docs/upstream-original.md), rather than presented as the current UI. Changes in this development version are listed in [CHANGELOG.md](CHANGELOG.md).
