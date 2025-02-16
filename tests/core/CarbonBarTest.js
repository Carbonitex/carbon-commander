import { TestRunner } from '../TestRunner.js';
import { CarbonBar } from '../../src/chrome-carbonbar-page/carbon-commander.js';

const tests = [
    {
        name: 'CarbonBar Initialization',
        fn: async () => {
            const mockDocument = {
                createElement: (tag) => ({
                    style: {},
                    classList: {
                        add: () => {}
                    },
                    appendChild: () => {}
                }),
                body: {
                    appendChild: () => {}
                }
            };

            const carbonBar = new CarbonBar(mockDocument);
            TestRunner.assert(carbonBar, 'CarbonBar should be initialized');
        }
    },
    {
        name: 'CarbonBar UI Elements',
        fn: async () => {
            const elements = [];
            const mockDocument = {
                createElement: (tag) => {
                    const element = {
                        style: {},
                        classList: {
                            add: () => {}
                        },
                        appendChild: () => {}
                    };
                    elements.push({ tag, element });
                    return element;
                },
                body: {
                    appendChild: () => {}
                }
            };

            const carbonBar = new CarbonBar(mockDocument);
            TestRunner.assert(elements.some(e => e.tag === 'div'), 'Should create container div');
            TestRunner.assert(elements.some(e => e.tag === 'input'), 'Should create input element');
        }
    }
];

export async function runCarbonBarTests() {
    return TestRunner.runTestSuite('CarbonBar', tests);
} 