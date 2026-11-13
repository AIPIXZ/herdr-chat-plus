# Changelog

## Unreleased — Herdr Chat Plus 0.1.0 development snapshot

Based on the customized Herdr Chat branch through `b206ed5`.

- Chat/TUI presentation of the same terminal, with per-terminal mode memory and remote owner resolution.
- Conservative Codex session identification, fork history, and incremental loading of older transcript data.
- Claude/Codex live handoff and visible prompts/errors, attachments, image preview, compact activity and command output.
- Local follow-up queue, Instant, recoverable failed direct sends, and explicit retry after resuming the same session.
- Colored recorded diffs, turn-wide diff sidebar with pushing file headers, hover diff preview, and read-only file/Markdown views.
- Compact model/effort selector and 5h/7d remaining-quota rings with matching normal colors and clockwise depletion.
- Catppuccin themes, separate New Chat / New Space actions, and Agents status indicators.
- Image file links use binary loading and a fitted sidebar image preview, with the existing zoom window available on click.
- Consistent rounded Markdown tables across chat and the file sidebar; attachment removal stops image-preview clicks and removes by file identity.
- Repository cleanup: exclude generated API snapshots, centralize the mod/shared-file manifest, add checks and CI, and archive earlier screenshots.

No stable version tag has been published. Manual release validation remains listed in `docs/release-checklist.md`.
