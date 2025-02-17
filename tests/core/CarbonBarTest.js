import { TestRunner } from '../TestRunner.js';
import { CarbonCommander } from '../../src/chrome-carbonbar-page/carbon-commander.js';

const tests = [
    {
        name: 'CarbonBar Initialization',
        fn: async () => {
            // Create and add tabId meta tag to document
            const tabIdMeta = document.createElement('meta');
            tabIdMeta.setAttribute('name', 'tabId');
            tabIdMeta.setAttribute('content', 'test-tab-id');
            document.head.appendChild(tabIdMeta);

            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: {
                        add: () => {}
                    },
                    appendChild: () => {},
                    getAttribute: (attr) => {
                        if (attr === 'content' && tag === 'meta') return 'test-tab-id';
                        return null;
                    }
                }),
                body: {
                    appendChild: () => {}
                },
                querySelector: (selector) => {
                    if (selector === 'meta[name="tabId"]') return tabIdMeta;
                    return null;
                }
            };

            const carbonBar = new CarbonCommander(mockDocument);
            TestRunner.assert(carbonBar, 'CarbonBar should be initialized');

            // Clean up
            tabIdMeta.remove();
        }
    },
    {
        name: 'CarbonBar UI Elements',
        fn: async () => {
            // Create and add tabId meta tag to document
            const tabIdMeta = document.createElement('meta');
            tabIdMeta.setAttribute('name', 'tabId');
            tabIdMeta.setAttribute('content', 'test-tab-id');
            document.head.appendChild(tabIdMeta);

            const elements = [];
            const mockDocument = {
                createElement: (tag) => {
                    const element = {
                        style: {},
                        classList: {
                            add: () => {}
                        },
                        appendChild: () => {},
                        getAttribute: (attr) => {
                            if (attr === 'content' && tag === 'meta') return 'test-tab-id';
                            return null;
                        }
                    };
                    elements.push({ tag, element });
                    return element;
                },
                body: {
                    appendChild: () => {}
                },
                querySelector: (selector) => {
                    if (selector === 'meta[name="tabId"]') return tabIdMeta;
                    return null;
                }
            };

            const carbonBar = new CarbonCommander(mockDocument);
            TestRunner.assert(elements.some(e => e.tag === 'div'), 'Should create container div');
            TestRunner.assert(elements.some(e => e.tag === 'input'), 'Should create input element');

            // Clean up
            tabIdMeta.remove();
        }
    }
];

export async function runCarbonBarTests() {
    return TestRunner.runTestSuite('CarbonBar', tests);
} 