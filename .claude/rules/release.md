---
paths:
    - "manifest.json"
    - "versions.json"
    - "package.json"
    - "scripts/version-bump.mjs"
    - ".github/**"
    - "tests/repo/release-workflow.test.ts"
---

# Release

- The tag is exactly the version in the manifest, with no `v` in front. Since
  `1.0.0`, tags are annotated (docs/DECISIONS.md, D-039).
- `pnpm version` updates every file through `scripts/version-bump.mjs`.
- The workflow checks formatting, lint and coverage before it drafts the
  release. `tests/repo/release-workflow.test.ts` checks the workflow's steps.
