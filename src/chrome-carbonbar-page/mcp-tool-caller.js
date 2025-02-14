import { ccLogger } from '../global.js';

class MCPToolCaller {
    constructor() {
        this.currentPageTools = null;
        this.mcpClients = new Map(); // Map of MCP client connections
        this.mcpConfig = new Map(); // Map of MCP service configurations
        this.mcpToolsets = new Map(); // Map of MCP-provided toolsets
    }

    // MCP-specific methods
    async configureMCPService(serviceConfig) {
        const { serviceId, endpoint, apiKey, options = {} } = serviceConfig;
        
        ccLogger.debug(`Configuring MCP service: ${serviceId}`);
        
        try {
            this.mcpConfig.set(serviceId, {
                endpoint,
                apiKey,
                options,
                status: 'configured',
                toolsets: [] // Will store toolsets provided by this service
            });
            
            // Initialize client connection if autoConnect is true
            if (options.autoConnect) {
                await this.connectMCPService(serviceId);
            }
            
            return true;
        } catch (error) {
            ccLogger.error(`Error configuring MCP service ${serviceId}:`, error);
            return false;
        }
    }

    async connectMCPService(serviceId) {
        ccLogger.debug(`Connecting to MCP service: ${serviceId}`);
        
        const config = this.mcpConfig.get(serviceId);
        if (!config) {
            throw new Error(`MCP service ${serviceId} not configured`);
        }

        try {
            // Initialize MCP client connection with enhanced capabilities
            const client = {
                serviceId,
                endpoint: config.endpoint,
                connected: true,
                // Enhanced client methods
                callFunction: async (functionName, args) => {
                    return await this.mcpCallFunction(serviceId, functionName, args);
                },
                discoverTools: async () => {
                    return await this.discoverMCPTools(serviceId);
                },
                getSystemPrompt: async (basePrompt, scope) => {
                    return await this.getMCPSystemPrompt(serviceId, basePrompt, scope);
                }
            };

            this.mcpClients.set(serviceId, client);
            config.status = 'connected';

            // Discover available tools after connection
            await this.discoverMCPTools(serviceId);
            
            return true;
        } catch (error) {
            ccLogger.error(`Error connecting to MCP service ${serviceId}:`, error);
            config.status = 'error';
            config.lastError = error.message;
            return false;
        }
    }

