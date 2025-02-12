class HackerNewsTools {
    static name = "HackerNewsTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('news.ycombinator.com');
    }

    static ReadPage = {
        function: {
            name: 'read_hn_page',
            description: 'Read a specific page from Hacker News',
            parameters: {
                properties: {
                    page_number: {
                        type: 'number',
                        description: 'The page number to read (defaults to 1)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const pageNum = args.page_number || 1;
                const response = await scope.$http.get(`https://news.ycombinator.com/news?p=${pageNum}`);
                
                // Parse the HTML response
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.data, 'text/html');
                
                // Extract stories
                const stories = [];
                const storyRows = doc.querySelectorAll('.athing');
                
                storyRows.forEach(row => {
                    const subtext = row.nextElementSibling;
                    const title = row.querySelector('.titleline a');
                    const score = subtext?.querySelector('.score');
                    const age = subtext?.querySelector('.age');
                    const comments = subtext?.querySelectorAll('a')[3]; // Last link is usually comments
                    
                    stories.push({
                        id: row.id,
                        title: title?.textContent,
                        url: title?.href,
                        score: score?.textContent,
                        age: age?.textContent,
                        comments: comments?.textContent,
                        commentsUrl: comments?.href ? `https://news.ycombinator.com/${comments.href}` : null
                    });
                });

                return { 
                    success: true, 
                    result: {
                        page: pageNum,
                        stories: stories
                    }
                };
            } catch (error) {
                scope.logError('Error reading HN page:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['HackerNewsTools'] = HackerNewsTools;
} else {
    window.sbaiTools = {
        'HackerNewsTools': HackerNewsTools
    };
}

export { HackerNewsTools }; 