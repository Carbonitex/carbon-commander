import { TestRunner } from '../../TestRunner.js';
import { JiraTools } from '../../../tools/external/JiraTools.js';

const tests = [
    {
        name: 'Test page load filter',
        fn: async () => {
            // Should match Jira Cloud domain
            const mockWindow1 = { location: { hostname: 'company.atlassian.net' } };
            TestRunner.assert(JiraTools._CarbonBarPageLoadFilter(mockWindow1), 
                'Should match atlassian.net domain');

            // Should match Jira Server path
            const mockWindow2 = { location: { hostname: 'company.com', pathname: '/jira/software' } };
            TestRunner.assert(JiraTools._CarbonBarPageLoadFilter(mockWindow2),
                'Should match /jira path');

            // Should not match other domains
            const mockWindow3 = { location: { hostname: 'example.com', pathname: '/' } };
            TestRunner.assert(!JiraTools._CarbonBarPageLoadFilter(mockWindow3),
                'Should not match unrelated domain');
        }
    },
    {
        name: 'Test get sprints',
        fn: async () => {
            const mockScope = TestRunner.createMockScope();
            
            // Test with just board ID
            const result1 = await JiraTools.GetSprints.execute(mockScope, { board_id: '123' });
            TestRunner.assert(result1.success, 'Should return success');
            TestRunner.assertContains(result1.result.url, '/board/123/sprint', 'Should have correct endpoint');

            // Test with state filter
            const result2 = await JiraTools.GetSprints.execute(mockScope, { 
                board_id: '123',
                state: 'active'
            });
            TestRunner.assert(result2.success, 'Should return success');
            TestRunner.assertContains(result2.result.url, 'state=active', 'Should include state parameter');
        }
    },
    {
        name: 'Test read sprint board',
        fn: async () => {
            const mockScope = TestRunner.createMockScope();
            
            // Test with just board ID
            const result1 = await JiraTools.ReadSprintBoard.execute(mockScope, { board_id: '123' });
            TestRunner.assert(result1.success, 'Should return success');
            TestRunner.assertContains(result1.result.url, '/board/123/issue', 'Should have correct endpoint');

            // Test with sprint ID
            const result2 = await JiraTools.ReadSprintBoard.execute(mockScope, { 
                board_id: '123',
                sprint_id: '456'
            });
            TestRunner.assert(result2.success, 'Should return success');
            TestRunner.assertContains(result2.result.url, 'sprint=456', 'Should include sprint parameter');
        }
    },
    {
        name: 'Test create issue',
        fn: async () => {
            const mockScope = TestRunner.createMockScope();
            
            const result = await JiraTools.CreateIssue.execute(mockScope, {
                project_key: 'PROJ',
                issue_type: 'bug',
                summary: 'Test bug',
                description: 'Test description',
                priority: 'High',
                assignee: 'johndoe',
                sprint_id: '789'
            });

            TestRunner.assert(result.success, 'Should return success');
            TestRunner.assertContains(result.result.url, '/issue', 'Should hit issue endpoint');
            
            const data = result.result.data;
            TestRunner.assertEquals(data.fields.project.key, 'PROJ', 'Should have correct project key');
            TestRunner.assertEquals(data.fields.issuetype.name, 'bug', 'Should have correct issue type');
            TestRunner.assertEquals(data.fields.summary, 'Test bug', 'Should have correct summary');
        }
    },
    {
        name: 'Test change issue status',
        fn: async () => {
            const mockScope = {
                ...TestRunner.createMockScope(),
                $http: {
                    get: async (url) => ({
                        data: {
                            transitions: [
                                { id: '1', name: 'To Do' },
                                { id: '2', name: 'In Progress' },
                                { id: '3', name: 'Done' }
                            ]
                        }
                    }),
                    post: async (url, data) => ({ data: { success: true } })
                }
            };
            
            const result = await JiraTools.ChangeIssueStatus.execute(mockScope, {
                issue_key: 'PROJ-123',
                status: 'In Progress'
            });

            TestRunner.assert(result.success, 'Should return success');
            TestRunner.assertContains(result.result, 'PROJ-123', 'Should reference issue key');
            TestRunner.assertContains(result.result, 'In Progress', 'Should reference new status');
        }
    },
    {
        name: 'Test change issue status - invalid transition',
        fn: async () => {
            const mockScope = {
                ...TestRunner.createMockScope(),
                $http: {
                    get: async (url) => ({
                        data: {
                            transitions: [
                                { id: '1', name: 'To Do' },
                                { id: '2', name: 'In Progress' }
                            ]
                        }
                    })
                }
            };
            
            const result = await JiraTools.ChangeIssueStatus.execute(mockScope, {
                issue_key: 'PROJ-123',
                status: 'Invalid Status'
            });

            TestRunner.assert(!result.success, 'Should return failure');
            TestRunner.assertContains(result.error, 'not available', 'Should indicate invalid transition');
        }
    }
];

export async function runJiraTests() {
    return TestRunner.runTestSuite('Jira Tools', tests);
} 