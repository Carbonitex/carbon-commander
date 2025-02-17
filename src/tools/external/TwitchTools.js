class TwitchTools {
    static name = "TwitchTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('twitch.tv');
    }

    static ListLiveStreams = {
        function: {
            name: 'list_live_streams',
            description: 'List live streams based on category',
            parameters: {
                properties: {
                    category: {
                        type: 'string',
                        description: 'Category to list streams from (following, front_page, game)'
                    },
                    game_name: {
                        type: 'string',
                        description: 'Name of the game to list streams for (required if category is "game")'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of streams to return (default: 20)'
                    }
                },
                required: ['category']
            }
        },
        execute: async function(scope, args) {
            try {
                let streams = [];
                const limit = args.limit || 20;

                // Get the GQL client from window
                const gqlClient = window.__twilightBuildID;
                if (!gqlClient) {
                    throw new Error('Twitch GQL client not found');
                }

                switch(args.category.toLowerCase()) {
                    case 'following':
                        // Get followed streams
                        const followingResponse = await scope.$http.post('/gql', {
                            operationName: 'FollowedStreams',
                            variables: {
                                limit: limit
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        streams = followingResponse.data.data.followedStreams;
                        break;

                    case 'front_page':
                        // Get front page streams
                        const frontPageResponse = await scope.$http.post('/gql', {
                            operationName: 'BrowsePage_Popular',
                            variables: {
                                limit: limit
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        streams = frontPageResponse.data.data.streams;
                        break;

                    case 'game':
                        if (!args.game_name) {
                            throw new Error('game_name is required when category is "game"');
                        }
                        // First get game ID
                        const gameResponse = await scope.$http.post('/gql', {
                            operationName: 'GamePage',
                            variables: {
                                name: args.game_name
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        const gameId = gameResponse.data.data.game.id;
                        
                        // Then get streams for that game
                        const gameStreamsResponse = await scope.$http.post('/gql', {
                            operationName: 'GameStreams',
                            variables: {
                                gameId: gameId,
                                limit: limit
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        streams = gameStreamsResponse.data.data.streams;
                        break;

                    default:
                        throw new Error('Invalid category specified');
                }

                // Format the streams data
                const formattedStreams = streams.map(stream => ({
                    id: stream.id,
                    title: stream.title,
                    broadcaster: stream.broadcaster.displayName,
                    game: stream.game?.name,
                    viewers: stream.viewersCount,
                    thumbnailUrl: stream.previewImageURL,
                    url: `https://twitch.tv/${stream.broadcaster.login}`
                }));

                return { success: true, result: formattedStreams };
            } catch (error) {
                scope.logError('Error listing streams:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static OpenStream = {
        function: {
            name: 'open_stream',
            description: 'Open a Twitch stream',
            parameters: {
                properties: {
                    username: {
                        type: 'string',
                        description: 'Username/channel name of the streamer'
                    },
                    theater_mode: {
                        type: 'boolean',
                        description: 'Whether to open in theater mode (default: false)'
                    }
                },
                required: ['username']
            }
        },
        execute: async function(scope, args) {
            try {
                let url = `https://twitch.tv/${args.username}`;
                if (args.theater_mode) {
                    url += '?mode=theater';
                }

                // Open in current window if we're already on Twitch
                if (window.location.hostname.includes('twitch.tv')) {
                    window.location.href = url;
                } else {
                    // Open in new window otherwise
                    window.open(url, '_blank');
                }

                return { 
                    success: true, 
                    result: `Opened stream: ${args.username}${args.theater_mode ? ' in theater mode' : ''}`
                };
            } catch (error) {
                scope.logError('Error opening stream:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetStreamInfo = {
        function: {
            name: 'get_stream_info',
            description: 'Get detailed information about the current stream',
            parameters: {
                properties: {
                    include_chat_info: {
                        type: 'boolean',
                        description: 'Whether to include chat information'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.match(/\/[^\/]+$/)) {
                    return { success: false, error: 'Not on a stream page' };
                }

                // Get channel name from URL
                const channelName = window.location.pathname.split('/').pop();

                // Get the GQL client from window
                const gqlClient = window.__twilightBuildID;
                if (!gqlClient) {
                    throw new Error('Twitch GQL client not found');
                }

                // Get stream information
                const streamResponse = await scope.$http.post('/gql', {
                    operationName: 'StreamPage',
                    variables: {
                        channelLogin: channelName
                    },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: gqlClient
                        }
                    }
                });

                const streamData = streamResponse.data.data.stream;
                if (!streamData) {
                    return { success: false, error: 'Stream not found or offline' };
                }

                const result = {
                    title: streamData.title,
                    game: streamData.game?.name,
                    viewers: streamData.viewersCount,
                    startedAt: streamData.createdAt,
                    broadcaster: {
                        name: streamData.broadcaster.displayName,
                        login: streamData.broadcaster.login,
                        description: streamData.broadcaster.description,
                        followers: streamData.broadcaster.followers?.totalCount,
                        isPartner: streamData.broadcaster.roles?.isPartner,
                        isAffiliate: streamData.broadcaster.roles?.isAffiliate
                    },
                    stream: {
                        id: streamData.id,
                        language: streamData.broadcaster.primaryTeam?.language,
                        contentRating: streamData.contentRating,
                        tags: streamData.tags?.map(tag => tag.name) || []
                    }
                };

                if (args.include_chat_info) {
                    const chatContainer = document.querySelector('.chat-room__content');
                    if (chatContainer) {
                        result.chat = {
                            isEmoteOnly: !!document.querySelector('.chat-room--emote-only'),
                            isSubOnly: !!document.querySelector('.chat-room--subs-only'),
                            isFollowersOnly: !!document.querySelector('.chat-room--followers-only'),
                            slowMode: !!document.querySelector('.chat-room--slow'),
                            uniqueMode: !!document.querySelector('.chat-room--r9k'),
                            recentMessages: Array.from(document.querySelectorAll('.chat-line__message')).slice(-10).map(msg => ({
                                user: msg.querySelector('.chat-author__display-name')?.textContent?.trim(),
                                message: msg.querySelector('.text-fragment')?.textContent?.trim(),
                                isSubscriber: !!msg.querySelector('.chat-badge-subscriber'),
                                isModerator: !!msg.querySelector('.chat-badge-moderator')
                            }))
                        };
                    }
                }

                return { success: true, result };
            } catch (error) {
                scope.logError('Error getting stream info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetTopCategories = {
        function: {
            name: 'get_top_categories',
            description: 'Get top game categories on Twitch',
            parameters: {
                properties: {
                    limit: {
                        type: 'number',
                        description: 'Maximum number of categories to return (default: 20)'
                    },
                    include_viewer_count: {
                        type: 'boolean',
                        description: 'Whether to include viewer counts'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const limit = args.limit || 20;
                
                // Get the GQL client from window
                const gqlClient = window.__twilightBuildID;
                if (!gqlClient) {
                    throw new Error('Twitch GQL client not found');
                }

                const response = await scope.$http.post('/gql', {
                    operationName: 'BrowsePage_TopGames',
                    variables: {
                        limit: limit,
                        options: {
                            sort: "VIEWER_COUNT",
                            recommendationsContext: {
                                platform: "web"
                            }
                        }
                    },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: gqlClient
                        }
                    }
                });

                const categories = response.data.data.games.edges.map(edge => {
                    const category = {
                        id: edge.node.id,
                        name: edge.node.name,
                        boxArtUrl: edge.node.boxArtURL,
                        url: `https://twitch.tv/directory/game/${encodeURIComponent(edge.node.name)}`
                    };

                    if (args.include_viewer_count) {
                        category.viewers = edge.node.viewersCount;
                    }

                    return category;
                });

                return { success: true, result: categories };
            } catch (error) {
                scope.logError('Error getting top categories:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetClips = {
        function: {
            name: 'get_clips',
            description: 'Get clips from a channel',
            parameters: {
                properties: {
                    channel: {
                        type: 'string',
                        description: 'Channel name to get clips from (defaults to current channel if on a channel page)'
                    },
                    period: {
                        type: 'string',
                        description: 'Time period (24h, 7d, 30d, all)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of clips to return (default: 20)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                let channelName = args.channel;
                if (!channelName) {
                    // Try to get channel from current page
                    if (window.location.pathname.match(/\/[^\/]+$/)) {
                        channelName = window.location.pathname.split('/').pop();
                    } else {
                        throw new Error('Channel name not provided and not on a channel page');
                    }
                }

                const limit = args.limit || 20;
                const period = args.period || 'all';

                // Get the GQL client from window
                const gqlClient = window.__twilightBuildID;
                if (!gqlClient) {
                    throw new Error('Twitch GQL client not found');
                }

                const response = await scope.$http.post('/gql', {
                    operationName: 'ClipsPage',
                    variables: {
                        channelLogin: channelName,
                        limit: limit,
                        criteria: {
                            period: period.toUpperCase()
                        }
                    },
                    extensions: {
                        persistedQuery: {
                            version: 1,
                            sha256Hash: gqlClient
                        }
                    }
                });

                const clips = response.data.data.user.clips.edges.map(edge => ({
                    id: edge.node.id,
                    title: edge.node.title,
                    url: edge.node.url,
                    thumbnailUrl: edge.node.thumbnailURL,
                    views: edge.node.viewCount,
                    duration: edge.node.durationSeconds,
                    createdAt: edge.node.createdAt,
                    curator: edge.node.curator.displayName,
                    game: edge.node.game?.name
                }));

                return { success: true, result: clips };
            } catch (error) {
                scope.logError('Error getting clips:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['TwitchTools'] = TwitchTools;
} else {
    window.sbaiTools = {
        'TwitchTools': TwitchTools
    };
}

export { TwitchTools }; 