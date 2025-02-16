import { ccLogger } from '../src/global.js';
import { runHackerNewsTests } from './tools/external/HackerNewsToolsTest.js';
import { runJiraTests } from './tools/external/JiraToolsTest.js';
import { runMCPTests } from './tools/external/MCPToolsTest.js';
import { runCarbonBarTests } from './core/CarbonBarTest.js';
import { runServiceWorkerTests } from './core/ServiceWorkerTest.js';
import { runToolCallerTests } from './core/ToolCallerTest.js';
import { runIntegrationTests } from './integration/IntegrationTest.js';
import { runAPITests } from './integration/APITest.js';

class TestSuiteRunner {
    static suites = {
        'HackerNews': runHackerNewsTests,
        'Jira': runJiraTests,
        'MCP': runMCPTests,
        'CarbonBar': runCarbonBarTests,
        'ServiceWorker': runServiceWorkerTests,
        'ToolCaller': runToolCallerTests,
        'Integration': runIntegrationTests,
        'API': runAPITests
    };

    static async runSuite(suiteName) {
        ccLogger.group(`Running Test Suite: ${suiteName}`);
        const startTime = performance.now();
        
        let results = {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            suites: []
        };

        try {
            if (!this.suites[suiteName]) {
                throw new Error(`Test suite '${suiteName}' not found`);
            }

            const suiteResults = await this.suites[suiteName]();
            results.total = suiteResults.total;
            results.passed = suiteResults.passed;
            results.failed = suiteResults.failed;
            results.skipped = suiteResults.skipped;
            results.suites.push({
                name: suiteName,
                results: suiteResults
            });

        } catch (error) {
            ccLogger.error(`Error running suite ${suiteName}:`, error);
            results.failed++;
            results.total++;
            results.suites.push({
                name: suiteName,
                results: {
                    total: 1,
                    passed: 0,
                    failed: 1,
                    skipped: 0,
                    error: error.message
                }
            });
        }

        const endTime = performance.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        this.logResults(results, duration);
        ccLogger.groupEnd();
        return results;
    }

    static async runAllTests() {
        ccLogger.group('Running All Tests');
        const startTime = performance.now();
        
        const results = {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            suites: []
        };

        for (const [suiteName, runner] of Object.entries(this.suites)) {
            ccLogger.info(`Running ${suiteName} test suite...`);
            try {
                const suiteResults = await runner();
                results.total += suiteResults.total;
                results.passed += suiteResults.passed;
                results.failed += suiteResults.failed;
                results.skipped += suiteResults.skipped;
                results.suites.push({
                    name: suiteName,
                    results: suiteResults
                });
            } catch (error) {
                ccLogger.error(`Error running suite ${suiteName}:`, error);
                results.failed++;
                results.total++;
                results.suites.push({
                    name: suiteName,
                    results: {
                        total: 1,
                        passed: 0,
                        failed: 1,
                        skipped: 0,
                        error: error.message
                    }
                });
            }
        }

        const endTime = performance.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        this.logResults(results, duration);
        ccLogger.groupEnd();
        return results;
    }

    static logResults(results, duration) {
        ccLogger.info(`
Test Suite Final Results
=======================
Total Suites: ${results.suites.length}
Total Tests: ${results.total}
Passed: ${results.passed}
Failed: ${results.failed}
Skipped: ${results.skipped}
Duration: ${duration}s

Individual Suite Results:
${results.suites.map(suite => `
${suite.name}:
  Total: ${suite.results.total}
  Passed: ${suite.results.passed}
  Failed: ${suite.results.failed}
  Skipped: ${suite.results.skipped}
  ${suite.results.error ? `Error: ${suite.results.error}` : ''}
`).join('\n')}
        `);
    }
}

// If this script is run directly (not imported), run all tests
if (import.meta.url === new URL(window.location.href).href) {
    TestSuiteRunner.runAllTests();
}

export { TestSuiteRunner }; 