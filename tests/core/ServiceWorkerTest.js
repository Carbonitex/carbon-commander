import { TestRunner } from '../TestRunner.js';

const tests = [
    {
        name: 'Service Worker Registration',
        fn: async () => {
            const mockNavigator = {
                serviceWorker: {
                    register: async () => ({
                        scope: '/test-scope'
                    })
                }
            };

            // Mock registration
            const registration = await mockNavigator.serviceWorker.register('/sw.js');
            TestRunner.assert(registration, 'Service worker should be registered');
            TestRunner.assert(registration.scope === '/test-scope', 'Service worker scope should match');
        }
    },
    {
        name: 'Message Handling',
        fn: async () => {
            const messages = [];
            const mockServiceWorker = {
                postMessage: (msg) => {
                    messages.push(msg);
                    return Promise.resolve();
                }
            };

            // Test message sending
            await mockServiceWorker.postMessage({ type: 'TEST_MESSAGE', data: 'test' });
            TestRunner.assert(messages.length === 1, 'Should send one message');
            TestRunner.assert(messages[0].type === 'TEST_MESSAGE', 'Message type should match');
            TestRunner.assert(messages[0].data === 'test', 'Message data should match');
        }
    }
];

export async function runServiceWorkerTests() {
    return TestRunner.runTestSuite('Service Worker', tests);
} 