    async discoverMCPTools(serviceId) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            throw new Error(`MCP client ${serviceId} not connected`);
        }

        try {
            // Call the MCP service's tool discovery endpoint
            const response = await fetch(`${client.endpoint}/discover-tools`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`Tool discovery failed: ${response.statusText}`);
            }

            const toolsets = await response.json();
            
            // Process and store discovered toolsets
            toolsets.forEach(toolset => {
                // Add MCP-specific wrapper around toolset
                const wrappedToolset = this.wrapMCPToolset(serviceId, toolset);
                this.mcpToolsets.set(`${serviceId}:${toolset.name}`, wrappedToolset);
            });

            return toolsets;
        } catch (error) {
            ccLogger.error(`Error discovering tools for ${serviceId}:`, error);
            throw error;
        }
    }

    wrapMCPToolset(serviceId, toolset) {
        // Create a wrapper that maintains compatibility with local toolsets
        return {
            name: `${serviceId}:${toolset.name}`,
            toolSet: {
                ...toolset,
                _CarbonBarPageLoadFilter: toolset.pageLoadFilter || (() => true),
                _CarbonBarBuildScope: async (scope) => {
                    // Call MCP service for scope building if supported
                    try {
                        const client = this.mcpClients.get(serviceId);
                        const response = await fetch(`${client.endpoint}/build-scope`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                            },
                            body: JSON.stringify({ scope })
                        });
                        
                        if (response.ok) {
                            const customScope = await response.json();
                            return { ...scope, ...customScope };
                        }
                    } catch (error) {
                        ccLogger.error(`Error building MCP scope for ${serviceId}:`, error);
                    }
                    return scope;
                },
                _CarbonBarSystemPrompt: async (basePrompt, scope) => {
                    // Call MCP service for system prompt customization if supported
                    try {
                        const client = this.mcpClients.get(serviceId);
                        const response = await fetch(`${client.endpoint}/system-prompt`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                            },
                            body: JSON.stringify({ basePrompt, scope })
                        });
                        
                        if (response.ok) {
                            const { customPrompt } = await response.json();
                            return customPrompt || basePrompt;
                        }
                    } catch (error) {
                        ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
                    }
                    return basePrompt;
                }
            },
            tools: toolset.tools.map(tool => ({
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                },
                execute: async (scope, args) => {
                    return await this.mcpCallFunction(serviceId, tool.name, args);
                }
            }))
        };
    }

    async disconnectMCPService(serviceId) {
        ccLogger.debug(`Disconnecting from MCP service: ${serviceId}`);
        
        const client = this.mcpClients.get(serviceId);
        if (client) {
            try {
                // Remove all toolsets from this service
                for (const [toolsetId, toolset] of this.mcpToolsets.entries()) {
                    if (toolsetId.startsWith(`${serviceId}:`)) {
                        this.mcpToolsets.delete(toolsetId);
                    }
                }

                // Cleanup client connection
                this.mcpClients.delete(serviceId);
                const config = this.mcpConfig.get(serviceId);
                if (config) {
                    config.status = 'disconnected';
                }
                return true;
            } catch (error) {
                ccLogger.error(`Error disconnecting from MCP service ${serviceId}:`, error);
                return false;
            }
        }
        return false;
    }

    async mcpCallFunction(serviceId, functionName, args) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            throw new Error(`MCP client ${serviceId} not connected`);
        }

        try {
            const response = await fetch(`${client.endpoint}/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                },
                body: JSON.stringify({
                    function: functionName,
                    arguments: args
                })
            });

            if (!response.ok) {
                throw new Error(`MCP call failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            ccLogger.error(`Error calling MCP function ${functionName}:`, error);
            throw error;
        }
    }

    // Tool management methods with MCP support
    reset() {
        ccLogger.debug('Resetting MCP tool caller state');
        this.currentPageTools = null;
        // Don't reset MCP configurations/connections unless explicitly requested
    }

    getToolSets() {
        return [...this.getAllToolsets(), ...Array.from(this.mcpToolsets.values())];
    }

    getTools(onlyFunctionInfo = false) {        
        ccLogger.group('Getting Tools');
        let allTools = [];
        
        // Get local tools
        let pageTools = this.getAllToolSetsForPage();
        pageTools.forEach(toolSet => {
            toolSet.tools.forEach(prop => {
                allTools.push(onlyFunctionInfo ? prop.function : prop);
            });
        });
        
        // Add MCP tools
        this.mcpToolsets.forEach(toolset => {
            if (toolset.toolSet._CarbonBarPageLoadFilter(window)) {
                toolset.tools.forEach(tool => {
                    allTools.push(onlyFunctionInfo ? tool.function : tool);
                });
            }
        });
        
        ccLogger.debug(`Found ${allTools.length} tools (including MCP tools)`);
        ccLogger.groupEnd();
        return allTools;
    }

    getTool(toolName, onlyFunctionInfo = false) {
        ccLogger.debug('Getting tool:', toolName);
        const allTools = this.getTools(onlyFunctionInfo);
        const tool = allTools.find(tool => onlyFunctionInfo ? tool.name == toolName : tool.function.name == toolName);
        if (!tool) {
            ccLogger.warn(`Tool not found: ${toolName}`);
        }
        return tool;
    }

    async getToolScope(bar) {
        ccLogger.group('Building Tool Scope');
        var scope = {
            bar: bar,
            logMessage: (message, important = false) => {
                if(important) {
                    ccLogger.info('[ToolScope] ' + message);
                } else {
                    ccLogger.debug('[ToolScope] ' + message);
                }
            },
            logError: (message) => {
                ccLogger.error('[ToolScope] ' + message);
            }
        }

        // Add MCP-specific scope items
        scope.mcpServices = Array.from(this.mcpConfig.entries()).map(([id, config]) => ({
            id,
            status: config.status,
            endpoint: config.endpoint
        }));

        // Apply local toolsets scope functions
        for(let toolSet of this.getAllToolSetsForPage()) {
            try {
                if(toolSet.toolSet._CarbonBarBuildScope) {
                    ccLogger.debug(`Building scope for toolset: ${toolSet.name}`);
                    scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                }
            } catch (e) {
                ccLogger.error('Error building scope:', e);
            }
        }

        // Apply MCP toolsets scope functions
        for(let [_, toolset] of this.mcpToolsets) {
            try {
                if(toolset.toolSet._CarbonBarPageLoadFilter(window) && toolset.toolSet._CarbonBarBuildScope) {
                    ccLogger.debug(`Building scope for MCP toolset: ${toolset.name}`);
                    scope = await toolset.toolSet._CarbonBarBuildScope(scope);
                }
            } catch (e) {
                ccLogger.error('Error building MCP scope:', e);
            }
        }

        if(!scope.appName) {
            ccLogger.warn('No app name found in scope, using default');
            scope.appName = 'CarbonCommander [MCP Mode]';
        }
        
        ccLogger.groupEnd();
        return scope;
    }

    getAllToolSetsForPage() {
        if(this.currentPageTools) {
            return this.currentPageTools;
        }
        
        ccLogger.group('Getting Tool Sets for Page');
        this.currentPageTools = this.getAllToolsets().filter(toolSet => 
            (toolSet.tools && toolSet.tools.length > 0) &&
            (toolSet.toolSet._CarbonBarPageLoadFilter && toolSet.toolSet._CarbonBarPageLoadFilter(window))
        );
        
        ccLogger.debug(`Found ${this.currentPageTools.length} tool sets for current page`);
        ccLogger.groupEnd();
        return this.currentPageTools;
    }

    getAllToolsets() {
        ccLogger.group('Getting All Tool Sets');
        const allTools = [];
        if (window.sbaiTools) {
            Object.entries(window.sbaiTools).forEach(([_, toolSet]) => {
                try {
                    let toolset = {
                        name: toolSet.name,
                        toolSet: toolSet,
                        tools: Object.getOwnPropertyNames(toolSet)
                            .filter(prop => typeof toolSet[prop] === 'object' && toolSet[prop]?.function)
                            .map(prop => toolSet[prop])
                    };

                    ccLogger.debug('Processing toolset:', { 
                        name: toolset.name, 
                        toolCount: toolset.tools.length 
                    });

                    if(toolset.tools && toolset.tools.length > 0) {
                        allTools.push(toolset);
                    }
                } catch (e) {
                    ccLogger.error(`Error getting tools from ${toolSet.name}:`, e);
                }
            });
        }
        ccLogger.debug(`Total tool sets found: ${allTools.length}`);
        ccLogger.groupEnd();
        return allTools;
    }

    // MCP Service management methods
    getMCPServices() {
        return Array.from(this.mcpConfig.entries()).map(([id, config]) => ({
            id,
            status: config.status,
            endpoint: config.endpoint,
            connected: this.mcpClients.has(id),
            toolsets: Array.from(this.mcpToolsets.values())
                .filter(ts => ts.name.startsWith(`${id}:`))
                .map(ts => ts.name.substring(id.length + 1))
        }));
    }

    getMCPServiceStatus(serviceId) {
        const config = this.mcpConfig.get(serviceId);
        return config ? {
            status: config.status,
            connected: this.mcpClients.has(serviceId),
            lastError: config.lastError,
            toolsets: Array.from(this.mcpToolsets.values())
                .filter(ts => ts.name.startsWith(`${serviceId}:`))
                .map(ts => ts.name.substring(serviceId.length + 1))
        } : null;
    }

    async refreshMCPConnections() {
        ccLogger.debug('Refreshing all MCP connections');
        const results = [];
        for (const [serviceId, config] of this.mcpConfig.entries()) {
            if (config.status === 'connected' || config.options.autoReconnect) {
                results.push({
                    serviceId,
                    success: await this.connectMCPService(serviceId)
                });
            }
        }
        return results;
    }
}

const mcpToolCaller = new MCPToolCaller();
export default mcpToolCaller; 