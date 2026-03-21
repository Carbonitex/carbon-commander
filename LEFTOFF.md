# Carbon Commander - Where We Left Off

## Completed: 2026 Modernization Plan (All 5 Phases)

All phases of the modernization plan have been implemented and the project builds successfully (`npm run build`).

### Phase 1: Encryption Upgrade
- **File**: `src/chrome-serviceworker/local-storage.js`
- Replaced XOR cipher with AES-GCM via Web Crypto API
- Added `getOrCreateEncryptionKey()` — generates/stores a 256-bit AES-GCM key as JWK in `chrome.storage.local`
- `setEncrypted()` uses random 12-byte IV, stores as `{ v: 2, iv, ct }` JSON
- `getEncrypted()` auto-detects old XOR format (hex string) and migrates to AES-GCM on first read
- Old `#pass` constant kept temporarily for migration only

### Phase 2: OpenRouter Provider Swap
Replaced direct OpenAI + Gemini clients with a single OpenRouter provider (OpenAI-compatible API).

- **Created**: `src/chrome-serviceworker/external-services/openrouter.js` — OpenRouter client (base URL `https://openrouter.ai/api/v1`, storage key `openrouter-key`)
- **Modified**: `src/global.js` — `AICallerModels` now has 2 providers (openrouter, ollama) instead of 3
- **Rewritten**: `src/chrome-serviceworker/external-services/caller.js` — simplified to openrouter + ollama
- **Rewritten**: `src/chrome-serviceworker/chrome-ai-service.js` — replaced openai/gemini message handlers with openrouter
- **Modified**: `src/chrome-extension/service.js` — updated message forwarding
- **Modified**: `src/chrome-carbonbar-page/carbon-commander.js` — 2 provider badges, updated init checks and noAI mode
- **Modified**: `src/chrome-carbonbar-page/settings.js` — `openrouter-key` replaces `openai-key`/`gemini-key`
- **Rewritten**: `src/tools/CarbonBarHelpTools.js` — `SetOpenRouterKey` replaces `SetOpenAIKey`/`SetGeminiKey`
- **Modified**: `src/tools/GeneralTools.js` — image gen and key management updated
- **Modified**: `tests/suites/IntegrationTests.js` — updated provider references
- **Deleted**: `openai.js`, `gemini.js`, `geminiapi-unused.js`

### Phase 3: BaseToolCaller Extraction
- **Created**: `src/chrome-carbonbar-page/base-tool-caller.js` (213 lines)
- Extracted shared methods: `reset()`, `getToolSets()`, `getTools()`, `getTool()`, `getAllToolSetsForPage()`, `getAllToolsets()`, `getToolHtml()`
- `ToolCaller` (156 lines) and `MCPToolCaller` (536 lines) now extend `BaseToolCaller`

### Phase 4: Security Hardening
- **4A — HMAC key delivery**: Key now delivered via one-time `MessageChannel` port instead of DOM attribute (`cc-data-key`). Changed in `service.js` (sender), `secure-messaging.js` (receiver), `carbon-commander.js` (removed DOM query).
- **4B — MCP validation**: Added `validateEndpointUrl()` (HTTPS or localhost only), `validateToolDiscoveryResponse()` (schema validation), and function name validation against discovered tools in `mcp-tool-caller.js`.
- **4C — $http restriction**: Added URL validation wrapper in `tool-caller.js` — blocks requests that are not same-origin, HTTPS, or localhost. Logs blocked requests.

### Phase 5: God Object Split
- **Created**: `src/chrome-carbonbar-page/cc-provider-manager.js` (276 lines) — extracted `updateProviderStatus()`, `checkOllamaAvailability()`, `getNoProviderHtml()`, `noAIModeInputHandler()`, `noAIModeOpenRouterInputRespond()`, `noAIModeOllamaInputRespond()`, `connectedProviders` state, `hasNoAIMode` state
- **Created**: `src/chrome-carbonbar-page/cc-chat-manager.js` (310 lines) — extracted `handleAIResponse()`, `handleSubmit()`, `sendFakeAIResponse()`, `addSystemPrompt()`, `messages` state, `accumulatedChunks` state
- `carbon-commander.js` reduced from 2,091 to 1,547 lines
- CarbonCommander uses composition: holds `providerManager` and `chatManager` instances
- Getters/setters on CarbonCommander delegate `messages`, `accumulatedChunks`, `connectedProviders`, `hasNoAIMode` to the managers for backward compatibility

## Not Yet Done / Future Work
- **Manual testing in Chrome**: Load `dist/` as unpacked extension, verify no console errors, test provider connections, chat, tool execution, settings, MCP, autocomplete
- **Encryption migration testing**: If old XOR-encrypted keys exist in storage, verify they auto-migrate
- **Site-specific tools**: Out of scope for this modernization, not started
- **Further god object reduction**: `carbon-commander.js` is still 1,547 lines — dialog management, event handling, and UI rendering could be extracted further if desired
