# Changelog

All notable changes to Carbon Commander will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-16

A rewrite. The UI, agent, tools and MCP support were rebuilt; settings carry over only partly
(see "Breaking changes").

### Breaking changes
- **Site-specific toolsets removed.** The per-site scrapers (Amazon, LinkedIn, Bitbucket, stock
  markets, Twitch, YouTube and others) are gone; generic page tools replace them. Hacker News and
  GitHub remain as small examples built on public APIs. The old code is in the git history.
- **MCP server configurations are not migrated.** 0.3 used its own REST format, which real MCP
  servers do not speak. Add your servers again in Settings → MCP (Streamable HTTP).
- **The old in-page keybind is not migrated.** The shortcut is now the extension command
  (Ctrl+K / Cmd+K, change it at `chrome://extensions/shortcuts`); an optional fallback shortcut can
  be set in Settings → General.
- OpenAI and Gemini direct providers are replaced by OpenRouter, Ollama and a custom
  OpenAI-compatible endpoint. The OpenRouter key, the system prompt and per-site prompts are kept.

### Added
- Agent loop in the service worker with one conversation per tab, persisted so it survives
  navigation, closing the bar and service worker restarts.
- Generic page tools (`read_page`, `find_elements`, `click`, `type_text`, `select_option`,
  `press_key`, `scroll`, `hover`, `get_page_info`, `get_selection`), browser tools (`screenshot`,
  `navigate`, history, `reload`, `wait`, tabs, `fetch_url`) and `get_current_time`.
- Confirmation prompts for tools that change things or send requests to a host the model picks
  (`fetch_url`, `list_tabs` across all windows): allow, always allow (this tool on this site, for
  the conversation), deny. The buttons arm after 500 ms, accept clicks only while Chrome reports
  them unobscured (clickjacking guard), and never take focus while you type.
- Real MCP support over Streamable HTTP (2026-07-28 stateless revision with `server/discover`,
  falling back to the `initialize`-based 2025 revisions), with bearer token or custom headers
  stored encrypted, a connection test, and per-server "trust read-only hints".
