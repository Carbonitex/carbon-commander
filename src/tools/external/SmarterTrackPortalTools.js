class SmarterTrackPortalTools {
    static name = "SmarterTrackPortalTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('portal.smartertools.com');
    }

    static ReadCommunitySection = {
        function: {
            name: 'read_community_section',
            description: 'Read a section of the SmarterTrack community portal',
            parameters: {
                properties: {
                    section: {
                        type: 'string',
                        description: 'The section to read (recent, unread, votes, my_activity)'
                    }
                },
                required: ['section']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint;
                switch(args.section.toLowerCase()) {
                    case 'recent':
                        endpoint = '/community/recent';
                        break;
                    case 'unread':
                        endpoint = '/community/unread';
                        break;
                    case 'votes':
                        endpoint = '/community/votes';
                        break;
                    case 'my_activity':
                        endpoint = '/community/my-activity';
                        break;
                    default:
                        throw new Error('Invalid section specified');
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading community section:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadCommunityPost = {
        function: {
            name: 'read_community_post',
            description: 'Read a specific community post',
            parameters: {
                properties: {
                    post_id: {
                        type: 'string',
                        description: 'The ID of the post to read'
                    }
                },
                required: ['post_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const response = await scope.$http.get(`/community/post/${args.post_id}`);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading community post:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadKnowledgeBase = {
        function: {
            name: 'read_kb',
            description: 'Search or browse the knowledge base',
            parameters: {
                properties: {
                    search_query: {
                        type: 'string',
                        description: 'Search query for the knowledge base'
                    },
                    category: {
                        type: 'string',
                        description: 'Category to browse'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = '/kb';
                if (args.search_query) {
                    endpoint = `/kb/search?q=${encodeURIComponent(args.search_query)}`;
                } else if (args.category) {
                    endpoint = `/kb/category/${encodeURIComponent(args.category)}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading knowledge base:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadTicketQueue = {
        function: {
            name: 'read_ticket_queue',
            description: 'Read tickets from a specific queue',
            parameters: {
                properties: {
                    queue_id: {
                        type: 'string',
                        description: 'The ID of the queue to read'
                    }
                },
                required: ['queue_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const response = await scope.$http.get(`/tickets/queue/${args.queue_id}`);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading ticket queue:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadAllTickets = {
        function: {
            name: 'read_all_tickets',
            description: 'Read all tickets with optional filtering',
            parameters: {
                properties: {
                    status: {
                        type: 'string',
                        description: 'Filter by ticket status (open, closed, etc.)'
                    },
                    priority: {
                        type: 'string',
                        description: 'Filter by priority (low, medium, high)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = '/tickets/all';
                const params = new URLSearchParams();
                
                if (args.status) params.append('status', args.status);
                if (args.priority) params.append('priority', args.priority);

                if (params.toString()) {
                    endpoint += `?${params.toString()}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading all tickets:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateTicket = {
        function: {
            name: 'create_ticket',
            description: 'Create a new support ticket',
            parameters: {
                properties: {
                    subject: {
                        type: 'string',
                        description: 'Subject of the ticket'
                    },
                    description: {
                        type: 'string',
                        description: 'Detailed description of the issue'
                    },
                    priority: {
                        type: 'string',
                        description: 'Ticket priority (low, normal, high, critical)'
                    },
                    department: {
                        type: 'string',
                        description: 'Department to assign the ticket to'
                    }
                },
                required: ['subject', 'description']
            }
        },
        execute: async function(scope, args) {
            try {
                const ticketData = {
                    subject: args.subject,
                    description: args.description,
                    priority: args.priority || 'normal',
                    departmentId: args.department || null
                };

                const response = await scope.$http.post('/api/v1/tickets', ticketData);
                
                return { 
                    success: true, 
                    result: {
                        ticketId: response.data.ticketId,
                        ticketNumber: response.data.ticketNumber,
                        status: response.data.status,
                        createdDate: response.data.createdDate
                    }
                };
            } catch (error) {
                scope.logError('Error creating ticket:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static UpdateTicket = {
        function: {
            name: 'update_ticket',
            description: 'Update an existing ticket',
            parameters: {
                properties: {
                    ticket_id: {
                        type: 'string',
                        description: 'ID of the ticket to update'
                    },
                    comment: {
                        type: 'string',
                        description: 'Comment to add to the ticket'
                    },
                    status: {
                        type: 'string',
                        description: 'New status for the ticket (open, closed, pending)'
                    },
                    priority: {
                        type: 'string',
                        description: 'New priority for the ticket'
                    }
                },
                required: ['ticket_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const updateData = {};
                
                if (args.comment) {
                    updateData.comment = args.comment;
                }
                if (args.status) {
                    updateData.status = args.status;
                }
                if (args.priority) {
                    updateData.priority = args.priority;
                }

                const response = await scope.$http.put(`/api/v1/tickets/${args.ticket_id}`, updateData);
                
                return { 
                    success: true, 
                    result: {
                        ticketId: response.data.ticketId,
                        status: response.data.status,
                        lastUpdated: response.data.lastUpdated
                    }
                };
            } catch (error) {
                scope.logError('Error updating ticket:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SearchKnowledgeBase = {
        function: {
            name: 'search_kb',
            description: 'Search the knowledge base',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    category: {
                        type: 'string',
                        description: 'Category to search in'
                    },
                    page: {
                        type: 'number',
                        description: 'Page number (default: 1)'
                    },
                    page_size: {
                        type: 'number',
                        description: 'Results per page (default: 20)'
                    }
                },
                required: ['query']
            }
        },
        execute: async function(scope, args) {
            try {
                const params = {
                    q: args.query,
                    page: args.page || 1,
                    pageSize: args.page_size || 20
                };
                
                if (args.category) {
                    params.category = args.category;
                }

                const response = await scope.$http.get('/api/v1/kb/search', { params });
                
                const articles = response.data.articles.map(article => ({
                    id: article.id,
                    title: article.title,
                    summary: article.summary,
                    category: article.category,
                    lastUpdated: article.lastUpdated,
                    url: `/kb/article/${article.id}`
                }));

                return { 
                    success: true, 
                    result: {
                        articles: articles,
                        totalResults: response.data.totalResults,
                        currentPage: response.data.currentPage,
                        totalPages: response.data.totalPages
                    }
                };
            } catch (error) {
                scope.logError('Error searching knowledge base:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetKBArticle = {
        function: {
            name: 'get_kb_article',
            description: 'Get a specific knowledge base article',
            parameters: {
                properties: {
                    article_id: {
                        type: 'string',
                        description: 'ID of the article to retrieve'
                    }
                },
                required: ['article_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const response = await scope.$http.get(`/api/v1/kb/articles/${args.article_id}`);
                
                return { 
                    success: true, 
                    result: {
                        id: response.data.id,
                        title: response.data.title,
                        content: response.data.content,
                        category: response.data.category,
                        tags: response.data.tags,
                        lastUpdated: response.data.lastUpdated,
                        relatedArticles: response.data.relatedArticles?.map(article => ({
                            id: article.id,
                            title: article.title,
                            url: `/kb/article/${article.id}`
                        })) || []
                    }
                };
            } catch (error) {
                scope.logError('Error getting KB article:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['SmarterTrackPortalTools'] = SmarterTrackPortalTools;
} else {
    window.sbaiTools = {
        'SmarterTrackPortalTools': SmarterTrackPortalTools
    };
}

export { SmarterTrackPortalTools }; 