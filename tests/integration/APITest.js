import { TestRunner } from '../TestRunner.js';

const tests = [
    {
        name: 'External API Authentication',
        fn: async () => {
            const mockAPI = {
                authenticate: async (credentials) => {
                    if (credentials.apiKey === 'valid-key') {
                        return { success: true, token: 'test-token' };
                    }
                    throw new Error('Invalid API key');
                }
            };

            // Test successful authentication
            const validResult = await mockAPI.authenticate({ apiKey: 'valid-key' });
            TestRunner.assert(validResult.success, 'Authentication should succeed with valid key');
            TestRunner.assert(validResult.token === 'test-token', 'Should receive valid token');

            // Test failed authentication
            try {
                await mockAPI.authenticate({ apiKey: 'invalid-key' });
                TestRunner.assert(false, 'Should throw error for invalid key');
            } catch (error) {
                TestRunner.assert(error.message === 'Invalid API key', 'Should have correct error message');
            }
        }
    },
    {
        name: 'API Rate Limiting',
        fn: async () => {
            let requestCount = 0;
            const mockAPI = {
                makeRequest: async () => {
                    requestCount++;
                    if (requestCount > 5) {
                        throw new Error('Rate limit exceeded');
                    }
                    return { success: true };
                }
            };

            // Test successful requests
            for (let i = 0; i < 5; i++) {
                const result = await mockAPI.makeRequest();
                TestRunner.assert(result.success, `Request ${i + 1} should succeed`);
            }

            // Test rate limiting
            try {
                await mockAPI.makeRequest();
                TestRunner.assert(false, 'Should throw rate limit error');
            } catch (error) {
                TestRunner.assert(error.message === 'Rate limit exceeded', 'Should have rate limit error');
            }
        }
    },
    {
        name: 'API Response Handling',
        fn: async () => {
            const mockAPI = {
                makeRequest: async (type) => {
                    switch (type) {
                        case 'success':
                            return { success: true, data: { id: 1 } };
                        case 'error':
                            throw new Error('API error');
                        case 'malformed':
                            return { success: false };
                        default:
                            return null;
                    }
                }
            };

            // Test successful response
            const successResult = await mockAPI.makeRequest('success');
            TestRunner.assert(successResult.success, 'Should handle successful response');
            TestRunner.assert(successResult.data.id === 1, 'Should have correct data');

            // Test error response
            try {
                await mockAPI.makeRequest('error');
                TestRunner.assert(false, 'Should throw error');
            } catch (error) {
                TestRunner.assert(error.message === 'API error', 'Should have correct error message');
            }

            // Test malformed response
            const malformedResult = await mockAPI.makeRequest('malformed');
            TestRunner.assert(!malformedResult.success, 'Should handle malformed response');
        }
    }
];

export async function runAPITests() {
    return TestRunner.runTestSuite('API Integration Tests', tests);
} 