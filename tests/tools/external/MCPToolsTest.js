import { TestRunner } from '../../TestRunner.js';
import { MCPServiceMock } from './MCPServiceMock.js';
import mcpToolCaller from '../../../src/chrome-carbonbar-page/mcp-tool-caller.js';
import settings from '../../../src/chrome-carbonbar-page/settings.js';
import { ccLogger } from '../../../src/global.js';

// Mock fetch for MCP service
const mockService = new MCPServiceMock();
const originalFetch = window.fetch;

function mockFetch(url, options) {
    if (url.includes('mcp-test-service')) {
        const endpoint = new URL(url).pathname;
        return mockService.handleRequest(endpoint, options.method, options.headers, JSON.parse(options.body || '{}'))
            .then(response => ({
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                statusText: response.status === 200 ? 'OK' : 'Error',
                json: async () => response.body
            }));
    }
    return originalFetch(url, options);
}

export async function runMCPTests() {
    // Setup mock fetch
    window.fetch = mockFetch;

    // Add some test tools to the mock service
    mockService.addTool('test-toolset', {
        name: 'test-tool',
        description: 'A test tool',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string' }
            }
        },
        execute: async (args) => ({ result: `Executed with ${args.message}` })
    });

    const tests = [
        {
            name: 'MCP Service Configuration',
            fn: async () => {
                const config = {
                    serviceId: 'test-service',
                    endpoint: 'https://mcp-test-service.example.com',
                    apiKey: 'test-api-key',
                    options: { autoConnect: true }
                };

                const result = await mcpToolCaller.configureMCPService(config);
                TestRunner.assert(result, 'Service configuration failed');
                TestRunner.assert(mcpToolCaller.mcpConfig.has('test-service'), 'Service not added to config');
                TestRunner.assert(settings.mcpConfigurations.has('test-service'), 'Service not saved to settings');
            }
        },
        {
            name: 'MCP Service Connection',
            fn: async () => {
                const result = await mcpToolCaller.connectMCPService('test-service');
                TestRunner.assert(result, 'Service connection failed');
                TestRunner.assert(mcpToolCaller.mcpClients.has('test-service'), 'Client not created');
                
                const status = mcpToolCaller.getMCPServiceStatus('test-service');
                TestRunner.assertEquals(status.status, 'connected', 'Incorrect service status');
                TestRunner.assert(status.connected, 'Service not marked as connected');
            }
        },
        {
            name: 'MCP Tool Discovery',
            fn: async () => {
                const toolsets = await mcpToolCaller.discoverMCPTools('test-service');
                TestRunner.assert(toolsets.length > 0, 'No toolsets discovered');
                TestRunner.assert(mcpToolCaller.mcpToolsets.has('test-service:test-toolset'), 'Toolset not added');
                
                const tools = mcpToolCaller.getTools(true);
                TestRunner.assert(tools.some(t => t.name === 'test-tool'), 'Test tool not found in tools list');
            }
        },
        {
            name: 'MCP Function Execution',
            fn: async () => {
                const result = await mcpToolCaller.mcpCallFunction('test-service', 'test-tool', { message: 'hello' });
                TestRunner.assertEquals(result.result, 'Executed with hello', 'Incorrect function result');
            }
        },
        {
            name: 'MCP Function Timeout',
            fn: async () => {
                // Add a delayed tool to the mock service
                mockService.addTool('test-toolset', {
                    name: 'delayed-tool',
                    description: 'A tool that takes longer than the timeout',
                    parameters: {
                        type: 'object',
                        properties: {
                            delay: { type: 'number' }
                        }
                    },
                    execute: async (args) => {
                        await new Promise(resolve => setTimeout(resolve, args.delay));
                        return { result: 'Delayed execution complete' };
                    }
                });

                try {
                    // Attempt to call function with a delay longer than the timeout
                    await mcpToolCaller.mcpCallFunction('test-service', 'delayed-tool', { delay: 5000 });
                    TestRunner.assert(false, 'Function call should have timed out');
                } catch (error) {
                    TestRunner.assert(error.name === 'AbortError' || error.message.includes('timeout'), 
                        'Expected timeout or abort error');
                }

                // Verify successful execution with delay shorter than timeout
                const result = await mcpToolCaller.mcpCallFunction('test-service', 'delayed-tool', { delay: 100 });
                TestRunner.assertEquals(result.result, 'Delayed execution complete', 
                    'Function should complete when within timeout');
            }
        },
        {
            name: 'MCP Health Check',
            fn: async () => {
                let health = await mcpToolCaller.checkMCPHealth('test-service');
                TestRunner.assert(health, 'Health check failed when service is healthy');

                mockService.setHealth(false);
                health = await mcpToolCaller.checkMCPHealth('test-service');
                TestRunner.assert(!health, 'Health check passed when service is unhealthy');
                mockService.setHealth(true);
            }
        },
        {
            name: 'MCP Service Disconnection',
            fn: async () => {
                const result = await mcpToolCaller.disconnectMCPService('test-service');
                TestRunner.assert(result, 'Service disconnection failed');
                TestRunner.assert(!mcpToolCaller.mcpClients.has('test-service'), 'Client not removed');
                TestRunner.assert(!settings.mcpConfigurations.has('test-service'), 'Service not removed from settings');
            }
        },
        {
            name: 'MCP Error Handling',
            fn: async () => {
                // Test invalid API key
                const invalidConfig = {
                    serviceId: 'invalid-service',
                    endpoint: 'https://mcp-test-service.example.com',
                    apiKey: 'invalid-key',
                    options: { autoConnect: true }
                };
                await mcpToolCaller.configureMCPService(invalidConfig);
                const result = await mcpToolCaller.connectMCPService('invalid-service');
                TestRunner.assert(!result, 'Connection succeeded with invalid API key');

                // Test service unavailable
                mockService.setConnected(false);
                const healthCheck = await mcpToolCaller.checkMCPHealth('invalid-service');
                TestRunner.assert(!healthCheck, 'Health check passed when service is unavailable');
                mockService.setConnected(true);
            }
        },
        {
            name: 'MCP Automatic Reconnection',
            fn: async () => {
                // Configure a service with autoReconnect
                const config = {
                    serviceId: 'auto-reconnect-service',
                    endpoint: 'https://mcp-test-service.example.com',
                    apiKey: 'test-api-key',
                    options: { autoConnect: true, autoReconnect: true }
                };
                await mcpToolCaller.configureMCPService(config);

                // Simulate service failure
                mockService.setConnected(false);
                await mcpToolCaller.refreshMCPConnections();
                TestRunner.assert(!mcpToolCaller.mcpClients.has('auto-reconnect-service'), 'Client not disconnected on failure');

                // Simulate service recovery
                mockService.setConnected(true);
                await mcpToolCaller.refreshMCPConnections();
                TestRunner.assert(mcpToolCaller.mcpClients.has('auto-reconnect-service'), 'Client not reconnected after recovery');

                // Cleanup
                await mcpToolCaller.disconnectMCPService('auto-reconnect-service');
            }
        }
    ];

    try {
        return await TestRunner.runTestSuite('MCP Tools', tests);
    } finally {
        // Cleanup
        window.fetch = originalFetch;
        mcpToolCaller.cleanup();
    }
} 