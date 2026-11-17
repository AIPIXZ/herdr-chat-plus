# Herdr Chat Plus

A native chat workspace for existing Claude Code and Codex terminals: Chat/TUI switching, file and diff previews, queued follow-ups, and light/dark themes.

Chat is a personal layout presentation, not a core mod pane. The local
`conversation-view` stack switches between `main` (the real tab split tree)
and a personal presentation. Single-pane tabs use `conversation-page` (a
44 px chat-pane header plus the Chat body). Split tabs use a projection of the
core's row/column tree read through `doc.get`: each original terminal leaf has
its own Chat/TUI stack. Preserve nesting, sizes and non-agent siblings; never
replace a split tab with one full-size conversation. `pane_mode` props mark
these views. Scope focus/search commands to the clicked owner, and consider
only active leaf stacks when deciding whether a Chat copy is visible.

Use the identical `presentation.js` helpers in chat/chat-pane/chat-tabs to open
Chat. Save only terminal-local IDs in layout props: `terminal`, `owner_tab`,
`owner_pane` refer to the ORIGINAL TERMINAL pane, never a new Chat pane.
Resolve the exact owner among live terminal panes, then use its tab's current
client alias. Reject missing/ambiguous matches. Do not use the active machine
or global bare terminal matches to guess identity.

Opening Chat changes only the personal layout; it must never call pane.split,
pane.zoom, terminal.park, or core doc.set. Returning one pane to TUI keeps
other Chat panes visible. When the last Chat returns to TUI, select `main` and
focus the original terminal. If the shared pane membership changes while a
projection is visible, return to the native tree so no new pane is hidden.
Switching tabs/spaces restores the presentation remembered for the selected terminal. Chat has no split UI and consumes pane
structure keyboard shortcuts. Other layouts and mobile keep native terminals.
Old Chat panes and terminal labels are not automatically migrated or deleted.
The new-chat dialog starts one real terminal, then selects the local Chat view.

The installer only copies layout/mod files and merges a non-conflicting shortcut.
Use `--install` for a fresh installation, `--update` for file backups and updates,
and `--diagnose` to verify file/header/stack routing. Never migrate sessions.

User bubbles wrap actual content up to 70% of the conversation content width.
User text is 14 px; assistant text is 14.5 px. Image limits: messages/expanded tools 420x300, collapsed tools
312x215, attachments 144x108. Preserve image aspect ratios without upscaling.
Unwrap hc user transport envelopes and retain sender labels; filter internal
system envelopes. Hidden Chat copies skip expensive rendering, session discovery,
log polling and terminal scraping. Resume when the view becomes visible.

Keep the shared conversation header with workspace, terminal address, title,
status, search and Chat / TUI. Preserve native terminal split behavior in TUI.
Use neutral focus borders with a single visible pane; accent for multiple panes.
Do not resend pending layout.set updates on every redraw. Never let border
reconciliation overwrite a pending Chat selection. Preserve existing shortcuts;
new Chat uses Cmd+Shift+N / Ctrl+Shift+N.

Use folderPoll for local log waits: one pending watch across fallback timeouts;
cancel the losing timer. Promise.race alone does not cancel a pending watch.

Keep generated runtime declarations out of Git. The seven mods and shared-module
copies are listed in package.json. Canonical shared helpers live in mods/chat;
run scripts/sync-shared.py after edits, then scripts/check.py. File preview and
diff UI use the personal right sidebar, never terminal pane.split. A historical
diff and current disk content must remain clearly distinct.
