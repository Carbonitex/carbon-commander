# Built-in tools

All built-in tools share one format (`ToolDefinition` in `src/shared/types.ts`) and one registry
(`registry.ts`), which is the `builtin` `ToolSource`. It filters tools by `matches(url)`, checks
the model's arguments against each tool's JSON schema, runs the tool, turns thrown errors into
`{ ok: false }` results and caps the result size.

- `generic/`: site-agnostic tools that let the model read and use any page (read_page, find_elements, click, ...).
- `sites/`: small toolsets for one site each, built on that site's public API.
- `builtin/`: tools about the assistant's environment (get_current_time).

## Adding a toolset

1. Create `sites/<site>.ts` with a factory taking the deps it needs (`Pick<ToolDeps, 'fetch'>`),
   so tests can pass a fake `fetch`.
2. Define each tool with `defineBackgroundTool` (runs in the service worker and gets
   `ctx.tab`, `ctx.signal`) or `definePageTool` (injected into the tab). Names must match
   `^[a-zA-Z0-9_-]{1,64}$` and be unique; prefix them with the site (`hn_`, `github_`).
   `parameters` is a JSON schema with `type: "object"`; every property needs a `type`, arrays
   need `items`. Bad definitions throw when the module loads, and the tests catch that.
3. Set `mutates: true` on anything that changes state the user cares about (posting, submitting,
   navigating). Set `egress: true` on a tool that sends a request to a host the model chooses
   (like `fetch_url`; the destination is read from its `url` argument). Use `confirmWhenArgs` for
   a tool that only needs approval with certain arguments (`list_tabs` with `all_windows`). The
   user is asked to confirm those calls (unless confirmations are switched off).
4. Wrap the tools with `defineToolset({ id, matches, tools })` so they only appear on that site,
   then add the factory to `sites/index.ts`.
5. Return text the model can act on. Return `{ ok: false, content }` for expected failures and
   throw only for real errors (the registry reports them). Call your site's API with
   `getJson` / `getText` from `sites/http.ts` (no cookies, no redirects, size-capped) and pass
   `ctx.signal`. Only call fixed API hosts: a site toolset is not confirmed, so it must not let the
   model pick where a request goes.
6. Add a test under `tests/tools/` that uses a fake `fetch` (see `browser.test.ts`).

Prefer a stable public API called from the background over CSS selectors, which break when a site
is redesigned. If the generic tools already handle a site well, don't add a toolset for it.

## Page tools: rules for `run`

`chrome.scripting.executeScript` serialises `run` with `toString()`, so:

- Write `run: function (args) { ... }` or an arrow function. Method shorthand (`run(args) {}`) is rejected.
- Declare every helper and constant inside `run`; nothing outside it is available in the page.
  Shared helpers are repeated in each tool on purpose.
- Arguments and results must survive JSON. Catch errors inside `run` and return `{ ok: false }`.
- Use the default ISOLATED world (`context: 'page'`). Use `page-main` only when you need the
  page's own JS objects, and treat everything there as untrusted.
- Don't enable esbuild `keepNames`. It adds `__name(...)` calls that are undefined in the page.
  `tests/tools/injection.test.ts` rebuilds the tools minified and runs each `run` from its
  source text alone, so this mistake fails the tests.
- Element refs from `find_elements` live in the isolated world (`Symbol.for('carbon-commander.element-refs')`).
