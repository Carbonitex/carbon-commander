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
}

if(window.sbaiTools) {
    window.sbaiTools['SmarterTrackPortalTools'] = SmarterTrackPortalTools;
} else {
    window.sbaiTools = {
        'SmarterTrackPortalTools': SmarterTrackPortalTools
    };
}

export { SmarterTrackPortalTools }; 