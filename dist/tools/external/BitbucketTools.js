class BitbucketTools {
    static name = "BitbucketTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('bitbucket.org');
    }

    static CreatePullRequest = {
        function: {
            name: 'create_pullrequest',
            description: 'Create a new pull request',
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'Title of the pull request'
                    },
                    source_branch: {
                        type: 'string',
                        description: 'Source branch name'
                    },
                    target_branch: {
                        type: 'string',
                        description: 'Target branch name (default: main/master)'
                    },
                    description: {
                        type: 'string',
                        description: 'Description of the changes'
                    },
                    reviewers: {
                        type: 'string',
                        description: 'Comma-separated list of reviewer usernames'
                    }
                },
                required: ['title', 'source_branch']
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                const prData = {
                    title: args.title,
                    source: {
                        branch: { name: args.source_branch }
                    },
                    target: {
                        branch: { name: args.target_branch || 'main' }
                    },
                    description: args.description || '',
                    reviewers: args.reviewers ? 
                        args.reviewers.split(',').map(username => ({ username: username.trim() })) 
                        : []
                };

                const response = await scope.$http.post(
                    `/api/2.0/repositories/${workspace}/${repo}/pullrequests`,
                    prData
                );

                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error creating pull request:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetPullRequests = {
        function: {
            name: 'get_pullrequests',
            description: 'Get list of pull requests',
            parameters: {
                properties: {
                    state: {
                        type: 'string',
                        description: 'Filter by PR state (OPEN, MERGED, DECLINED, SUPERSEDED)'
                    },
                    author: {
                        type: 'string',
                        description: 'Filter by author username'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                let endpoint = `/api/2.0/repositories/${workspace}/${repo}/pullrequests`;
                const params = new URLSearchParams();
                
                if (args.state) params.append('state', args.state);
                if (args.author) params.append('q', `author.username="${args.author}"`);
                
                if (params.toString()) {
                    endpoint += `?${params.toString()}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error getting pull requests:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetRecentCommits = {
        function: {
            name: 'get_recent_commits',
            description: 'Get recent commits for a branch',
            parameters: {
                properties: {
                    branch: {
                        type: 'string',
                        description: 'Branch name (default: main/master)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of commits to return (default: 10)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                const branch = args.branch || 'main';
                const limit = args.limit || 10;
                
                const endpoint = `/api/2.0/repositories/${workspace}/${repo}/commits/${branch}?limit=${limit}`;
                
                const response = await scope.$http.get(endpoint);
                
                // Format the commit data
                const commits = response.data.values.map(commit => ({
                    hash: commit.hash,
                    message: commit.message,
                    author: commit.author.raw,
                    date: commit.date,
                    links: commit.links
                }));

                return { success: true, result: commits };
            } catch (error) {
                scope.logError('Error getting recent commits:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['BitbucketTools'] = BitbucketTools;
} else {
    window.sbaiTools = {
        'BitbucketTools': BitbucketTools
    };
}

export { BitbucketTools }; 