- MCP OAuth sign-in (MCP authorization, 2026-07-28 revision): protected resource and
  authorization server discovery, dynamic client registration (or a client ID you enter),
  authorization code + PKCE S256 in Chrome's sign-in window (`chrome.identity`, new `identity`
  permission), `resource` indicators, `state` and `iss` checks, encrypted token storage, automatic
  refresh (ahead of expiry and on 401), "sign in again" for servers that ask for more scopes, and
  sign out with token revocation. Before the window opens, the server's row shows the host it will
  open (called out when it is another site than the MCP server) and the scopes it will request
  (per the specification's scope selection order); you can uncheck scopes, and the choice is
  remembered per server. A sign-in host that changed after it was shown is refused. Changing a
  server's URL or client ID revokes its tokens; a registration the authorization server no longer
  knows is replaced on the next sign-in. Sign-in is only started by you, never by the agent.
- MCP server discovery: sites that advertise an MCP server (MCP server cards in the site's
  `/.well-known/ai-catalog.json`, else a `/.well-known/mcp/server-card.json` card, or OAuth
  protected resource metadata for an MCP endpoint) are
  listed under Settings → MCP → Discovered with Add, and the bar shows "MCP server available" on
  them. Setting: "Look for MCP servers on sites I visit" (on by default; never in incognito; no
  cookies; requests only to the site you are on; at most 10 new entries an hour). A site's name for
  its server is shown, but names the server (and its tools) only when it matches the server's host.
- MCP servers that negotiate protocol version 2024-11-05 over Streamable HTTP are accepted.
- Page tools (WebMCP): tools a page offers through `document.modelContext` are listed to the
  agent for that tab as `webmcp__<name>` ("Page: &lt;site&gt;"), with a "N page tools" chip in the bar.
  Chrome's native API is used when present (including declarative form tools); otherwise a small
  MAIN-world script provides the imperative API of the 2026-11-13 draft at `document_start`, plus
  a compatibility shim for pages written for the earlier drafts / Chrome's early preview
  (`navigator.modelContext`: `provideContext`, `clearContext`, `registerTool`, `unregisterTool`,
  `execute(args, client)`). Page data is validated, capped and cleaned; every call asks first
  (whatever the page's `readOnlyHint`); calls run only in the document the model saw the tool in,
  with a timeout, and Stop aborts them in the page. Setting: "Use tools offered by the page
  (WebMCP)" (on by default).
- Model choice per role (chat, vision, autocomplete) from the provider's model list. The vision
  model describes screenshots / MCP images for chat models that cannot take images. OpenRouter
  batch-only and media-only models are left out of the list; long lists show how many are hidden.
- A "thinking…" state for reasoning models; OpenRouter `reasoning_details` are sent back on
  tool-call turns.
- Extension icons.
- Settings for providers, models, prompts, MCP servers and enabling / disabling individual tools.
- Bar opens in its own tab on pages that cannot be scripted; it says so when its tab is closed.
- The bar stays usable over pages with an open modal `<dialog>` and on pages that replace
  `<body>`.
- TypeScript, esbuild, ESLint, Vitest unit tests and Playwright end-to-end tests (development and
  production builds) in CI.

### Changed
- The UI is an extension page in an iframe inside a closed shadow root instead of a script
  injected into the page.
- Streaming responses, Markdown rendering, stop with Esc.

### Removed
- The page-to-worker message relay and its HMAC handshake (no longer needed).
- The legacy XOR key migration (keys stored in 0.3's AES-GCM format are migrated to the new
  store on first use).

### Security
- The page cannot read the UI, the conversation or keys. The bar talks to its content script over
  a private `MessageChannel`; nothing is posted to the page's window, and an unexpected navigation
  of the bar iframe recreates it. Synthetic key events from the page are ignored.
- API keys and MCP auth are encrypted in IndexedDB with a non-extractable key (worker only);
  existing keys are migrated out of `chrome.storage.local`, which is closed to content scripts on
  Chrome 140+.
- `fetch_url` does not follow redirects and refuses wildcard / loopback DNS names; LLM and MCP
  requests do not follow redirects; provider URLs must be `https://` (plain `http://` only for the
  local machine); responses are size-capped; the page title / URL go to the model as labelled,
  capped untrusted data; `list_tabs` hides other tabs' query strings; `get_selection` never reads
  password fields.
- Model output is sanitised with DOMPurify before display; tool output is shown as text.
- `bar.html` is web-accessible only through a per-session URL, and the worker only serves a framed
  bar that proves it sits in the extension's own overlay.
- MCP tools ask for confirmation (while confirmations are on); server-provided read-only hints are
  trusted only when the user opts in per server.

## [0.3.0] - 2025-02-16

### Added
- Expanded external tool ecosystem with new site-specific tools:
  - Amazon (product info, search, price tracking)
  - LinkedIn (profile, job, and company insights)
  - Bitbucket (repository management)
  - Hacker News (content retrieval)
  - Stock Markets (simple stock market data)
  - Twitch (channel and stream details)
  - YouTube (video and channel details)
- Enhanced test infrastructure with modular test suites and comprehensive runners
- Improved autocomplete and command history with host-specific storage
- Host-specific system prompts configuration
- Settings dialog with encrypted key management
- Secure messaging system with signature verification
- Enhanced MCP service management with configuration UI

### Changed
- Restructured project architecture with clearer separation of concerns
- Enhanced settings management across the application

### Fixed
- Improved Ollama and OpenAI key configuration handling
- Enhanced error handling for OpenAI and Ollama connections
- Multiple build system improvements
- Error handling improvements for tool calls in OpenAI

### Security
- Implemented secure messaging with signature verification
- Added authentication token management
- Enhanced encrypted key storage mechanism
- Improved secure initialization process

## [0.2.0] - 2025-02-11

### Added
- [Untested] MCP (Model Context Protocol) integration with comprehensive setup guide
- [Untested] Customizable keyboard shortcuts with UI configuration options
- [Untested] Various service integrations
- Tool list UI
- Enhanced documentation for MCP setup and usage

### Changed
- Reorganized tool system architecture for better extensibility
- Enhanced command palette positioning and interaction
- Updated documentation to reflect new features and capabilities

## [0.1.0] - 2025-02-10
- Initial release of my Chrome extension
- Basic command palette functionality
- AI integration with OpenAI and Ollama
- Chrome extension packaging and distribution

[Unreleased]: https://github.com/carbonitex/carbon-commander/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/carbonitex/carbon-commander/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/carbonitex/carbon-commander/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/carbonitex/carbon-commander/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/carbonitex/carbon-commander/releases/tag/v0.1.0 