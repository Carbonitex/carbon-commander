import { TestRunner } from '../../TestRunner.js';
import { HackerNewsTools } from '../../../src/tools/external/HackerNewsTools.js';

const tests = [
    {
        name: 'Test page load filter',
        fn: async () => {
            // Should match HN domain
            const mockWindow1 = { location: { hostname: 'news.ycombinator.com' } };
            TestRunner.assert(HackerNewsTools._CarbonBarPageLoadFilter(mockWindow1), 
                'Should match news.ycombinator.com');

            // Should not match other domains
            const mockWindow2 = { location: { hostname: 'example.com' } };
            TestRunner.assert(!HackerNewsTools._CarbonBarPageLoadFilter(mockWindow2),
                'Should not match example.com');
        }
    },
    {
        name: 'Test read page - success case',
        fn: async () => {
            const mockScope = TestRunner.createMockScope();
            const result = await HackerNewsTools.ReadPage.execute(mockScope, { page_number: 1 });
            
            TestRunner.assert(result.success, 'Should return success');
            TestRunner.assertType(result.result.page, 'number', 'Should have page number');
            TestRunner.assert(Array.isArray(result.result.stories), 'Should have stories array');
        }
    },
    {
        name: 'Test read page - error case',
        fn: async () => {
            const mockScope = {
                ...TestRunner.createMockScope(),
                $http: {
                    get: () => { throw new Error('Network error'); }
                }
            };
            
            const result = await HackerNewsTools.ReadPage.execute(mockScope, { page_number: 1 });
            TestRunner.assert(!result.success, 'Should return failure');
            TestRunner.assert(result.error, 'Should have error message');
        }
    },
    {
        name: 'Test read page parameter validation',
        fn: async () => {
            const mockScope = TestRunner.createMockScope();
            
            // Test with no page number (should default to 1)
            const result1 = await HackerNewsTools.ReadPage.execute(mockScope, {});
            TestRunner.assertEquals(result1.result.page, 1, 'Should default to page 1');
            
            // Test with explicit page number
            const result2 = await HackerNewsTools.ReadPage.execute(mockScope, { page_number: 2 });
            TestRunner.assertEquals(result2.result.page, 2, 'Should use provided page number');
        }
    }
];

export async function runHackerNewsTests() {
    return TestRunner.runTestSuite('HackerNews Tools', tests);
} 