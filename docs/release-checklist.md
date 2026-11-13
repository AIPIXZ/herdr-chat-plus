# Herdr Chat Plus release checklist

## Prepared

- [x] Preserve naruse's MIT license and the Catppuccin palette notice.
- [x] Product name, development version, seven-mod manifest and shared-module sources are explicit.
- [x] Retain the `chat` runtime namespace for existing customized installations; document the upstream naming conflict.
- [x] Exclude generated native API snapshots and local development artifacts.
- [x] Provide structure/syntax/unit checks, optional native checks, and Linux/macOS CI.
- [x] Keep historical screenshots in an archive and use current dark/light screenshots in README.
- [x] Test fresh-install refusal, backed-up file updates, shortcut preservation and read-only diagnosis in temporary app homes.

## Before the first release tag

- [x] Add user-selected dark/light screenshots to README and a root `preview.png` for Gallery indexing.
- [x] Publish `AIPIXZ/herdr-chat-plus` and enable Gallery discovery with the `herdr-layout` topic.

- [x] Create the private `XD-Open-Jarvis/herdr-chat-plus` repository and push the prepared history to `main`, preserving the old fork remote.
- [x] Point public installation and repository links to AIPIXZ.
- [ ] Check CI on the AIPIXZ repository. Local checks do not prove hosted workflows have run.
- [ ] Manually verify a fresh app home and another Mac: Chat/TUI switching, per-tab state, remote aliases/offline behavior, Codex fork/resume/new, Claude handoff, queues/retry, prompts and usage errors.
- [ ] Manually verify file links, sidebar mode switching, hover preview scrolling, drag resizing, sticky/pushing diff headers, and image zoom/pan in light and dark themes.
- [ ] Capture a current UI screenshot using a disposable conversation without private content. The schematic is not evidence of this validation.
- [ ] Record actual Herdr App/Core and agent versions tested. Choose a stable version only after validation, update the changelog, then tag it.

## Publication procedure

The prepared working branch is `release/herdr-chat-plus`. Use the `aipixz` remote for the public organization repository and push this branch as `main`. Keep the earlier `origin` and private `plus` remotes intact. Do not create a stable tag or mark the native/second-Mac checklist complete merely because unit tests pass.

## Later work

- Add other agent adapters only after establishing identity, transcript events, input and permission handling; an ACP session is not automatically an attachment to an existing TUI.
- Track native terminal rendering separately from layout performance.
- Plan any future `chat-plus` runtime namespace as an explicit compatibility change. Do not mix it into a file-only update or silently migrate old sessions.
