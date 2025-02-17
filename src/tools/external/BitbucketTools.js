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

    static GetRepositoryInfo = {
        function: {
            name: 'get_repository_info',
            description: 'Get information about the current repository',
            parameters: {
                properties: {}
            }
        },
        execute: async function(scope, args) {
            try {
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                const endpoint = `/api/2.0/repositories/${workspace}/${repo}`;
                
                const response = await scope.$http.get(endpoint);
                
                return { 
                    success: true, 
                    result: {
                        name: response.data.name,
                        full_name: response.data.full_name,
                        description: response.data.description,
                        is_private: response.data.is_private,
                        created_on: response.data.created_on,
                        updated_on: response.data.updated_on,
                        size: response.data.size,
                        language: response.data.language,
                        has_wiki: response.data.has_wiki,
                        has_issues: response.data.has_issues,
                        fork_policy: response.data.fork_policy,
                        mainbranch: response.data.mainbranch
                    }
                };
            } catch (error) {
                scope.logError('Error getting repository info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetBranches = {
        function: {
            name: 'get_branches',
            description: 'Get list of branches in the repository',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query to filter branches'
                    },
                    sort: {
                        type: 'string',
                        description: 'Sort branches by (name, date)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                let endpoint = `/api/2.0/repositories/${workspace}/${repo}/refs/branches`;
                
                const params = new URLSearchParams();
                if (args.query) params.append('q', args.query);
                if (args.sort) params.append('sort', args.sort);
                
                if (params.toString()) {
                    endpoint += `?${params.toString()}`;
                }

                const response = await scope.$http.get(endpoint);
                
                const branches = response.data.values.map(branch => ({
                    name: branch.name,
                    target: {
                        hash: branch.target.hash,
                        author: branch.target.author,
                        date: branch.target.date,
                        message: branch.target.message
                    }
                }));

                return { success: true, result: branches };
            } catch (error) {
                scope.logError('Error getting branches:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CompareBranches = {
        function: {
            name: 'compare_branches',
            description: 'Compare two branches and get the diff',
            parameters: {
                properties: {
                    source: {
                        type: 'string',
                        description: 'Source branch name'
                    },
                    target: {
                        type: 'string',
                        description: 'Target branch name'
                    }
                },
                required: ['source', 'target']
            }
        },
        execute: async function(scope, args) {
            try {
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                const endpoint = `/api/2.0/repositories/${workspace}/${repo}/diff/${args.source}..${args.target}`;
                
                const response = await scope.$http.get(endpoint);
                
                return { 
                    success: true, 
                    result: {
                        diff: response.data,
                        compare_url: `https://bitbucket.org/${workspace}/${repo}/branches/compare/${args.source}%0D${args.target}`
                    }
                };
            } catch (error) {
                scope.logError('Error comparing branches:', error);
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