class JiraTools {
    static name = "JiraTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Match Jira Cloud or Server URLs
        return window.location.hostname.includes('atlassian.net') || 
               window.location.pathname.includes('/jira/');
    }

    static GetSprints = {
        function: {
            name: 'get_sprints',
            description: 'Get list of sprints for a board',
            parameters: {
                properties: {
                    board_id: {
                        type: 'string',
                        description: 'The ID of the board to get sprints from'
                    },
                    state: {
                        type: 'string',
                        description: 'Filter sprints by state (active, future, closed)'
                    }
                },
                required: ['board_id']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = `/rest/agile/1.0/board/${args.board_id}/sprint`;
                if (args.state) {
                    endpoint += `?state=${args.state}`;
                }
                
                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error getting sprints:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadSprintBoard = {
        function: {
            name: 'read_sprint_board',
            description: 'Get all issues in a sprint board',
            parameters: {
                properties: {
                    board_id: {
                        type: 'string',
                        description: 'The ID of the board to read'
                    },
                    sprint_id: {
                        type: 'string',
                        description: 'The ID of the sprint to read (optional)'
                    }
                },
                required: ['board_id']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = `/rest/agile/1.0/board/${args.board_id}/issue`;
                if (args.sprint_id) {
                    endpoint += `?sprint=${args.sprint_id}`;
                }
                
                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading sprint board:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateIssue = {
        function: {
            name: 'create_issue',
            description: 'Create a new issue (bug or task)',
            parameters: {
                properties: {
                    project_key: {
                        type: 'string',
                        description: 'The project key (e.g., "PROJ")'
                    },
                    issue_type: {
                        type: 'string',
                        description: 'Type of issue (bug, task)'
                    },
                    summary: {
                        type: 'string',
                        description: 'Issue summary/title'
                    },
                    description: {
                        type: 'string',
                        description: 'Detailed description of the issue'
                    },
                    priority: {
                        type: 'string',
                        description: 'Issue priority (Highest, High, Medium, Low, Lowest)'
                    },
                    assignee: {
                        type: 'string',
                        description: 'Username of the assignee'
                    },
                    sprint_id: {
                        type: 'string',
                        description: 'ID of the sprint to add the issue to'
                    }
                },
                required: ['project_key', 'issue_type', 'summary']
            }
        },
        execute: async function(scope, args) {
            try {
                const issueData = {
                    fields: {
                        project: { key: args.project_key },
                        issuetype: { name: args.issue_type },
                        summary: args.summary,
                        description: args.description,
                        priority: args.priority ? { name: args.priority } : undefined,
                        assignee: args.assignee ? { name: args.assignee } : undefined
                    }
                };

                // Create the issue
                const response = await scope.$http.post('/rest/api/2/issue', issueData);
                
                // If sprint_id is provided, add issue to sprint
                if (args.sprint_id && response.data.id) {
                    await scope.$http.post(`/rest/agile/1.0/sprint/${args.sprint_id}/issue`, {
                        issues: [response.data.id]
                    });
                }

                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error creating issue:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ChangeIssueStatus = {
        function: {
            name: 'change_issue_status',
            description: 'Change the status of an issue',
            parameters: {
                properties: {
                    issue_key: {
                        type: 'string',
                        description: 'The issue key (e.g., "PROJ-123")'
                    },
                    status: {
                        type: 'string',
                        description: 'The new status to set'
                    }
                },
                required: ['issue_key', 'status']
            }
        },
        execute: async function(scope, args) {
            try {
                // First get available transitions
                const transitionsResponse = await scope.$http.get(
                    `/rest/api/2/issue/${args.issue_key}/transitions`
                );
                
                // Find the transition ID that matches the requested status
                const transition = transitionsResponse.data.transitions.find(
                    t => t.name.toLowerCase() === args.status.toLowerCase()
                );

                if (!transition) {
                    throw new Error(`Status transition to "${args.status}" not available`);
                }

                // Perform the transition
                const response = await scope.$http.post(
                    `/rest/api/2/issue/${args.issue_key}/transitions`,
                    { transition: { id: transition.id } }
                );

                return { success: true, result: `Issue ${args.issue_key} status changed to ${args.status}` };
            } catch (error) {
                scope.logError('Error changing issue status:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['JiraTools'] = JiraTools;
} else {
    window.sbaiTools = {
        'JiraTools': JiraTools
    };
}

export { JiraTools }; 