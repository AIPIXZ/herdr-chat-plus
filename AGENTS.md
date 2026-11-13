# Herdr Chat Plus development

This is the canonical product checkout. Its repository is
`AIPIXZ/herdr-chat-plus`, remote `aipixz`, branch `main` on GitHub.
The existing `plus` remote points to the earlier private backup repository.
The older sibling checkout `herdr-chat` / `customized` is historical and must
not be used to deploy over this package. It shares runtime mod names, so doing
so silently replaces Plus fixes while leaving orphaned helper files behind.

Before editing, read `CONTRIBUTING.md` and the installed
`~/.config/herdr-app/AGENTS.md` for the actual native API. Do not edit that
app-generated instructions file or its generated type declarations.

For existing installations, use:

```
python3 scripts/deploy-mods.py --check
python3 scripts/deploy-mods.py --apply
```

The first command is read-only. The second checks all native mods, backs up
changed files, deploys dependencies before entrypoints, verifies file hashes,
and records its source under the app home's `data/` directory. It does not
replace the user's layout, keys, tabs, drafts, shared state or core documents.
Use `install.py --install` only for a fresh installation, or `--update` when
intentionally replacing the package's full layout as well.

If a fixed behavior returns, compare installed files to this checkout before
changing rendering or parsers again. Investigate an independent deployment
rather than blindly overwriting another working checkout. Preserve legitimate
newer fixes before restoring a consistent package.

Canonical shared modules and their copies live in package.json. Run
`scripts/sync-shared.py` after changes, then `scripts/check.py --native`.
Native checks and unit tests do not establish real pointer/scroll behavior.
Never send test input into a person's working agent terminal.
