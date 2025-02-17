class YouTubeTools {
    static name = "YouTubeTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('youtube.com');
    }

    static GetVideoInfo = {
        function: {
            name: 'get_video_info',
            description: 'Get detailed information about the current YouTube video',
            parameters: {
                properties: {
                    include_comments: {
                        type: 'boolean',
                        description: 'Whether to include top comments'
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
                if (!window.location.pathname.includes('/watch')) {
                    return { success: false, error: 'Not on a YouTube video page' };
                }

                // Get video metadata from the page
                const videoData = {
                    title: document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim(),
                    channel: {
                        name: document.querySelector('#channel-name a')?.textContent?.trim(),
                        url: document.querySelector('#channel-name a')?.href,
                        subscribers: document.querySelector('#owner-sub-count')?.textContent?.trim()
                    },
                    views: document.querySelector('.view-count')?.textContent?.trim(),
                    likes: document.querySelector('#segmented-like-button')?.getAttribute('aria-label')?.match(/\d+/)?.[0],
                    uploadDate: document.querySelector('#info-strings yt-formatted-string')?.textContent?.trim(),
                    description: document.querySelector('#description-inline-expander')?.textContent?.trim(),
                    url: window.location.href,
                    videoId: new URLSearchParams(window.location.search).get('v')
                };

                // Get video tags if available
                const tags = Array.from(document.querySelectorAll('meta[property="og:video:tag"]'))
                    .map(tag => tag.content);
                if (tags.length > 0) {
                    videoData.tags = tags;
                }

                // Get video chapters if available
                const chapters = Array.from(document.querySelectorAll('ytd-chapter-renderer'))
                    .map(chapter => ({
                        title: chapter.querySelector('#title')?.textContent?.trim(),
                        timestamp: chapter.querySelector('#time')?.textContent?.trim()
                    }));
                if (chapters.length > 0) {
                    videoData.chapters = chapters;
                }

                if (args.include_comments) {
                    // Scroll to comments section to ensure it's loaded
                    document.querySelector('#comments').scrollIntoView();
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for comments to load

                    const commentLimit = args.comment_limit || 10;
                    const comments = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
                        .slice(0, commentLimit)
                        .map(comment => ({
                            author: comment.querySelector('#author-text')?.textContent?.trim(),
                            content: comment.querySelector('#content')?.textContent?.trim(),
                            likes: comment.querySelector('#vote-count-middle')?.textContent?.trim(),
                            time: comment.querySelector('.published-time-text')?.textContent?.trim(),
                            isPinned: !!comment.querySelector('#pinned-comment-badge'),
                            isHearted: !!comment.querySelector('#creator-heart')
                        }));

                    videoData.comments = comments;
                }

                return { success: true, result: videoData };
            } catch (error) {
                scope.logError('Error getting YouTube video info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetChannelInfo = {
        function: {
            name: 'get_channel_info',
            description: 'Get information about the current YouTube channel',
            parameters: {
                properties: {
                    include_videos: {
                        type: 'boolean',
                        description: 'Whether to include recent videos'
                    },
                    video_limit: {
                        type: 'number',
                        description: 'Maximum number of videos to return (default: 10)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/channel/') && !window.location.pathname.includes('/c/') && !window.location.pathname.includes('/user/')) {
                    return { success: false, error: 'Not on a YouTube channel page' };
                }

                const channelData = {
                    name: document.querySelector('#channel-name')?.textContent?.trim(),
                    description: document.querySelector('#description')?.textContent?.trim(),
                    subscribers: document.querySelector('#subscriber-count')?.textContent?.trim(),
                    joinDate: document.querySelector('#right-column yt-formatted-string[class*="style-scope ytd-channel-about-metadata-renderer"]:nth-child(2)')?.textContent?.trim(),
                    totalViews: document.querySelector('#right-column yt-formatted-string[class*="style-scope ytd-channel-about-metadata-renderer"]:nth-child(3)')?.textContent?.trim(),
                    url: window.location.href
                };

                // Get channel links if available
                const links = Array.from(document.querySelectorAll('#links-container a'))
                    .map(link => ({
                        title: link.querySelector('#link-title')?.textContent?.trim(),
                        url: link.href
                    }));
                if (links.length > 0) {
                    channelData.links = links;
                }

                if (args.include_videos) {
                    // Navigate to videos tab if not already there
                    const videosTab = document.querySelector('a#tabsContent[href*="/videos"]');
                    if (videosTab) {
                        videosTab.click();
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for videos to load
                    }

                    const videoLimit = args.video_limit || 10;
                    const videos = Array.from(document.querySelectorAll('ytd-grid-video-renderer'))
                        .slice(0, videoLimit)
                        .map(video => ({
                            title: video.querySelector('#video-title')?.textContent?.trim(),
                            url: video.querySelector('#video-title')?.href,
                            views: video.querySelector('#metadata-line span:first-child')?.textContent?.trim(),
                            uploadTime: video.querySelector('#metadata-line span:last-child')?.textContent?.trim(),
                            duration: video.querySelector('#overlays #text')?.textContent?.trim(),
                            thumbnail: video.querySelector('#thumbnail img')?.src
                        }));

                    channelData.videos = videos;
                }

                return { success: true, result: channelData };
            } catch (error) {
                scope.logError('Error getting YouTube channel info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SearchYouTube = {
        function: {
            name: 'search_youtube',
            description: 'Search YouTube videos and channels',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    type: {
                        type: 'string',
                        description: 'Type of results (video, channel, playlist)'
                    },
                    sort_by: {
                        type: 'string',
                        description: 'Sort results by (relevance, upload_date, view_count, rating)'
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
                // Construct search URL with filters
                let searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                
                if (args.type) {
                    searchUrl += `&sp=${args.type}`;
                }
                if (args.sort_by) {
                    searchUrl += `&sp=${args.sort_by}`;
                }

                // Navigate to search results
                const response = await scope.$http.get(searchUrl);
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.data, 'text/html');

                const limit = args.limit || 10;
                const results = Array.from(doc.querySelectorAll('ytd-video-renderer, ytd-channel-renderer, ytd-playlist-renderer'))
                    .slice(0, limit)
                    .map(result => {
                        if (result.tagName === 'YTD-VIDEO-RENDERER') {
                            return {
                                type: 'video',
                                title: result.querySelector('#video-title')?.textContent?.trim(),
                                url: 'https://www.youtube.com' + result.querySelector('#video-title')?.getAttribute('href'),
                                channel: result.querySelector('#channel-info a')?.textContent?.trim(),
                                views: result.querySelector('#metadata-line span:first-child')?.textContent?.trim(),
                                uploadTime: result.querySelector('#metadata-line span:last-child')?.textContent?.trim(),
                                description: result.querySelector('#description-text')?.textContent?.trim()
                            };
                        } else if (result.tagName === 'YTD-CHANNEL-RENDERER') {
                            return {
                                type: 'channel',
                                name: result.querySelector('#channel-title')?.textContent?.trim(),
                                url: 'https://www.youtube.com' + result.querySelector('#channel-title')?.getAttribute('href'),
                                subscribers: result.querySelector('#subscribers')?.textContent?.trim(),
                                description: result.querySelector('#description-text')?.textContent?.trim()
                            };
                        } else {
                            return {
                                type: 'playlist',
                                title: result.querySelector('#video-title')?.textContent?.trim(),
                                url: 'https://www.youtube.com' + result.querySelector('#video-title')?.getAttribute('href'),
                                videoCount: result.querySelector('#video-count')?.textContent?.trim(),
                                channel: result.querySelector('#channel-info a')?.textContent?.trim()
                            };
                        }
                    });

                return { success: true, result: results };
            } catch (error) {
                scope.logError('Error searching YouTube:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetPlaylistInfo = {
        function: {
            name: 'get_playlist_info',
            description: 'Get information about a YouTube playlist',
            parameters: {
                properties: {
                    include_videos: {
                        type: 'boolean',
                        description: 'Whether to include videos in the playlist'
                    },
                    video_limit: {
                        type: 'number',
                        description: 'Maximum number of videos to return (default: 10)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                if (!window.location.pathname.includes('/playlist')) {
                    return { success: false, error: 'Not on a YouTube playlist page' };
                }

                const playlistData = {
                    title: document.querySelector('yt-formatted-string.ytd-playlist-sidebar-primary-info-renderer')?.textContent?.trim(),
                    creator: document.querySelector('a.ytd-playlist-panel-renderer')?.textContent?.trim(),
                    videoCount: document.querySelector('span.ytd-playlist-sidebar-primary-info-renderer')?.textContent?.trim(),
                    visibility: document.querySelector('#privacy-form paper-button')?.textContent?.trim(),
                    description: document.querySelector('yt-formatted-string#description')?.textContent?.trim(),
                    url: window.location.href
                };

                if (args.include_videos) {
                    const videoLimit = args.video_limit || 10;
                    const videos = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))
                        .slice(0, videoLimit)
                        .map(video => ({
                            title: video.querySelector('#video-title')?.textContent?.trim(),
                            url: video.querySelector('#video-title')?.href,
                            duration: video.querySelector('#overlays #text')?.textContent?.trim(),
                            channel: video.querySelector('#channel-name a')?.textContent?.trim(),
                            thumbnail: video.querySelector('#thumbnail img')?.src
                        }));

                    playlistData.videos = videos;
                }

                return { success: true, result: playlistData };
            } catch (error) {
                scope.logError('Error getting YouTube playlist info:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['YouTubeTools'] = YouTubeTools;
} else {
    window.sbaiTools = {
        'YouTubeTools': YouTubeTools
    };
}

export { YouTubeTools }; 