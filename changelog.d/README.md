# Changelog fragments

Each change adds one file here instead of editing changelog.md, so pull requests never conflict on it.

- Name it after the branch: `changelog.d/<branch-name>.md` (slashes become dashes).
- Write the entry as one or more `- ` lines, the same style as changelog.md.
- At release, `node scripts/changelog/assemble.ts` moves every fragment to the top of changelog.md, oldest first, and deletes the fragments.
