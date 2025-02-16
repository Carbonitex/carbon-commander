import { TestRunner } from '../TestRunner.js';
import { CarbonBar } from '../../src/chrome-carbonbar-page/carbon-commander.js';
import { ToolCaller } from '../../src/chrome-carbonbar-page/tool-caller.js';

const tests = [
    {
        name: 'CarbonBar and ToolCaller Integration',
        fn: async () => {
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: { add: () => {} },
                    appendChild: () => {},
                    addEventListener: () => {}
                }),
                body: { appendChild: () => {} }
            };

            const carbonBar = new CarbonBar(mockDocument);
            const toolCaller = new ToolCaller();

            // Register a test tool
            const testTool = {
                name: 'test-tool',
                description: 'A test tool',
                parameters: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' }
                    }
                },
                execute: async (args) => ({ result: `Executed with ${args.message}` })
            };

            toolCaller.registerTool('test', testTool);
            
            // Verify tool registration
            const tools = toolCaller.getTools();
            TestRunner.assert(tools.length === 1, 'Tool should be registered');

            // Test tool execution through CarbonBar
            const result = await toolCaller.executeTool('test-tool', { message: 'integration test' });
            TestRunner.assert(result.result === 'Executed with integration test', 'Tool execution should work');
        }
    },
    {
        name: 'End-to-End Command Flow',
        fn: async () => {
            const messages = [];
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: { add: () => {} },
                    appendChild: () => {},
                    addEventListener: (event, handler) => {
                        if (event === 'keydown') {
                            // Simulate Enter key press with a command
                            handler({ key: 'Enter', target: { value: 'test command' } });
                        }
                    },
                    value: ''
                }),
                body: { appendChild: () => {} }
            };

            const carbonBar = new CarbonBar(mockDocument);
            const toolCaller = new ToolCaller();

            // Mock command processing
            carbonBar.processCommand = async (cmd) => {
                messages.push(cmd);
                return { success: true, result: `Processed: ${cmd}` };
            };

            // Verify command flow
            TestRunner.assert(messages.length === 1, 'Command should be processed');
            TestRunner.assert(messages[0] === 'test command', 'Command should match input');
        }
    }
];

export async function runIntegrationTests() {
    return TestRunner.runTestSuite('Integration Tests', tests);
} 