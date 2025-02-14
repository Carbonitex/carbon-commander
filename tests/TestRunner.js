import { ccLogger } from '../src/global.js';

class TestRunner {
    static async runTest(testName, testFn) {
        try {
            ccLogger.group(`Running test: ${testName}`);
            const startTime = performance.now();
            await testFn();
            const endTime = performance.now();
            ccLogger.info(`✅ Test passed: ${testName} (${(endTime - startTime).toFixed(2)}ms)`);
            ccLogger.groupEnd();
            return true;
        } catch (error) {
            ccLogger.error(`❌ Test failed: ${testName}`);
            ccLogger.error('Error:', error);
            ccLogger.groupEnd();
            return false;
        }
    }

    static async runTestSuite(suiteName, tests) {
        ccLogger.group(`Running test suite: ${suiteName}`);
        const results = {
            total: tests.length,
            passed: 0,
            failed: 0,
            skipped: 0
        };

        for (const test of tests) {
            if (test.skip) {
                ccLogger.warn(`⚠️ Skipping test: ${test.name}`);
                results.skipped++;
                continue;
            }

            const passed = await this.runTest(test.name, test.fn);
            if (passed) {
                results.passed++;
            } else {
                results.failed++;
            }
        }

        ccLogger.info(`
Test Suite Results: ${suiteName}
------------------------
Total: ${results.total}
Passed: ${results.passed}
Failed: ${results.failed}
Skipped: ${results.skipped}
        `);
        ccLogger.groupEnd();
        return results;
    }

    static createMockScope() {
        return {
            $http: {
                get: async (url) => {
                    ccLogger.debug('Mock HTTP GET:', url);
                    return { data: { mock: true, url } };
                },
                post: async (url, data) => {
                    ccLogger.debug('Mock HTTP POST:', url, data);
                    return { data: { mock: true, url, data } };
                }
            },
            logMessage: (msg) => ccLogger.debug('[TestScope]', msg),
            logError: (msg, error) => ccLogger.error('[TestScope]', msg, error)
        };
    }

    static assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }

    static assertEquals(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected} but got ${actual}`);
        }
    }

    static assertContains(haystack, needle, message) {
        if (!haystack.includes(needle)) {
            throw new Error(message || `Expected "${haystack}" to contain "${needle}"`);
        }
    }

    static assertType(value, type, message) {
        if (typeof value !== type) {
            throw new Error(message || `Expected type ${type} but got ${typeof value}`);
        }
    }
}

export { TestRunner }; 