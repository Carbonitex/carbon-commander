import { ccLogger } from '../global.js';
import { runHackerNewsTests } from './tools/external/HackerNewsToolsTest.js';
import { runJiraTests } from './tools/external/JiraToolsTest.js';

class TestSuiteRunner {
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

        // Run each test suite
        const suites = [
            { name: 'HackerNews', runner: runHackerNewsTests },
            { name: 'Jira', runner: runJiraTests }
            // Add more test suites here as they are created
        ];

        for (const suite of suites) {
            ccLogger.info(`Running ${suite.name} test suite...`);
            const suiteResults = await suite.runner();
            
            results.total += suiteResults.total;
            results.passed += suiteResults.passed;
            results.failed += suiteResults.failed;
            results.skipped += suiteResults.skipped;
            results.suites.push({
                name: suite.name,
                results: suiteResults
            });
        }

        const endTime = performance.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        // Print final results
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
`).join('\n')}
        `);

        ccLogger.groupEnd();
        return results;
    }
}

// If this script is run directly (not imported), run all tests
if (import.meta.url === new URL(window.location.href).href) {
    TestSuiteRunner.runAllTests();
}

export { TestSuiteRunner }; 