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
}

if(window.sbaiTools) {
    window.sbaiTools['TwitchTools'] = TwitchTools;
} else {
    window.sbaiTools = {
        'TwitchTools': TwitchTools
    };
}

export { TwitchTools }; 