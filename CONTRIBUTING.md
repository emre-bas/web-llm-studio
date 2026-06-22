# Contributing to Web LLM Studio

Thanks for your interest in improving Web LLM Studio! This is a fully
browser-based, backend-free LLM playground. Contributions are welcome — please
keep changes aligned with that core principle: **everything runs locally in the
user's browser; there is no server.**

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

Requires **Node.js 22** and npm.

```bash
npm install      # install dependencies
npm run dev      # start the dev server
```

## Before you open a pull request

Run these three and make sure they all pass — CI runs the same checks and will
block the PR otherwise:

```bash
npm run lint
npm test
npm run build
```

## Branch & PR workflow

- Branch off `main` with a short-lived branch: `feat/…` or `fix/…`.
- Open a pull request against `main`. Non-trivial work is squash-merged.
- Keep PRs focused — one logical change per PR is easier to review.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Use the
imperative mood, lowercase, no trailing period. Allowed types:

```
feat  fix  docs  chore  refactor  test  ci  build  perf  style
```

Example: `feat(chat): add stop sequences to generation settings`

(This isn't enforced by a hook — just follow it; it keeps history clean and lets
us auto-generate changelog notes later.)

## Tests

Tests run with [Vitest](https://vitest.dev/) in a **Node environment (no jsdom)**.
That means tests cover **pure logic** and **static rendering** (e.g. rendering a
component to a string via `react-dom/server`) — not DOM/browser behavior. When
refactoring, keep changes behavior-preserving and add tests for the logic you
touch.

## Releases & versioning

Releases are handled by the maintainer. **Don't edit the version in
`package.json` in a PR** — version bumps are made with `npm version` at release
time, and the live site deploys only when a GitHub Release is published.

## Reporting bugs & requesting features

Open a GitHub issue. For bugs, include steps to reproduce, what you expected, and
your browser + OS (WebGPU support varies a lot between browsers).
