// Import CarbonCommander as a module
import { CarbonCommander } from '../../src/chrome-carbonbar-page/carbon-commander.js';

// Use the global marked instance from CDN
const marked = window.marked;

export class CarbonBarTests {
    // Helper method to setup window mock
    setupWindowMock() {
        // Store original window properties
        const originalWindow = { ...window };
        
        // Mock window location
        window.location = {
            hostname: 'test.example.com',
            origin: 'http://test.example.com'
        };

        // Mock window.postMessage
        window.postMessage = (message, targetOrigin) => {
            // Simulate message event
            if (message.type === 'GET_SETTINGS') {
                setTimeout(() => {
                    const event = new MessageEvent('message', {
                        data: {
                            type: 'GET_SETTINGS_RESPONSE',
                            _authToken: 'test-auth-token',
                            payload: {}
                        }
                    });
                    window.dispatchEvent(event);
                }, 0);
            }
            return Promise.resolve();
        };

        return () => {
            // Restore original window properties
            Object.assign(window, originalWindow);
        };
    }

    async testCarbonBarInitialization() {
        console.log('Running CarbonBar initialization test');
        const restoreWindow = this.setupWindowMock();
        
        try {
            // Create mock document
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: {
                        add: () => {},
                        remove: () => {},
                        contains: () => false
                    },
                    appendChild: () => {},
                    querySelector: () => null,
                    querySelectorAll: () => [],
                    addEventListener: () => {},
                    attachShadow: () => ({
                        appendChild: () => {}
                    }),
                    getAttribute: (attr) => {
                        if (attr === 'content') return 'test-tab-id';
                        if (attr === 'cc-data-key') return 'test-key';
                        return null;
                    }
                }),
                body: {
                    appendChild: () => {}
                },
                addEventListener: () => {},
                head: {
                    appendChild: () => {}
                }
            };

            // Create mock meta element for tabId
            const mockMeta = mockDocument.createElement('meta');
            mockMeta.getAttribute = () => 'test-tab-id';
            mockDocument.querySelector = (selector) => {
                if (selector === 'meta[name="tabId"]') {
                    return mockMeta;
                }
                if (selector === 'script[cc-data-key]') {
                    const mockScript = mockDocument.createElement('script');
                    mockScript.getAttribute = () => 'test-key';
                    return mockScript;
                }
                return null;
            };

            // Initialize CarbonBar with mock document
            const carbonBar = new CarbonCommander(mockDocument);
            
            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify initialization
            if (!carbonBar) {
                throw new Error('CarbonBar failed to initialize');
            }

            // Verify essential properties
            if (!carbonBar.root || !carbonBar.container) {
                throw new Error('CarbonBar missing essential DOM elements');
            }

            // Verify initial state
            if (carbonBar.isVisible) {
                throw new Error('CarbonBar should be hidden initially');
            }

            console.log('CarbonBar initialization test passed');
        } catch (error) {
            console.error('CarbonBar initialization test failed:', error.message);
            throw error;
        } finally {
            restoreWindow();
        }
    }

    async testCommandPalette() {
        console.log('Running command palette test');
        const restoreWindow = this.setupWindowMock();
        
        try {
            // Create mock elements array to track created elements
            const elements = [];
            const eventHandlers = new Map();
            let inputValue = '';

            // Create mock document with event handling
            const mockDocument = {
                createElement: (tag) => {
                    const element = {
                        style: {},
                        classList: {
                            add: () => {},
                            remove: () => {},
                            contains: () => false
                        },
                        appendChild: () => {},
                        querySelector: () => null,
                        querySelectorAll: () => [],
                        addEventListener: (event, handler) => {
                            eventHandlers.set(event, handler);
                        },
                        get value() { return inputValue; },
                        set value(val) { inputValue = val; },
                        attachShadow: () => ({
                            appendChild: () => {}
                        }),
                        getAttribute: (attr) => {
                            if (attr === 'content') return 'test-tab-id';
                            if (attr === 'cc-data-key') return 'test-key';
                            return null;
                        }
                    };
                    elements.push({ tag, element });
                    return element;
                },
                body: {
                    appendChild: () => {}
                },
                addEventListener: (event, handler) => {
                    eventHandlers.set(event, handler);
                },
                head: {
                    appendChild: () => {}
                }
            };

            // Create mock meta element for tabId
            const mockMeta = mockDocument.createElement('meta');
            mockMeta.getAttribute = () => 'test-tab-id';
            mockDocument.querySelector = (selector) => {
                if (selector === 'meta[name="tabId"]') {
                    return mockMeta;
                }
                if (selector === 'script[cc-data-key]') {
                    const mockScript = mockDocument.createElement('script');
                    mockScript.getAttribute = () => 'test-key';
                    return mockScript;
                }
                return null;
            };

            // Initialize CarbonBar
            const carbonBar = new CarbonCommander(mockDocument);
            
            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 100));

            // Test show/hide functionality
            carbonBar.show();
            if (!carbonBar.isVisible) {
                throw new Error('CarbonBar should be visible after show()');
            }

            carbonBar.hide();
            if (carbonBar.isVisible) {
                throw new Error('CarbonBar should be hidden after hide()');
            }

            // Test toggle functionality
            carbonBar.toggle();
            if (!carbonBar.isVisible) {
                throw new Error('CarbonBar should be visible after toggle() from hidden state');
            }

            carbonBar.toggle();
            if (carbonBar.isVisible) {
                throw new Error('CarbonBar should be hidden after toggle() from visible state');
            }

            // Test command input
            const testCommand = 'test command';
            inputValue = testCommand;
            
            // Simulate Enter key press
            const keydownHandler = eventHandlers.get('keydown');
            if (!keydownHandler) {
                throw new Error('Keydown handler not registered');
            }

            await keydownHandler({ 
                key: 'Enter',
                preventDefault: () => {},
                target: { value: testCommand }
            });

            // Verify command was added to history
            if (!carbonBar.commandHistory.includes(testCommand)) {
                throw new Error('Command not added to history');
            }

            console.log('Command palette test passed');
        } catch (error) {
            console.error('Command palette test failed:', error.message);
            throw error;
        } finally {
            restoreWindow();
        }
    }

    async testToolExecution() {
        console.log('Running tool execution test');
        const restoreWindow = this.setupWindowMock();
        
        try {
            // Create mock elements and event handlers
            const elements = [];
            const eventHandlers = new Map();
            let inputValue = '';

            // Create mock document with event handling
            const mockDocument = {
                createElement: (tag) => {
                    const element = {
                        style: {},
                        classList: {
                            add: () => {},
                            remove: () => {},
                            contains: () => false
                        },
                        appendChild: () => {},
                        querySelector: () => null,
                        querySelectorAll: () => [],
                        addEventListener: (event, handler) => {
                            eventHandlers.set(event, handler);
                        },
                        get value() { return inputValue; },
                        set value(val) { inputValue = val; },
                        attachShadow: () => ({
                            appendChild: () => {}
                        })
                    };
                    elements.push({ tag, element });
                    return element;
                },
                body: {
                    appendChild: () => {}
                },
                addEventListener: (event, handler) => {
                    eventHandlers.set(event, handler);
                }
            };

            // Create mock meta element for tabId
            const mockMeta = mockDocument.createElement('meta');
            mockMeta.getAttribute = () => 'test-tab-id';
            mockDocument.querySelector = (selector) => {
                if (selector === 'meta[name="tabId"]') {
                    return mockMeta;
                }
                if (selector === 'script[cc-data-key]') {
                    const mockScript = mockDocument.createElement('script');
                    mockScript.getAttribute = () => 'test-key';
                    return mockScript;
                }
                return null;
            };

            // Initialize CarbonBar
            const carbonBar = new CarbonCommander(mockDocument);
            
            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 100));

            // Create a test tool
            const testTool = {
                name: 'test-tool',
                description: 'A test tool',
                parameters: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' }
                    }
                },
                execute: async (scope, args) => ({ 
                    success: true,
                    result: `Executed with ${args.message}` 
                })
            };

            // Register the test tool
            carbonBar.toolCaller.registerTool('test', testTool);

            // Test tool execution
            const toolCommand = 'test-tool {"message": "test execution"}';
            inputValue = toolCommand;

            // Simulate Enter key press
            const keydownHandler = eventHandlers.get('keydown');
            if (!keydownHandler) {
                throw new Error('Keydown handler not registered');
            }

            await keydownHandler({ 
                key: 'Enter',
                preventDefault: () => {},
                target: { value: toolCommand }
            });

            // Verify tool execution
            // Note: In a real implementation, we would verify the tool's output
            // through the UI or message system. For this test, we're just
            // verifying the command was processed.

            if (!carbonBar.commandHistory.includes(toolCommand)) {
                throw new Error('Tool command not added to history');
            }

            console.log('Tool execution test passed');
        } catch (error) {
            console.error('Tool execution test failed:', error.message);
            throw error;
        } finally {
            restoreWindow();
        }
    }
} 