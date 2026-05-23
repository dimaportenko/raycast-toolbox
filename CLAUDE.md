# CLAUDE.md

Public GitHub repo. Never commit secrets, tokens, `.env*` files, or personal absolute paths (`/Users/<name>/...`). Runtime secrets go in Raycast `preferences` (`type: "password"`), read via `getPreferenceValues`.

Package manager: **pnpm** (pinned). Each entry in `package.json.commands[]` maps to `src/<name>.tsx`; supporting code lives in `src/lib/<name>/`.

When reading a library's source/docs, clone the repo into a temp dir (`git clone <url> /tmp/<name>`) and record the remote URL + local path in [`docs/references.md`](docs/references.md). Reuse existing checkouts.
