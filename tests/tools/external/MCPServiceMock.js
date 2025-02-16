import { ccLogger } from '../../../src/global.js';

class MCPServiceMock {
    constructor() {
        this.tools = new Map();
        this.isHealthy = true;
        this.apiKey = 'test-api-key';
        this.connected = true;
    }

    addTool(toolset, tool) {
        if (!this.tools.has(toolset)) {
            this.tools.set(toolset, []);
        }
        this.tools.get(toolset).push(tool);
    }

    async handleRequest(endpoint, method, headers, body) {
        // Validate API key
        const authHeader = headers['Authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== this.apiKey) {
            return { status: 401, body: { error: 'Invalid API key' } };
        }

        switch (endpoint) {
            case '/status':
                return {
                    status: 200,
                    body: { healthy: this.isHealthy }
                };

            case '/discover-tools':
                if (!this.connected) {
                    return { status: 503, body: { error: 'Service unavailable' } };
                }
                return {
                    status: 200,
                    body: Array.from(this.tools.entries()).map(([name, tools]) => ({
                        name,
                        tools: tools.map(t => ({
                            name: t.name,
                            description: t.description,
                            parameters: t.parameters
                        }))
                    }))
                };

            case '/execute':
                if (!this.connected) {
                    return { status: 503, body: { error: 'Service unavailable' } };
                }
                const { function: functionName, arguments: args } = body;
                
                // Find the tool
                let foundTool = null;
                for (const tools of this.tools.values()) {
                    foundTool = tools.find(t => t.name === functionName);
                    if (foundTool) break;
                }

                if (!foundTool) {
                    return { status: 404, body: { error: `Tool ${functionName} not found` } };
                }

                try {
                    const result = await foundTool.execute(args);
                    return { status: 200, body: result };
                } catch (error) {
                    return { status: 500, body: { error: error.message } };
                }

            default:
                return { status: 404, body: { error: 'Endpoint not found' } };
        }
    }

    setHealth(isHealthy) {
        this.isHealthy = isHealthy;
    }

    setConnected(connected) {
        this.connected = connected;
    }
}

export { MCPServiceMock }; 