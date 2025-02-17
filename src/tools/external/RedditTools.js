class RedditTools {
    static name = "RedditTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('reddit.com');
    }

    static GetPostInfo = {
        function: {
            name: 'get_post_info',
            description: 'Get detailed information about the current Reddit post',
            parameters: {
                properties: {
                    include_comments: {
                        type: 'boolean',
                        description: 'Whether to include top-level comments'
                    },
                    comment_limit: {
                        type: 'number',
                        description: 'Maximum number of comments to return (default: 10)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/comments/')) {
                    return { success: false, error: 'Not on a Reddit post page' };
                }

                const post = document.querySelector('div[data-test-id="post-content"]');
                if (!post) {
                    return { success: false, error: 'Post content not found' };
                }

                const postData = {
                    title: post.querySelector('h1')?.textContent?.trim(),
                    author: post.querySelector('a[data-testid="post_author_link"]')?.textContent?.trim(),
                    score: post.querySelector('[data-test-id="post-content"] [id^="vote-arrows"] div')?.textContent?.trim(),
                    upvoteRatio: post.querySelector('div[data-test-id="post-content"] span:-webkit-any(span[title*="upvoted"])'),
                    content: post.querySelector('div[data-click-id="text"] div')?.innerHTML?.trim(),
                    subreddit: document.querySelector('a[data-click-id="subreddit"]')?.textContent?.trim(),
                    postTime: post.querySelector('span[data-click-id="timestamp"]')?.getAttribute('title'),
                    url: window.location.href,
                    isLocked: !!document.querySelector('span[data-testid="post_locked"]'),
                    isNSFW: !!document.querySelector('span[data-testid="post_nsfw"]'),
                    isSpoiler: !!document.querySelector('span[data-testid="post_spoiler"]')
                };

                if (args.include_comments) {
                    const commentLimit = args.comment_limit || 10;
                    const comments = Array.from(document.querySelectorAll('div[data-testid="comment"]'))
                        .slice(0, commentLimit)
                        .map(comment => ({
                            author: comment.querySelector('a[data-testid="comment_author"]')?.textContent?.trim(),
                            content: comment.querySelector('div[data-testid="comment"]')?.innerHTML?.trim(),
                            score: comment.querySelector('div[id^="vote-arrows"]')?.textContent?.trim(),
                            timestamp: comment.querySelector('a time')?.getAttribute('title'),
                            isOp: !!comment.querySelector('span[data-testid="op"]'),
                            isStickied: !!comment.querySelector('span[data-testid="stickied"]')
                        }));

                    postData.comments = comments;
                }

                return { success: true, result: postData };
            } catch (error) {
                scope.logError('Error getting Reddit post info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetSubredditInfo = {
        function: {
            name: 'get_subreddit_info',
            description: 'Get information about the current subreddit',
            parameters: {
                properties: {
                    include_posts: {
                        type: 'boolean',
                        description: 'Whether to include recent posts'
                    },
                    post_limit: {
                        type: 'number',
                        description: 'Maximum number of posts to return (default: 10)'
                    },
                    sort_by: {
                        type: 'string',
                        description: 'Sort posts by (hot, new, top, rising)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const subredditInfo = {
                    name: document.querySelector('h1')?.textContent?.trim(),
                    description: document.querySelector('div[data-test-id="subreddit-sidebar"] div[data-click-id="text"]')?.textContent?.trim(),
                    subscribers: document.querySelector('div[data-test-id="subreddit-sidebar"] div:-webkit-any(div[title*="members"])')?.textContent?.trim(),
                    online: document.querySelector('div[data-test-id="subreddit-sidebar"] div:-webkit-any(div[title*="online"])')?.textContent?.trim(),
                    rules: Array.from(document.querySelectorAll('div[data-test-id="subreddit-sidebar"] div[data-click-id="text"]'))
                        .map(rule => rule.textContent?.trim())
                };

                if (args.include_posts) {
                    const postLimit = args.post_limit || 10;
                    if (args.sort_by) {
                        const sortButton = document.querySelector(`button[data-click-id="${args.sort_by}"]`);
                        if (sortButton) {
                            sortButton.click();
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for posts to load
                        }
                    }

                    const posts = Array.from(document.querySelectorAll('div[data-testid="post-container"]'))
                        .slice(0, postLimit)
                        .map(post => ({
                            title: post.querySelector('h3')?.textContent?.trim(),
                            author: post.querySelector('a[data-testid="post_author_link"]')?.textContent?.trim(),
                            score: post.querySelector('div[id^="vote-arrows"]')?.textContent?.trim(),
                            commentCount: post.querySelector('a[data-test-id="comments-page-link-num-comments"]')?.textContent?.trim(),
                            url: post.querySelector('a[data-click-id="body"]')?.href,
                            isStickied: !!post.querySelector('span[data-testid="stickied"]'),
                            isNSFW: !!post.querySelector('span[data-testid="post_nsfw"]')
                        }));

                    subredditInfo.posts = posts;
                }

                return { success: true, result: subredditInfo };
            } catch (error) {
                scope.logError('Error getting subreddit info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SearchReddit = {
        function: {
            name: 'search_reddit',
            description: 'Search Reddit posts and subreddits',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    subreddit: {
                        type: 'string',
                        description: 'Limit search to specific subreddit'
                    },
                    type: {
                        type: 'string',
                        description: 'Type of results to return (posts, subreddits, all)'
                    },
                    time: {
                        type: 'string',
                        description: 'Time period (hour, day, week, month, year, all)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 10)'
                    }
                },
                required: ['query']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = 'https://www.reddit.com/search.json';
                const params = new URLSearchParams({
                    q: args.query,
                    limit: args.limit || 10,
                    t: args.time || 'all',
                    type: args.type || 'all'
                });

                if (args.subreddit) {
                    endpoint = `https://www.reddit.com/r/${args.subreddit}/search.json`;
                }

                const response = await scope.$http.get(`${endpoint}?${params.toString()}`);
                
                const results = response.data.data.children.map(child => {
                    const data = child.data;
                    return {
                        title: data.title,
                        author: data.author,
                        subreddit: data.subreddit,
                        score: data.score,
                        commentCount: data.num_comments,
                        created: new Date(data.created_utc * 1000).toISOString(),
                        url: `https://reddit.com${data.permalink}`,
                        isNSFW: data.over_18
                    };
                });

                return { success: true, result: results };
            } catch (error) {
                scope.logError('Error searching Reddit:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['RedditTools'] = RedditTools;
} else {
    window.sbaiTools = {
        'RedditTools': RedditTools
    };
}

export { RedditTools }; 