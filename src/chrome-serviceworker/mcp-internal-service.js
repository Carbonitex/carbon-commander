import toolRegistry from './tool-registry.js';

const ccLog = (...args) => console.log('[MCPInternal]', ...args);
const ccError = (...args) => console.error('[MCPInternal]', ...args);

class MCPInternalService {
    constructor(registry) {
        this.registry = registry;
    }

    async handleMessage(type, payload, sender) {
        switch (type) {
            case 'MCP_DISCOVER_TOOLS':
                return this.handleDiscoverTools(payload, sender);
            case 'MCP_EXECUTE_TOOL':
                return this.handleExecuteTool(payload, sender);
            case 'MCP_SYSTEM_PROMPT':
                return this.handleSystemPrompt(payload, sender);
            default:
                return null;
        }
    }

    async handleDiscoverTools(payload, sender) {
        const tabUrl = payload?.tabUrl || sender?.tab?.url;
        if (!tabUrl) {
            return { error: 'No tab URL available for tool discovery' };
        }

        ccLog('Discovering tools for:', tabUrl);
        const toolsets = this.registry.discoverTools(tabUrl);
        const allTools = [];
        for (const ts of toolsets) {
            for (const tool of ts.tools) {
                allTools.push(tool);
            }
        }
        ccLog(`Found ${allTools.length} tools`);
        return { tools: allTools };
    }

    async handleExecuteTool(payload, sender) {
        const { toolName, args, tabId } = payload;
        const actualTabId = tabId || sender?.tab?.id;

        if (!toolName) {
            return { success: false, error: 'No tool name provided' };
        }

        const context = this.registry.getToolContext(toolName);
        ccLog(`Executing tool: ${toolName} (context: ${context})`);

        if (context === 'worker') {
            return await this.registry.executeInWorker(toolName, args, actualTabId);
        }

        // Non-worker tools need to be delegated to the page
        return { delegateToPage: true, context, toolName, args };
    }

    async handleSystemPrompt(payload, sender) {
        const { basePrompt } = payload;
        const tabUrl = payload?.tabUrl || sender?.tab?.url;

        if (!tabUrl) {
            return { prompt: basePrompt };
        }

        const prompt = this.registry.buildSystemPrompt(basePrompt, tabUrl);
        return { prompt };
    }
}

const mcpInternalService = new MCPInternalService(toolRegistry);
export default mcpInternalService;
