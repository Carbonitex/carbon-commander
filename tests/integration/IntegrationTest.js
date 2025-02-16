import { TestRunner } from '../TestRunner.js';
import { CarbonBar } from '../../src/chrome-carbonbar-page/carbon-commander.js';
import { ToolCaller } from '../../src/chrome-carbonbar-page/tool-caller.js';

const tests = [
    {
        name: 'CarbonBar and ToolCaller Integration',
        fn: async () => {
            // Create a mock document with proper event handling
            let inputValue = '';
            let eventHandlers = new Map();
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: { add: () => {}, remove: () => {} },
                    appendChild: () => {},
                    addEventListener: (event, handler) => {
                        eventHandlers.set(event, handler);
                    },
                    querySelector: () => null,
                    get value() { return inputValue; },
                    set value(val) { inputValue = val; }
                }),
                body: { appendChild: () => {} },
                addEventListener: (event, handler) => {
                    eventHandlers.set(event, handler);
                }
            };

            // Initialize CarbonBar and ToolCaller
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
                execute: async (scope, args) => ({ result: `Executed with ${args.message}` })
            };

            toolCaller.registerTool('test', testTool);
            
            // Verify tool registration
            const tools = toolCaller.getTools();
            TestRunner.assert(tools.length === 1, 'Tool should be registered');

            // Simulate user entering a command
            inputValue = 'test-tool {"message": "integration test"}';
            
            // Simulate Enter key press
            const keydownHandler = eventHandlers.get('keydown');
            TestRunner.assert(keydownHandler, 'Keydown handler should be registered');
            
            // Trigger the command processing
            await keydownHandler({ key: 'Enter', target: { value: inputValue } });

            // Verify command was processed
            TestRunner.assert(carbonBar.messages.length > 0, 'Command should be added to message history');
            
            // Clean up
            toolCaller.reset();
            carbonBar.hide();
        }
    },
    {
        name: 'End-to-End Command Flow',
        fn: async () => {
            const messages = [];
            let inputValue = '';
            let eventHandlers = new Map();
            
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: { add: () => {}, remove: () => {} },
                    appendChild: () => {},
                    addEventListener: (event, handler) => {
                        eventHandlers.set(event, handler);
                    },
                    querySelector: () => null,
                    get value() { return inputValue; },
                    set value(val) { inputValue = val; }
                }),
                body: { appendChild: () => {} },
                addEventListener: (event, handler) => {
                    eventHandlers.set(event, handler);
                }
            };

            const carbonBar = new CarbonBar(mockDocument);
            const toolCaller = new ToolCaller();

            // Register a test command handler
            carbonBar.processCommand = async (cmd) => {
                messages.push(cmd);
                return { success: true, result: `Processed: ${cmd}` };
            };

            // Simulate user entering a command
            inputValue = 'test command';
            
            // Simulate Enter key press
            const keydownHandler = eventHandlers.get('keydown');
            TestRunner.assert(keydownHandler, 'Keydown handler should be registered');
            
            // Trigger the command processing
            await keydownHandler({ key: 'Enter', target: { value: inputValue } });

            // Verify command flow
            TestRunner.assert(messages.length === 1, 'Command should be processed');
            TestRunner.assert(messages[0] === 'test command', 'Command should match input');
            TestRunner.assert(carbonBar.commandHistory.length === 1, 'Command should be added to history');
            
            // Clean up
            toolCaller.reset();
            carbonBar.hide();
        }
    },
    {
        name: 'Error Handling in Tool Execution',
        fn: async () => {
            let inputValue = '';
            let eventHandlers = new Map();
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: { add: () => {}, remove: () => {} },
                    appendChild: () => {},
                    addEventListener: (event, handler) => {
                        eventHandlers.set(event, handler);
                    },
                    querySelector: () => null,
                    get value() { return inputValue; },
                    set value(val) { inputValue = val; }
                }),
                body: { appendChild: () => {} },
                addEventListener: (event, handler) => {
                    eventHandlers.set(event, handler);
                }
            };

            const carbonBar = new CarbonBar(mockDocument);
            const toolCaller = new ToolCaller();

            // Register a tool that throws an error
            const errorTool = {
                name: 'error-tool',
                description: 'A tool that throws an error',
                parameters: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' }
                    }
                },
                execute: async () => {
                    throw new Error('Test error');
                }
            };

            toolCaller.registerTool('error', errorTool);
            
            // Simulate user entering a command
            inputValue = 'error-tool {"message": "should fail"}';
            
            // Simulate Enter key press
            const keydownHandler = eventHandlers.get('keydown');
            TestRunner.assert(keydownHandler, 'Keydown handler should be registered');
            
            // Trigger the command processing
            await keydownHandler({ key: 'Enter', target: { value: inputValue } });

            // Verify error handling
            TestRunner.assert(carbonBar.messages.length > 0, 'Error should be recorded in message history');
            
            // Clean up
            toolCaller.reset();
            carbonBar.hide();
        }
    }
];

export async function runIntegrationTests() {
    return TestRunner.runTestSuite('Integration Tests', tests);
} 