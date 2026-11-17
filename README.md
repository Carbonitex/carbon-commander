# Carbon Commander

A command bar for Chrome that talks to an AI agent. Press **Ctrl+K** (**Cmd+K** on macOS) on any
page, ask a question or describe a task, and the agent can read the page, click, type, navigate,
take screenshots, work with tabs, and call tools on MCP servers you connect or that the page itself
offers (WebMCP). Anything that changes something, or sends a request to a site the model picks,
asks for your confirmation first.

It works with [OpenRouter](https://openrouter.ai/) (one key, many models), a local
[Ollama](https://ollama.com/), or any OpenAI-compatible endpoint.

Version 0.4.0 is a rewrite; see [CHANGELOG.md](CHANGELOG.md) for what changed from 0.3.

## Install from source

Requirements: Node.js 22.13 or newer, Chrome (or another Chromium browser) 120 or newer.

```bash
git clone https://github.com/carbonitex/carbon-commander.git
cd carbon-commander
npm ci
npm run build        # development build into dist/  (npm run build:prod for a minified one)
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
the `dist/` folder. After pulling changes, rebuild and click the reload icon on the extension's
card.

`npm run package` writes `carboncommander-extension.zip` (production build) for distribution.

## Using it

- **Ctrl+K / Cmd+K** or the toolbar button toggles the bar. Change the shortcut at
  `chrome://extensions/shortcuts`. Settings → General has an optional fallback shortcut handled
  by the page for sites that take Ctrl+K themselves.
- **Enter** sends, **Shift+Enter** adds a line, **↑/↓** walk your input history, **Tab** accepts
  the grey suggestion, **Esc** stops a running request (or closes the bar when idle).
- The conversation belongs to the tab. It survives closing the bar, navigating, and the service
  worker being stopped by Chrome; **+** starts a new one.
- When the agent wants to run a tool that changes something or sends a request to another site,
  the bar shows the tool and its arguments: **Allow**, **Always allow on example.com** (this tool,
  on the current site, for this conversation) or **Deny**. The buttons work half a second after the prompt
  appears, and only while the prompt is fully visible. The prompt does not take the keyboard while
  you type; press **Shift+Tab** to reach it.
- On pages where extensions cannot run scripts (`chrome://` pages, the Chrome Web Store, the PDF
  viewer) the bar opens in its own tab, still bound to the page you were on. Page tools do not
  work there; the other tools do.
- If the page has a modal dialog open, the bar opens above it; until you close the bar, the page
  (dialog included) does not respond to the mouse or keyboard, although the agent's page tools
  still work.

## Setup

The first time you open the bar it asks for a model provider. You can change everything later in
**Settings** (⚙), including a different model per role:

- **Chat** runs the conversation and calls tools; it must support tool calling.
- **Vision** describes screenshots and other images as text when the provider reports that the
  chat model cannot take images (otherwise images go straight to the chat model).
- **Autocomplete** suggests completions while you type.

### OpenRouter

Create a key at <https://openrouter.ai/keys> and paste it into the setup screen (or Settings →
Providers). The default models are set in `src/shared/defaults.ts`; pick others in Settings →
Models. The chat model must support tool calling.

### Ollama

Ollama only answers browser extensions that it allows. Start it with the extension's origin
allowed, for example:

```bash
OLLAMA_ORIGINS=chrome-extension://* ollama serve
```

(or `OLLAMA_ORIGINS=chrome-extension://<extension id>`; the setup screen shows the exact value).
Then choose **Use Ollama**, **Connect**, and pick an installed model. For the agent to use tools,
pick a model that supports tool calling.

### Custom endpoint

Any server that speaks the OpenAI chat-completions API with streaming (`/v1/models` and
`/v1/chat/completions`): enter its base URL (ending in `/v1` for most servers), an API key if it
needs one, **Connect**, and pick a model.

Base URLs must be `https://`; plain `http://` is accepted only for `localhost`, `127.0.0.1` and
`[::1]` (a key sent over plain HTTP to another machine could be read on the way). Requests to
providers do not follow redirects, so use the final URL.

## MCP servers

Settings → MCP connects [Model Context Protocol](https://modelcontextprotocol.io/) servers over
**Streamable HTTP**. Give the server a short name (it becomes part of the tool names,
`mcp__<name>__<tool>`), its URL, and optionally a bearer token or extra headers (stored
encrypted, never shown again). **Test connection** checks the server and lists its tools.

- URLs must be `https://`; plain `http://` is allowed only for `localhost`, `127.0.0.1` and
  `[::1]`. Redirects are not followed (the token would go along): use the final URL, including a
  trailing slash if the server wants one.
- Servers that only speak stdio need a bridge that exposes them over Streamable HTTP.
- Every MCP tool asks for confirmation while confirmations are on (the default), because the
  extension cannot verify a server's claim that a tool is read-only. Turn on **Trust read-only
  hints** for a server you control to let its read-only tools run without asking.
- Individual tools (built-in or MCP) can be switched off in Settings → Tools.

### Signing in (OAuth)

Servers that use [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
(OAuth 2.1) need no token: add them without one. The extension finds the server's authorization
server (RFC 9728 / RFC 8414 metadata) and the server's row shows, before anything opens, **which
host the sign-in window will open** (marked **different site** when it is not the MCP server's
site) and **which scopes it will ask for** (the ones the server asks for, else the ones it lists).
When there is more than one, uncheck the ones you do not want to grant; your choice is remembered
for that server. Click **Sign in**: the extension registers itself with the authorization server if
the server allows it (dynamic client registration) and opens the sign-in page in a browser window.
If the server's metadata names another sign-in host by then, nothing opens and the row shows the
new one. After you approve, the tokens are stored encrypted like other secrets and renewed
automatically when the server issues a refresh token.

- The server row says **sign-in required** (and with which authorization server), **signed in**
  (with the expiry), or **sign-in failed** with the reason. **Sign out** revokes the tokens at the
  authorization server when it supports that, then deletes them.
- Sign-in only ever starts when you click: when the agent calls a tool on a server that needs
  sign-in, the tool fails and the agent is told to ask you to sign in from Settings → MCP. If a
  server asks for more permissions for some tool, the row offers **Sign in again**, showing the
  added scopes first.
- Changing a server's URL or client ID revokes its tokens and forgets them.
- Some authorization servers do not allow automatic registration. Register a client there with the
  redirect URI shown in the server's edit form (`https://<extension-id>.chromiumapp.org/mcp-oauth`)
  and enter its **OAuth client ID** in that form.
- A server with a saved bearer token or headers keeps using them; OAuth is used only without them.

### Discovered servers

With **Look for MCP servers on sites I visit** on (the default), the extension checks each site
you open, about once a day, for an MCP server it advertises: it requests the site's own
`/.well-known/ai-catalog.json` (the AI Catalog that lists MCP server cards) and
`/.well-known/oauth-protected-resource`, and, only when there is no catalog entry for an MCP server,
the older `/.well-known/mcp/server-card.json` (at most three requests); when they name an MCP server
on the same site, it fetches that server card and sends one unauthenticated test request to the
server. These requests go only
to the site you are on, carry no cookies, and are not made in incognito windows; the test request
(like any request an extension sends with a body) carries the extension's ID, so a site that
advertises an MCP server can tell the extension is installed. Found servers are listed under
**Settings → MCP → Discovered** (with their host, the site they were found on, whether they need
sign-in, and the name the site gives them), and the bar shows **MCP server available** on that
site. Nothing is added until you click **Add**; the server is named after its host unless the
site's name for it matches the host. When it needs sign-in, its row then shows where it signs you
in, and you click **Sign in**. **Dismiss** hides an entry and **Forget discovered servers** clears
the list.

## Page tools (WebMCP)

Some pages offer tools to AI agents themselves through [WebMCP](https://webmachinelearning.github.io/webmcp/)
(`document.modelContext.registerTool()`), for example a site search. Carbon Commander lists the
current page's tools to the model next to its own, and the bar shows a small **N page tools** chip
when the page offers any (click it for the list).

- Page tools are named `webmcp__<name>` and labelled **Page: &lt;site&gt;**, so a page can never
  replace a built-in or MCP tool. Their descriptions and results come from the page and are treated
  as untrusted data (cleaned, size-capped, shown as text).
- Every call asks first while confirmations are on, whatever the page says about the tool (a page
  can claim a tool is read-only; the extension cannot check). **Always allow on &lt;site&gt;** makes
  repeated use painless. A call only ever runs in the page whose tools the model saw: if the page
  navigates first (even to another page of the same site with a tool of the same name), it does
  not run.
- Chrome's own WebMCP (behind a flag or origin trial in current versions) is used when present,
  including tools declared with form attributes. Elsewhere the extension provides a small
  implementation of the current draft's `document.modelContext` (imperative API only) from the
  start of each page load, so pages that check for the API register their tools. Pages written for
  the earlier drafts and Chrome's early preview (`navigator.modelContext` with `provideContext`,
  `registerTool`, `unregisterTool`, `clearContext`) work too, through a small compatibility shim
  that is installed only alongside the extension's own implementation.
- **Settings → General → Use tools offered by the page (WebMCP)** (on by default) turns it off: no
  script is added to pages loaded afterwards, and no page tool is listed or run. Single page tools
  can be switched off in Settings → Tools like any other.

## Built-in tools

| Tool | What it does | Asks first |
|------|--------------|:----------:|
| `read_page` | Main content of the page as markdown-like text | |
| `get_page_info` | URL, title, metadata, scroll position, element counts | |
| `get_selection` | The text you selected | |
| `find_elements` | Interactive elements with refs (`e12`) for the action tools | |
| `click` | Click an element | yes |
| `type_text` | Type into a field or editor | yes |
| `select_option` | Choose an option in a `<select>` | yes |
| `press_key` | Press a key, optionally with modifiers | yes |
| `scroll`, `hover` | Scroll the page or an element; hover an element | |
| `screenshot` | Screenshot of the visible tab (the bar is hidden while capturing) | |
| `navigate`, `go_back`, `go_forward`, `reload` | Navigation in the current tab | yes |
| `wait` | Wait for time, a selector or text | |
| `list_tabs` | List open tabs (other tabs' URLs without query string and fragment) | for all windows |
| `open_tab`, `switch_tab` | Open a tab, bring a tab to the front | yes |
| `fetch_url` | Fetch a public URL without cookies or redirects, as text | yes |
| `get_current_time` | Current date and time | |
| `hn_list_stories`, `hn_get_item`, `hn_search` | Hacker News (on news.ycombinator.com) | |
| `github_repo_info`, `github_list_issues`, `github_get_file` | Public GitHub data (on github.com) | |

The Hacker News and GitHub toolsets are small examples of site toolsets built on public APIs; see
[src/tools/README.md](src/tools/README.md) to add one. They only call their site's fixed API
hosts, without asking. "Asks first" (built-in, MCP and page tools alike) can be turned off globally
in Settings → General.

## Security model

- The bar is an extension page inside a closed shadow root, linked to its content script by a
  private message channel. The page you are on cannot read the conversation, the settings or your
  keys, and gets no messages from the bar.
- A page cannot embed the bar itself and use it: the bar only starts inside the frame created by
  the extension's own content script (or as an extension tab), and the worker refuses everything
  else. Approval buttons only accept clicks while Chrome reports the prompt unobscured, so a page
  cannot get a click on **Allow** by drawing something over it. Details in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
- Model output is sanitised (marked + DOMPurify) before display; tool output is shown as text.
- Page content, tool results and MCP responses are untrusted. The agent is told not to follow
  instructions found in them, but prompt injection cannot be ruled out: read confirmation prompts
  (especially the URLs in them) before you allow an action. Confirmations do not stop data from
  reaching your model provider, and earlier tool output stays in the conversation when you move to
  another site.
- API keys and MCP auth are encrypted (AES-GCM) in the extension's IndexedDB with a
  non-extractable key; only the service worker decrypts them, to send each to its provider or MCP
  server. Pages and content scripts cannot read them. Software that can read and decrypt your
  browser profile is out of scope. Older versions' keys in `chrome.storage.local` are moved there
  and deleted on first use.
- On Chrome 140 and newer, extension storage (settings, input history) is closed to content
  scripts as well.
- Page tools (WebMCP): the extension reads and runs a page's tools by injecting a script when it
  needs them; nothing in the extension listens to the page, so a page can offer and run its own
  tools but cannot send the extension anything else. In browsers without native WebMCP, the
  `document.modelContext` the extension adds also tells pages that the extension is installed.
- Permissions: `<all_urls>` host access, `scripting` and `tabs` let page tools and screenshots work
  on any site you use the bar on; `activeTab` grants access to the tab you open the bar on from the
  toolbar or shortcut (overlapping with the host permission); `storage` holds settings and
  sessions; `identity` opens the sign-in window for MCP servers that use OAuth
  (`chrome.identity.launchWebAuthFlow`; it gives the extension no access to your Google account).
- MCP OAuth: everything the servers send is validated (issuer match, `state`, the `iss` response
  parameter, PKCE S256, `https://` endpoints, size limits); access tokens are only sent to the MCP
  server they were issued for, never shown, logged or put into the conversation.

## Development

```bash
npm run watch        # development build, rebuilds on change
npm run typecheck    # tsc for src/ and tests/
npm run lint         # ESLint
npm test             # unit tests (Vitest)
npm run test:e2e     # e2e + production builds, then the Playwright end-to-end tests (see below)
npm run check        # typecheck + lint + unit tests + build
```

The end-to-end tests (`tests/e2e/`) load the extension into Playwright's bundled Chromium
(headless) and drive it against a local mock LLM, a mock MCP server and a fixture site.
`smoke.spec.ts` uses a development build with a test hook (`build.mjs --e2e`, which exposes the
toolbar-button code path to the test); `prod.spec.ts` checks the production bundle (`dist-prod/`),
which has no hooks. `mcp-auth.spec.ts` covers MCP discovery on fixture sites and the OAuth sign-in
against a local mock authorization server, through Chrome's real sign-in window. `webmcp.spec.ts` covers page tools against fixture pages, both with the
extension's own `document.modelContext` and with Chrome's native one (`--enable-features=WebMCP`). Install the browser once with `npx playwright install chromium`.

The icons in `src/icons/` are drawn by `npm run icons` (`scripts/icons.mjs`, no dependencies).

`dist/bar.html?mock=1` (development builds only) runs the UI against a scripted fake worker,
which is handy for working on the UI without a model.

Architecture, message channels and the security model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- **Manual tool calls**: run a tool from the tools list with a small form, or by typing
  `tool:<name>` in the bar, with the result added to the conversation.
- **Side panel**: the bar already runs as a standalone page, so it can also be offered in
  Chrome's side panel.
- **Desktop service**: move the agent into a local service with the extension as its browser
  hook, which would allow background triggers, other applications and desktop automation.

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/carbonitex)

## Disclaimer

**Use at your own risk.** Carbon Commander acts in your browser based on your input and a model's
output. You are responsible for reviewing and approving actions before they run. The authors and
contributors accept no liability for what the extension does on your behalf.

## License

MIT, see [LICENSE.txt](LICENSE.txt).
