import { ccLogger } from '../src/global.js';
import { HackerNewsTests } from './suites/HackerNewsTests.js';
import { JiraTests } from './suites/JiraTests.js';
import { MCPTests } from './suites/MCPTests.js';
import { CarbonBarTests } from './suites/CarbonBarTests.js';
import { ServiceWorkerTests } from './suites/ServiceWorkerTests.js';
import { ToolCallerTests } from './suites/ToolCallerTests.js';
import { IntegrationTests } from './suites/IntegrationTests.js';
import { APITests } from './suites/APITests.js';

class TestSuiteRunner {
    static suites = {
        HackerNews: HackerNewsTests,
        Jira: JiraTests,
        MCP: MCPTests,
        CarbonBar: CarbonBarTests,
        ServiceWorker: ServiceWorkerTests,
        ToolCaller: ToolCallerTests,
        Integration: IntegrationTests,
        API: APITests
    };

    static async runSuite(suiteName) {
        ccLogger.group(`Running Test Suite: ${suiteName}`);
        
        const suite = this.suites[suiteName];
        if (!suite) {
            const error = `Test suite '${suiteName}' not found`;
            ccLogger.error(error);
            ccLogger.groupEnd();
            throw new Error(error);
        }

        const results = {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0
        };

        try {
            ccLogger.info(`Initializing ${suiteName} test suite...`);
            const suiteInstance = new suite();
            const tests = Object.getOwnPropertyNames(Object.getPrototypeOf(suiteInstance))
                .filter(prop => prop.startsWith('test') && typeof suiteInstance[prop] === 'function');

            results.total = tests.length;
            ccLogger.info(`Found ${tests.length} tests to run`);

            for (const testName of tests) {
                ccLogger.group(`Running test: ${testName}`);
                try {
                    ccLogger.time(testName);
                    await suiteInstance[testName]();
                    ccLogger.timeEnd(testName);
                    results.passed++;
                    ccLogger.info(`✓ Test passed: ${testName}`);
                } catch (error) {
                    ccLogger.timeEnd(testName);
                    if (error.message === 'SKIP') {
                        results.skipped++;
                        ccLogger.warn(`⚠ Test skipped: ${testName}`);
                    } else {
                        results.failed++;
                        ccLogger.error(`✗ Test failed: ${testName}`);
                        ccLogger.error(`Error: ${error.message}`);
                        if (error.stack) {
                            ccLogger.error(`Stack: ${error.stack}`);
                        }
                    }
                }
                ccLogger.groupEnd();
            }
        } catch (error) {
            ccLogger.error(`Fatal error in suite ${suiteName}:`, error);
            results.failed++;
        }

        ccLogger.group(`${suiteName} Suite Results`);
        ccLogger.info(`Total: ${results.total}`);
        ccLogger.info(`Passed: ${results.passed}`);
        ccLogger.info(`Failed: ${results.failed}`);
        ccLogger.info(`Skipped: ${results.skipped}`);
        ccLogger.groupEnd();
        
        ccLogger.groupEnd();
        return results;
    }

    static async runAllTests() {
        ccLogger.group('Running All Test Suites');
        
        const results = {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0
        };

        for (const suiteName of Object.keys(this.suites)) {
            try {
                const suiteResults = await this.runSuite(suiteName);
                results.total += suiteResults.total;
                results.passed += suiteResults.passed;
                results.failed += suiteResults.failed;
                results.skipped += suiteResults.skipped;
            } catch (error) {
                ccLogger.error(`Failed to run suite ${suiteName}:`, error);
            }
        }

        ccLogger.group('Final Results');
        ccLogger.info(`Total Tests: ${results.total}`);
        ccLogger.info(`Passed: ${results.passed}`);
        ccLogger.info(`Failed: ${results.failed}`);
        ccLogger.info(`Skipped: ${results.skipped}`);
        ccLogger.groupEnd();
        
        ccLogger.groupEnd();
        return results;
    }
}

// If this script is run directly (not imported), run all tests
if (import.meta.url === new URL(window.location.href).href) {
    TestSuiteRunner.runAllTests();
}

export { TestSuiteRunner }; 