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

    static GetAnswers = {
        function: {
            name: 'get_answers',
            description: 'Get detailed information about answers on the current question page',
            parameters: {
                properties: {
                    sort_by: {
                        type: 'string',
                        description: 'Sort answers by (votes, newest, oldest)'
                    },
                    include_comments: {
                        type: 'boolean',
                        description: 'Whether to include comments on answers'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.href.includes('/questions/')) {
                    return { success: false, error: 'Not on a question page' };
                }

                const answers = Array.from(document.querySelectorAll('.answer')).map(answer => {
                    const answerData = {
                        id: answer.getAttribute('data-answerid'),
                        votes: answer.querySelector('.js-vote-count')?.textContent?.trim(),
                        isAccepted: answer.classList.contains('accepted-answer'),
                        content: answer.querySelector('.post-text')?.innerHTML?.trim(),
                        author: {
                            name: answer.querySelector('.user-details a')?.textContent?.trim(),
                            profile: answer.querySelector('.user-details a')?.href,
                            reputation: answer.querySelector('.reputation-score')?.textContent?.trim()
                        },
                        datePosted: answer.querySelector('.relativetime')?.getAttribute('title'),
                        isEdited: !!answer.querySelector('.lastEdited'),
                        lastEditDate: answer.querySelector('.lastEdited')?.getAttribute('title')
                    };

                    if (args.include_comments) {
                        answerData.comments = Array.from(answer.querySelectorAll('.comment')).map(comment => ({
                            text: comment.querySelector('.comment-copy')?.textContent?.trim(),
                            author: comment.querySelector('.comment-user')?.textContent?.trim(),
                            votes: comment.querySelector('.comment-score')?.textContent?.trim(),
                            date: comment.querySelector('.relativetime')?.getAttribute('title')
                        }));
                    }

                    return answerData;
                });

                // Sort answers if requested
                if (args.sort_by) {
                    switch(args.sort_by.toLowerCase()) {
                        case 'votes':
                            answers.sort((a, b) => parseInt(b.votes) - parseInt(a.votes));
                            break;
                        case 'newest':
                            answers.sort((a, b) => new Date(b.datePosted) - new Date(a.datePosted));
                            break;
                        case 'oldest':
                            answers.sort((a, b) => new Date(a.datePosted) - new Date(b.datePosted));
                            break;
                    }
                }

                return { 
                    success: true, 
                    result: {
                        total: answers.length,
                        accepted: answers.find(a => a.isAccepted)?.id,
                        answers: answers
                    }
                };
            } catch (error) {
                scope.logError('Error getting answers:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetRelatedQuestions = {
        function: {
            name: 'get_related_questions',
            description: 'Get related questions from the sidebar',
            parameters: {
                properties: {
                    include_hot_network_questions: {
                        type: 'boolean',
                        description: 'Whether to include hot network questions'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const result = {
                    linked: [],
                    related: [],
                    hot_network: []
                };

                // Get linked questions
                const linkedQuestions = document.querySelector('#linked');
                if (linkedQuestions) {
                    result.linked = Array.from(linkedQuestions.querySelectorAll('.question-hyperlink')).map(q => ({
                        title: q.textContent?.trim(),
                        url: q.href,
                        votes: q.closest('.linked').querySelector('.vote-count-post')?.textContent?.trim()
                    }));
                }

                // Get related questions
                const relatedQuestions = document.querySelector('#related');
                if (relatedQuestions) {
                    result.related = Array.from(relatedQuestions.querySelectorAll('.question-hyperlink')).map(q => ({
                        title: q.textContent?.trim(),
                        url: q.href,
                        votes: q.closest('.related').querySelector('.vote-count-post')?.textContent?.trim()
                    }));
                }

                // Get hot network questions if requested
                if (args.include_hot_network_questions) {
                    const hotQuestions = document.querySelector('.hot-network-questions');
                    if (hotQuestions) {
                        result.hot_network = Array.from(hotQuestions.querySelectorAll('li')).map(q => ({
                            title: q.querySelector('a')?.textContent?.trim(),
                            url: q.querySelector('a')?.href,
                            site: q.querySelector('.site-icon')?.title
                        }));
                    }
                }

                return { success: true, result };
            } catch (error) {
                scope.logError('Error getting related questions:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetQuestionDetails = {
        function: {
            name: 'get_question_details',
            description: 'Get detailed information about the current question',
            parameters: {
                properties: {
                    include_comments: {
                        type: 'boolean',
                        description: 'Whether to include comments on the question'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.href.includes('/questions/')) {
                    return { success: false, error: 'Not on a question page' };
                }

                const questionEl = document.querySelector('.question');
                if (!questionEl) {
                    return { success: false, error: 'Question element not found' };
                }

                const questionData = {
                    id: questionEl.getAttribute('data-questionid'),
                    title: document.querySelector('#question-header h1')?.textContent?.trim(),
                    content: questionEl.querySelector('.post-text')?.innerHTML?.trim(),
                    votes: questionEl.querySelector('.js-vote-count')?.textContent?.trim(),
                    views: document.querySelector('.js-view-count')?.textContent?.trim(),
                    tags: Array.from(questionEl.querySelectorAll('.post-tag')).map(tag => tag.textContent),
                    author: {
                        name: questionEl.querySelector('.user-details a')?.textContent?.trim(),
                        profile: questionEl.querySelector('.user-details a')?.href,
                        reputation: questionEl.querySelector('.reputation-score')?.textContent?.trim()
                    },
                    datePosted: questionEl.querySelector('.relativetime')?.getAttribute('title'),
                    isEdited: !!questionEl.querySelector('.lastEdited'),
                    lastEditDate: questionEl.querySelector('.lastEdited')?.getAttribute('title'),
                    bounty: {
                        active: !!document.querySelector('.bounty-notification'),
                        amount: document.querySelector('.bounty-award')?.textContent?.trim(),
                        expires: document.querySelector('.bounty-notification .relativetime')?.getAttribute('title')
                    }
                };

                if (args.include_comments) {
                    questionData.comments = Array.from(questionEl.querySelectorAll('.comment')).map(comment => ({
                        text: comment.querySelector('.comment-copy')?.textContent?.trim(),
                        author: comment.querySelector('.comment-user')?.textContent?.trim(),
                        votes: comment.querySelector('.comment-score')?.textContent?.trim(),
                        date: comment.querySelector('.relativetime')?.getAttribute('title')
                    }));
                }

                return { success: true, result: questionData };
            } catch (error) {
                scope.logError('Error getting question details:', error);
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