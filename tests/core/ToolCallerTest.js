import { TestRunner } from '../TestRunner.js';
import { ToolCaller } from '../../src/chrome-carbonbar-page/tool-caller.js';

const tests = [
    {
        name: 'Tool Registration',
        fn: async () => {
            const toolCaller = new ToolCaller();
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
            const tools = toolCaller.getTools();
            TestRunner.assert(tools.length === 1, 'Should have one registered tool');
            TestRunner.assert(tools[0].name === 'test-tool', 'Tool name should match');
        }
    },
    {
        name: 'Tool Execution',
        fn: async () => {
            const toolCaller = new ToolCaller();
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
            const result = await toolCaller.executeTool('test-tool', { message: 'test' });
            TestRunner.assert(result.result === 'Executed with test', 'Tool execution result should match');
        }
    },
    {
        name: 'Tool Parameter Validation',
        fn: async () => {
            const toolCaller = new ToolCaller();
            const testTool = {
                name: 'test-tool',
                description: 'A test tool',
                parameters: {
                    type: 'object',
                    required: ['message'],
                    properties: {
                        message: { type: 'string' }
                    }
                },
                execute: async (args) => ({ result: `Executed with ${args.message}` })
            };

            toolCaller.registerTool('test', testTool);
            
            try {
                await toolCaller.executeTool('test-tool', {});
                TestRunner.assert(false, 'Should throw error for missing required parameter');
            } catch (error) {
                TestRunner.assert(error.message.includes('required'), 'Error should mention required parameter');
            }
        }
    }
];

export async function runToolCallerTests() {
    return TestRunner.runTestSuite('Tool Caller', tests);
} 