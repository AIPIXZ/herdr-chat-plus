# Development

Read the installed `~/.config/herdr-app/AGENTS.md` for the current native API. Mods use JavaScript and gpui-kit/GPUI, not a browser DOM. Generated `gpui-kit.d.ts` and per-mod `jsconfig.json` describe the installed runtime and are deliberately ignored by Git. `herdr-app check mods/chat` regenerates them when needed.

## Module map

| Mod | Responsibility |
| --- | --- |
| `chat` | Transcript parsing, binding/discovery, live handoff, queue/composer, activity and change cards |
| `chat-preview` | Read-only file/Markdown previews and the turn's diff collection |
| `chat-file` | Image preview and explicitly invoked file-edit dialogs |
| `chat-pane` | Chat/TUI header and terminal-pane actions |
| `chat-tabs` | Tab navigation and restoring the selected presentation |
| `spaces-chat` | Spaces and separate New Space / New Chat actions |
| `agents-chat` | Agents list, status and space indicators |

The larger Chat mod already separates parsing (`parse.js`), session discovery (`session.js`, `binding.js`, `title.js`, `identity.js`), display projection (`activity.js`, `display.js`, `diff.js`), live state (`stream.js`, `poll.js`), and queue state (`outbox.js`, `timeline.js`). Keep fixes in their owning module. Avoid mixing release cleanup with behavioral rewrites of the live/session state machine.

## Shared modules

A mod cannot import code outside its own directory. Canonical shared modules live in `mods/chat`; their copies and destinations are listed in `package.json` under `herdr.sharedModules`.

After editing a canonical source:

```sh
python3 scripts/sync-shared.py
python3 scripts/check.py
```

Never patch one copied helper independently. Checks reject divergent copies and missing local imports.

## Verification

`python3 scripts/check.py` checks package files, imports, synchronized helpers, JavaScript syntax, and all JS/Python tests. It needs no Herdr window or running agent. CI runs these checks on Linux and macOS with Node 22 and 24; that does not establish native platform support.

`python3 scripts/check.py --native` additionally runs `herdr-app check` for every mod. Native checks do not exercise all deferred content, real pointer events, scrolling or remote I/O. Use a disposable preview and manually test the paths affected by a UI change. Do not send probe messages into another person's working terminal or replace their layout/state for a test.

The install tests use temporary app homes and mocked Herdr commands. `--install`, `--update`, and `--diagnose` must not write core documents, move terminals, clear bindings or migrate session history. Do not run the installer against a user's live app home merely to verify packaging.

Keep generated runtime files, personal data, logs, credentials and local test output out of commits. Use the release checklist before publishing a tag; passing unit tests alone is not a release validation claim.
