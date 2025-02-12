class StackOverflowTools {
    static name = "StackOverflowTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('stackoverflow.com');
    }

    static GetPageInfo = {
        function: {
            name: 'get_so_page_info',
            description: 'Get information about the current Stack Overflow page',
            parameters: {}
        },
        execute: async function(scope, args) {
            try {
                // Get page type and relevant information
                const url = window.location.href;
                const pageInfo = {
                    type: 'unknown',
                    data: {}
                };

                // Question page
                if (url.includes('/questions/')) {
                    pageInfo.type = 'question';
                    const questionEl = document.querySelector('.question');
                    if (questionEl) {
                        pageInfo.data = {
                            title: document.querySelector('#question-header h1')?.textContent?.trim(),
                            votes: questionEl.querySelector('.js-vote-count')?.textContent?.trim(),
                            views: document.querySelector('.js-view-count')?.textContent?.trim(),
                            tags: Array.from(questionEl.querySelectorAll('.post-tag')).map(tag => tag.textContent),
                            answers: Array.from(document.querySelectorAll('.answer')).map(answer => ({
                                votes: answer.querySelector('.js-vote-count')?.textContent?.trim(),
                                isAccepted: answer.classList.contains('accepted-answer'),
                                answerId: answer.getAttribute('data-answerid')
                            }))
                        };
                    }
                }
                // Search results page
                else if (url.includes('/search')) {
                    pageInfo.type = 'search';
                    pageInfo.data = {
                        query: new URLSearchParams(window.location.search).get('q'),
                        results: Array.from(document.querySelectorAll('.question-summary')).map(result => ({
                            title: result.querySelector('.question-hyperlink')?.textContent?.trim(),
                            url: result.querySelector('.question-hyperlink')?.href,
                            votes: result.querySelector('.vote-count-post')?.textContent?.trim(),
                            answers: result.querySelector('.status strong')?.textContent?.trim(),
                            tags: Array.from(result.querySelectorAll('.post-tag')).map(tag => tag.textContent)
                        }))
                    };
                }
                // Tag page
                else if (url.includes('/tags/')) {
                    pageInfo.type = 'tag';
                    pageInfo.data = {
                        tag: document.querySelector('.post-tag')?.textContent?.trim(),
                        description: document.querySelector('.tag-wiki')?.textContent?.trim(),
                        questionCount: document.querySelector('.fs-body3')?.textContent?.trim()
                    };
                }
                // User profile page
                else if (url.includes('/users/')) {
                    pageInfo.type = 'user';
                    pageInfo.data = {
                        name: document.querySelector('[itemprop="name"]')?.textContent?.trim(),
                        reputation: document.querySelector('.reputation')?.textContent?.trim(),
                        badges: {
                            gold: document.querySelector('.badge1')?.title,
                            silver: document.querySelector('.badge2')?.title,
                            bronze: document.querySelector('.badge3')?.title
                        }
                    };
                }
                // Home page
                else if (url === 'https://stackoverflow.com/' || url === 'https://stackoverflow.com') {
                    pageInfo.type = 'home';
                    pageInfo.data = {
                        questions: Array.from(document.querySelectorAll('.question-summary')).map(question => ({
                            title: question.querySelector('.question-hyperlink')?.textContent?.trim(),
                            url: question.querySelector('.question-hyperlink')?.href,
                            votes: question.querySelector('.vote-count-post')?.textContent?.trim(),
                            answers: question.querySelector('.status strong')?.textContent?.trim(),
                            tags: Array.from(question.querySelectorAll('.post-tag')).map(tag => tag.textContent)
                        }))
                    };
                }

                return { success: true, result: pageInfo };
            } catch (error) {
                scope.logError('Error getting Stack Overflow page info:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['StackOverflowTools'] = StackOverflowTools;
} else {
    window.sbaiTools = {
        'StackOverflowTools': StackOverflowTools
    };
}

export { StackOverflowTools }; 