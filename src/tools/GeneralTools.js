class GeneralTools {
    static _CarbonBarPageLoadFilter = (window) => {
        return true; //Always available
    }

    static SearchWeb = {
        function: {
            name: 'search_web',
            description: 'Search the web using DuckDuckGo',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query'
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 5)'
                    }
                },
                required: ['query']
            }
        },
        execute: async function(scope, args) {
            const { query, max_results = 5 } = args;
            try {
                const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
                const data = await response.json();
                
                const results = data.RelatedTopics
                    .slice(0, max_results)
                    .map(topic => ({
                        title: topic.Text?.split(' - ')[0] || topic.Text,
                        description: topic.Text,
                        url: topic.FirstURL
                    }));
                
                return { success: true, result: results };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    //static GenerateImage = {
    //    function: {
    //        name: 'generate_image',
    //        description: 'Generate an image using DALL-E',
    //        parameters: {
    //            properties: {
    //                prompt: {
    //                    type: 'string',
    //                    description: 'The image generation prompt'
    //                },
    //                size: {
    //                    type: 'string',
    //                    description: 'Image size (256x256, 512x512, or 1024x1024)'
    //                },
    //                style: {
    //                    type: 'string',
    //                    description: 'Image style (vivid or natural)'
    //                }
    //            },
    //            required: ['prompt']
    //        }
    //    },
    //    execute: async function(scope, args) {
    //        const { prompt, size = '1024x1024', style = 'vivid' } = args;
    //        
    //        if (!scope.apiKey) {
    //            return { success: false, error: 'OpenAI API key not set. Please set it using the set-openai-key command.' };
    //        }

    //        try {
    //            const response = await fetch('https://api.openai.com/v1/images/generations', {
    //                method: 'POST',
    //                headers: {
    //                    'Content-Type': 'application/json',
    //                    'Authorization': `Bearer ${scope.apiKey}`
    //                },
    //                body: JSON.stringify({
    //                    prompt,
    //                    n: 1,
    //                    size,
    //                    style
    //                })
    //            });

    //            const data = await response.json();
    //            if (data.error) {
    //                return { success: false, error: data.error.message };
    //            }

    //            return { success: true, result: data.data[0].url };
    //        } catch (error) {
    //            return { success: false, error: error.message };
    //        }
    //    }
    //};

    static GetPageMetadata = {
        function: {
            name: 'get_page_metadata',
            description: 'Get metadata about the current webpage',
            parameters: {}
        },
        execute: async function(scope, args) {
            try {
                const metadata = {
                    title: document.title,
                    description: document.querySelector('meta[name="description"]')?.content,
                    keywords: document.querySelector('meta[name="keywords"]')?.content,
                    author: document.querySelector('meta[name="author"]')?.content,
                    url: window.location.href,
                    domain: window.location.hostname,
                    lastModified: document.lastModified,
                    language: document.documentElement.lang,
                    charset: document.characterSet,
                    viewport: document.querySelector('meta[name="viewport"]')?.content
                };

                return { success: true, result: metadata };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static ExtractPageContent = {
        function: {
            name: 'extract_page_content',
            description: 'Extract main content from the current webpage',
            parameters: {
                properties: {
                    include_images: {
                        type: 'boolean',
                        description: 'Whether to include image information'
                    },
                    include_links: {
                        type: 'boolean',
                        description: 'Whether to include link information'
                    },
                    include_html: {
                        type: 'boolean',
                        description: 'Whether to include HTML (for complex queries)'
                    },
                    body_query_selector: {
                        type: 'string',
                        description: 'The query selector to use to extract the body content (optional)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { include_images = false, include_links = false, include_html = false, body_query_selector } = args;
            try {
                // Get main content (prioritize article or main content areas)
                let mainContent = document.querySelector('article, [role="main"], main, .main-content, #main-content') || document.body;
                if (body_query_selector) {
                    mainContent = document.querySelector(body_query_selector);
                }
                
                const content = {
                    text: mainContent.textContent.trim(),
                    wordCount: mainContent.textContent.trim().split(/\s+/).length,
                    html: include_html ? mainContent.innerHTML : null
                };

                if (include_images) {
                    content.images = Array.from(mainContent.querySelectorAll('img')).map(img => ({
                        src: img.src,
                        alt: img.alt,
                        width: img.width,
                        height: img.height
                    }));
                }

                if (include_links) {
                    content.links = Array.from(mainContent.querySelectorAll('a')).map(link => ({
                        text: link.textContent.trim(),
                        href: link.href,
                        title: link.title
                    }));
                }

                return { success: true, result: content };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    // TODO: general webpage stuff

    static PromptUserForConfirmation = {
        function: {
            name: 'prompt_user_for_confirmation',
            description: 'Prompt the user for confirmation',
            parameters: {
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The prompt to show the user'
                    }
                },
                required: ['prompt']
            }
        },
        execute: async function(scope, args) {
            const { prompt } = args;
            return new Promise((resolve) => {
                // Generate a unique ID for this request
                const requestId = 'confirm_' + Math.random().toString(36).substr(2, 9);
                
                // Create a one-time message handler for this specific request
                const messageHandler = (event) => {
                    if (event.data.type === 'CONFIRMATION_DIALOG_RESPONSE' && event.data.requestId === requestId) {
                        window.removeEventListener('message', messageHandler);
                        scope.logMessage('CONFIRMATION_DIALOG_RESPONSE', event.data);
                        if (event.data.confirmed) {
                            resolve({
                                success: true,
                                result: 'User granted permission'
                            });
                        } else {
                            resolve({
                                success: false,
                                error: 'User denied permission'
                            });
                        }
                    }
                };
                
                // Add the message listener
                window.addEventListener('message', messageHandler);

                // Send message to smartbar to show confirmation dialog
                window.postMessage({
                    type: 'SHOW_CONFIRMATION_DIALOG',
                    payload: {
                        requestId: requestId,
                        prompt: prompt
                    }
                }, window.location.origin);
            });
        }
    };

    static PromptUserForInput = {
        function: {
            name: 'prompt_user_for_input',
            description: 'Prompt the user for input, you can spawn multiple prompts at once if needed',
            parameters: {
                properties: {
                    type: {
                        type: 'string',
                        description: 'Input type (text, number, date, etc)'
                    },
                    name: {
                        type: 'string',
                        description: 'The name of the input'
                    },
                    default_value: {
                        type: 'string',
                        description: 'The default value of the input'
                    },
                    prompt: {
                        type: 'string',
                        description: 'The prompt to show the user, optional'
                    }
                },
                required: ['type', 'name']
            }
        },
        execute: async function(scope, args) {
            const { type, name, default_value, prompt } = args;
            return new Promise((resolve) => {
                // Generate a unique ID for this request
                const requestId = 'input_' + Math.random().toString(36).substr(2, 9);
                
                // Create a one-time message handler for this specific request
                const messageHandler = (event) => {
                    if (event.data.type === 'INPUT_DIALOG_RESPONSE' && event.data.requestId === requestId) {
                        scope.logMessage('INPUT_DIALOG_RESPONSE', event.data);
                        window.removeEventListener('message', messageHandler);
                        const input = event.data.input;
                        if (input !== null) {
                            resolve({
                                success: true,
                                result: input
                            });
                        } else {
                            resolve({
                                success: false,
                                error: 'User did not provide input'
                            });
                        }
                    }
                };
                
                // Add the message listener
                window.addEventListener('message', messageHandler);

                // Send message to smartbar to show input dialog
                window.postMessage({
                    type: 'SHOW_INPUT_DIALOG',
                    payload: {
                        requestId: requestId,
                        type: type,
                        name: name,
                        defaultValue: default_value,
                        prompt: prompt
                    }
                }, window.location.origin);
            });
        }
    };
}
if(window.sbaiTools) {
    window.sbaiTools['GeneralTools'] = GeneralTools;
} else {
    window.sbaiTools = {
        'GeneralTools': GeneralTools
    };
}

export { GeneralTools };