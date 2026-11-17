# Contributing to Carbon Commander

Thanks for your interest. Bug fixes, new toolsets, documentation and ideas are all welcome.

Much of this project was written in pair programming with AI assistants. You are welcome to use
them too; just review and understand what you submit, and test it.

## Getting started

```bash
npm ci
npx playwright install chromium   # once, for the end-to-end test
npm run watch                     # rebuilds dist/ on change; load dist/ unpacked in Chrome
```

Before opening a pull request, run:

```bash
npm run check        # typecheck + lint + unit tests + build
npm run test:e2e     # end-to-end tests in Playwright's Chromium (e2e + production builds)
```

## Layout

```
src/
  shared/       contracts used everywhere: types, wire protocol, defaults, logger
  background/   service worker entry (index.ts), sessions, settings, secrets, bar trust
  llm/          OpenAI-compatible client, providers, tool schema conversion
  agent/        the agent loop (pure: no chrome.* inside)
  mcp/          Streamable HTTP MCP client and server manager
  tools/        tool registry, page executor and toolsets (generic/, sites/, builtin/)
  content/      the content script that hosts the overlay
  ui/           the bar page: chat, settings, state reducer, markdown rendering
  icons/        extension icons (drawn by scripts/icons.mjs)
tests/          Vitest unit tests mirroring src/, helpers/, and e2e/ (Playwright)
docs/           ARCHITECTURE.md
scripts/        build, package, version and icon scripts
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the parts talk to each other and the
security model. Wire messages are typed in `src/shared/protocol.ts`; change them additively and
keep the worker's validation in step.

## Adding a toolset

Read [src/tools/README.md](src/tools/README.md). In short: one file under `src/tools/sites/`, tools
defined with `defineBackgroundTool` / `definePageTool`, `mutates: true` on anything that changes
state, `matches(url)` so the toolset appears only on its site, a stable public API rather than CSS
selectors, and a unit test with a fake `fetch`.

## Guidelines

- TypeScript strict mode, 2-space indentation, `npm run lint` clean.
- Never write untrusted strings into the DOM as HTML. The UI builds elements with `h()` and
  `textContent`; model markdown goes through `setSanitizedHtml()` (DOMPurify). ESLint enforces this.
- Model ids are hard-coded only in `src/shared/defaults.ts`.
- `chrome.*` listeners in the service worker are registered synchronously at top level, and nothing
  may throw while the worker loads.
- Test logic (parsers, loop, storage, registry, protocol) with unit tests; user flows belong in the
  end-to-end test.
- This repository is public: no private hostnames, addresses, tokens or personal details in code,
  tests or docs.

## Bug reports and feature requests

Open an issue with what you tried, what happened, the provider/model you used, and any errors from
the extension (chrome://extensions → Carbon Commander → "service worker" for the worker console;
right-click inside the bar → Inspect for the bar).

## License

By contributing you agree that your contributions are licensed under the MIT License
([LICENSE.txt](LICENSE.txt)).
