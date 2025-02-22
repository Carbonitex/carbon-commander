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

    static SecurityCheck = {
        function: {
            name: 'security_check',
            description: 'Perform a basic security analysis of the current website',
            parameters: {
                type: 'object',
                properties: {
                    include_headers: {
                        type: 'boolean',
                        description: 'Whether to include security header analysis',
                        default: true
                    },
                    check_ssl: {
                        type: 'boolean',
                        description: 'Whether to check SSL certificate details',
                        default: true
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { include_headers = true, check_ssl = true } = args;
            try {
                const securityReport = {
                    url: window.location.href,
                    protocol: window.location.protocol,
                    isSecure: window.location.protocol === 'https:',
                    timestamp: new Date().toISOString()
                };

                // Check security headers if requested
                if (include_headers) {
                    const headers = await fetch(window.location.href, { method: 'HEAD' })
                        .then(response => {
                            const headerData = {};
                            response.headers.forEach((value, key) => {
                                if (key.toLowerCase().includes('security') || 
                                    ['content-security-policy', 'x-frame-options', 'x-xss-protection',
                                     'strict-transport-security', 'x-content-type-options'].includes(key.toLowerCase())) {
                                    headerData[key] = value;
                                }
                            });
                            return headerData;
                        });
                    securityReport.securityHeaders = headers;
                }

                // Check SSL certificate if requested and available
                if (check_ssl && window.location.protocol === 'https:') {
                    const certificateInfo = {
                        issuer: document.querySelector('meta[name="ssl-issuer"]')?.content || 'Not available in client',
                        validFrom: document.querySelector('meta[name="ssl-valid-from"]')?.content || 'Not available in client',
                        validTo: document.querySelector('meta[name="ssl-valid-to"]')?.content || 'Not available in client'
                    };
                    securityReport.sslCertificate = certificateInfo;
                }

                // Check for common security issues
                securityReport.securityIssues = [];
                
                // Check if site uses HTTPS
                if (!securityReport.isSecure) {
                    securityReport.securityIssues.push({
                        severity: 'high',
                        issue: 'Site does not use HTTPS',
                        recommendation: 'Enable HTTPS to secure data transmission'
                    });
                }

                // Check for mixed content
                const mixedContent = Array.from(document.querySelectorAll('img, script, link, iframe'))
                    .filter(el => {
                        const src = el.src || el.href;
                        return src && src.startsWith('http:');
                    });
                if (mixedContent.length > 0) {
                    securityReport.securityIssues.push({
                        severity: 'medium',
                        issue: 'Mixed content detected',
                        details: `${mixedContent.length} resources loaded over insecure HTTP`,
                        recommendation: 'Update resource URLs to use HTTPS'
                    });
                }

                // Check for vulnerable input fields
                const passwordFields = Array.from(document.querySelectorAll('input[type="password"]'));
                const insecurePasswordFields = passwordFields.filter(field => !field.closest('form')?.hasAttribute('autocomplete'));
                if (insecurePasswordFields.length > 0) {
                    securityReport.securityIssues.push({
                        severity: 'medium',
                        issue: 'Insecure password fields detected',
                        details: `${insecurePasswordFields.length} password fields without proper autocomplete attributes`,
                        recommendation: 'Add autocomplete attributes to password fields'
                    });
                }

                return { success: true, result: securityReport };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static GenerateImage = {
        function: {
            name: 'generate_image',
            description: 'Generate an image using DALL-E',
            parameters: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The image generation prompt'
                    },
                    size: {
                        type: 'string',
                        description: 'Image size (256x256, 512x512, or 1024x1024)',
                        enum: ['256x256', '512x512', '1024x1024'],
                        default: '1024x1024'
                    },
                    style: {
                        type: 'string',
                        description: 'Image style (vivid or natural)',
                        enum: ['vivid', 'natural'],
                        default: 'vivid'
                    },
                    openai_key: {
                        type: 'string',
                        description: 'The OpenAI API key to use for image generation',
                    }
                },
                required: ['prompt', 'openai_key']
            }
        },
        execute: async function(scope, args) {
            const { prompt, size = '1024x1024', style = 'vivid', openai_key } = args;
            
            // Get OpenAI key from settings
            const openaiKey = openai_key;
            if (!openaiKey) {
                return { 
                    success: false, 
                    error: 'OpenAI API key not set. Please set it using the set-openai-key command.' 
                };
            }

            try {
                const response = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiKey}`
                    },
                    body: JSON.stringify({
                        prompt,
                        n: 1,
                        size,
                        style
                    })
                });

                const data = await response.json();
                if (data.error) {
                    return { success: false, error: data.error.message };
                }

                return { success: true, result: data.data[0].url };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static GetPageMetadata = {
        function: {
            name: 'get_page_metadata',
            description: 'Get metadata about the current webpage',
            parameters: {
                type: 'object',
                properties: {}  // No parameters needed
            }
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
                type: 'object',
                properties: {
                    include_images: {
                        type: 'boolean',
                        description: 'Whether to include image information',
                        default: false
                    },
                    include_links: {
                        type: 'boolean',
                        description: 'Whether to include link information',
                        default: false
                    },
                    include_html: {
                        type: 'boolean',
                        description: 'Whether to include HTML (for complex queries)',
                        default: false
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
                
                const wordLimit = 10000;
                const charLimit = wordLimit * 5;
                const chatCount = mainContent.textContent.trim().length;
                const wordCount = mainContent.textContent.trim().split(/\s+/).length;

                if(chatCount > charLimit || wordCount > wordLimit) {

                    const trimmedContent = mainContent.textContent.trim().slice(0, 5000);
                    const trimmedWordCount = trimmedContent.split(/\s+/).length;
                    const trimmedChatCount = trimmedContent.length;

                    const content = `
${trimmedContent}


Content is too long. The output has been limited. Try again with a more specific query or use the body_query_selector to target a specific part of the page.
Chat count: ${trimmedChatCount} / ${chatCount}, Word count: ${trimmedWordCount} / ${wordCount}
                    `.trim();

                    return {
                        success: true,
                        content: content
                    };
                }


                const content = {
                    text: mainContent.textContent.trim(),
                    wordCount: wordCount,
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
                    const payload = event.data.payload?.payload || event.data.payload;
                    scope.logMessage('CB_DIALOG_RETURN', payload);
                    if (event.data.type === 'CB_DIALOG_RETURN' && payload.requestId === requestId) {
                        window.removeEventListener('message', messageHandler);
                        scope.logMessage('CB_DIALOG_RETURN', event.data);
                        if (payload.confirmed) {
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

                // Create dialog HTML with animations
                const dialogHtml = `
                    <div class="cc-dialog" style="animation: messageAppear 0.3s ease-in-out forwards;">
                        <div class="cc-dialog-content">
                            <p>${prompt}</p>
                            <div class="cc-dialog-buttons">
                                <button class="cc-button confirm" data-action="confirm">Confirm</button>
                                <button class="cc-button cancel" data-action="cancel">Cancel</button>
                            </div>
                        </div>
                    </div>
                `;

                // Send message to command bar to show confirmation dialog
                window.postMessage({
                    type: 'CB_SHOW_CONFIRMATION_DIALOG',
                    payload: {
                        requestId: requestId,
                        prompt: prompt,
                        dialogHtml: dialogHtml
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
                    const payload = event.data.payload?.payload || event.data.payload;
                    scope.logMessage('CB_DIALOG_RETURN', payload);
                    if (event.data.type === 'CB_DIALOG_RETURN' && payload.requestId === requestId) {
                        
                        window.removeEventListener('message', messageHandler);
                        const input = payload.input;
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

                // Send message to command bar to show input dialog
                window.postMessage({
                    type: 'CB_SHOW_INPUT_DIALOG',
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

    static ColorPicker = {
        function: {
            name: 'color_picker',
            description: 'Pick colors from the current webpage or get color suggestions',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        description: 'Mode of operation (pick, suggest, extract)',
                        enum: ['pick', 'suggest', 'extract'],
                        default: 'pick'
                    },
                    theme: {
                        type: 'string',
                        description: 'Color theme for suggestions (warm, cool, monochrome, complementary)',
                        default: 'warm'
                    },
                    format: {
                        type: 'string',
                        description: 'Color format to return (hex, rgb, hsl)',
                        enum: ['hex', 'rgb', 'hsl'],
                        default: 'hex'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { mode = 'pick', theme = 'warm', format = 'hex' } = args;
            try {
                let result = {};

                // Helper function to convert colors between formats
                const convertColor = (color, targetFormat) => {
                    // Create a temporary div to use the browser's color parsing
                    const div = document.createElement('div');
                    div.style.color = color;
                    document.body.appendChild(div);
                    const computed = window.getComputedStyle(div).color;
                    document.body.removeChild(div);

                    // Parse RGB values
                    const [r, g, b] = computed.match(/\d+/g).map(Number);

                    switch (targetFormat) {
                        case 'hex':
                            return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
                        case 'rgb':
                            return `rgb(${r}, ${g}, ${b})`;
                        case 'hsl':
                            // Convert RGB to HSL
                            const rr = r / 255;
                            const gg = g / 255;
                            const bb = b / 255;
                            const max = Math.max(rr, gg, bb);
                            const min = Math.min(rr, gg, bb);
                            let h, s, l = (max + min) / 2;

                            if (max === min) {
                                h = s = 0;
                            } else {
                                const d = max - min;
                                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                                switch (max) {
                                    case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
                                    case gg: h = (bb - rr) / d + 2; break;
                                    case bb: h = (rr - gg) / d + 4; break;
                                }
                                h /= 6;
                            }

                            return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
                    }
                };

                switch (mode) {
                    case 'pick':
                        // Create a message handler for the color picker
                        return new Promise((resolve) => {
                            const requestId = 'colorpick_' + Math.random().toString(36).substr(2, 9);
                            
                            // Create one-time message handler
                            const messageHandler = (event) => {
                                if (event.data.type === 'COLOR_PICKED' && event.data.requestId === requestId) {
                                    window.removeEventListener('message', messageHandler);
                                    const color = convertColor(event.data.color, format);
                                    resolve({
                                        success: true,
                                        result: {
                                            color,
                                            element: event.data.elementInfo,
                                            originalFormat: event.data.originalFormat
                                        }
                                    });
                                }
                            };
                            
                            window.addEventListener('message', messageHandler);

                            // Send message to activate color picker
                            window.postMessage({
                                type: 'ACTIVATE_COLOR_PICKER',
                                payload: {
                                    requestId: requestId
                                }
                            }, window.location.origin);
                        });

                    case 'suggest':
                        // Generate color suggestions based on theme
                        const suggestions = {
                            warm: ['#FF6B6B', '#FFA07A', '#FFD93D', '#FF8C42', '#FF4E50'],
                            cool: ['#4A90E2', '#67B26F', '#4CA1AF', '#5D4157', '#2F80ED'],
                            monochrome: ['#2C3E50', '#34495E', '#547891', '#95A5A6', '#BDC3C7'],
                            complementary: ['#2ECC71', '#E74C3C', '#3498DB', '#F1C40F', '#9B59B6']
                        };

                        result = {
                            theme,
                            colors: suggestions[theme].map(color => ({
                                [format]: convertColor(color, format),
                                hex: color
                            }))
                        };
                        break;

                    case 'extract':
                        // Extract dominant colors from the page
                        const elements = document.querySelectorAll('*');
                        const colors = new Set();
                        
                        elements.forEach(el => {
                            const style = window.getComputedStyle(el);
                            ['color', 'backgroundColor', 'borderColor'].forEach(prop => {
                                const color = style[prop];
                                if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
                                    colors.add(color);
                                }
                            });
                        });

                        result = {
                            colors: Array.from(colors)
                                .slice(0, 10) // Limit to top 10 colors
                                .map(color => ({
                                    [format]: convertColor(color, format),
                                    original: color
                                }))
                        };
                        break;
                }

                return { success: true, result };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static ListAllKeys = {
        function: {
            name: 'list_all_keys',
            description: 'List all keys in the key/value store'
        },
        execute: async function(scope, args) {
            return {
                success: true,
                result: {
                    keys: Array.from(scope.settings?.keyValuePairs?.keys()),
                    encrypted_keys: Array.from(scope.settings?.encryptedKeys?.keys())
                }
            };
        }
    };

    static ManageKeyValuePair = {
        function: {
            name: 'manage_key_value_pair',
            description: 'Get or set key/value pairs for various services. Use this to manage API keys for OpenAI and other services.',
            parameters: {
                properties: {
                    action: {
                        type: 'string',
                        description: 'The action to perform: "get" or "set"',
                        enum: ['get', 'set']
                    },
                    key_name: {
                        type: 'string',
                        description: 'The name of the API key to manage (e.g., "openai-key")',
                        enum: ['openai-key']
                    },
                    value: {
                        type: 'string',
                        description: 'The API key value to set (only required for "set" action)'
                    },
                    reason: {
                        type: 'string',
                        description: 'The reason for the action, recipient of the key'
                    }
                },
                required: ['action', 'key_name', 'reason']
            }
        },
        execute: async function(scope, args) {
            let { action, key_name, value, reason } = args;
            
            if (action === 'get') {
                const is_encrypted = scope.settings?.encryptedKeys?.get(key_name);
                let keyExists = is_encrypted || (scope.settings?.keyValuePairs?.has(key_name) && 
                                scope.settings?.keyValuePairs?.get(key_name)?.length > 0);

                scope.logMessage('ManageAPIKeyDEBUG: ' + JSON.stringify({
                    scope,
                    settings: scope.settings,
                    is_encrypted,
                    keyExists,
                    key_name,
                    value,
                    reason
                }));
                
                if(is_encrypted) {
                    const response = await scope.promptAccessRequest({
                        prompt: `Allow ${reason} (and this page) access to ${key_name}?`,
                        default_value: 'yes'
                    });
                    if(!response.confirmed ){
                        return response;
                    }

                    const promise = new Promise((resolve, reject) => {
                                            
                        window.addEventListener('message', (event) => {
                            if(event.data.type === 'CARBON_GET_ENCRYPTED_VALUE_RESPONSE' && event.data.payload.key === key_name) {
                                resolve(event.data.payload.value);
                            }
                        });
                        scope.bar.postMessage({
                            type: 'GET_ENCRYPTED_VALUE',
                            payload: {
                                key: key_name
                            }
                        });
                    });

                    value = await promise;
                }
                
                return {
                    success: true,
                    result: {
                        key_name,
                        is_set: keyExists,
                        is_encrypted: is_encrypted,
                        value: value
                    }
                };
            } else if (action === 'set') {
                if (!value) {
                    return {
                        success: false,
                        error: 'Value is required for set action'
                    };
                }

                if (key_name === 'openai-key') {
                    // Use the existing SetOpenAIKey tool's functionality
                    return await CarbonBarHelpTools.SetOpenAIKey.execute(scope, { key: value });
                }

                // For future key types, add handling here
                return {
                    success: false,
                    error: `Unsupported key_name: ${key_name}`
                };
            }

            return {
                success: false,
                error: `Invalid action: ${action}`
            };
        }
    };

    static PageInteract = {
        function: {
            name: 'page_interact',
            description: 'Click elements or perform page interactions based on selectors or text content',
            parameters: {
                properties: {
                    action: {
                        type: 'string',
                        description: 'The action to perform (click, hover, focus)',
                        enum: ['click', 'hover', 'focus']
                    },
                    selector: {
                        type: 'string',
                        description: 'CSS selector to find the element'
                    },
                    text_content: {
                        type: 'string',
                        description: 'Text content to match (alternative to selector)'
                    },
                    wait_for_navigation: {
                        type: 'boolean',
                        description: 'Whether to wait for page navigation after the action',
                        default: false
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds for waiting',
                        default: 5000
                    }
                },
                required: ['action']
            }
        },
        execute: async function(scope, args) {
            const { action, selector, text_content, wait_for_navigation = false, timeout = 5000 } = args;
            
            try {
                let element = null;
                
                // Find element by selector or text content
                if (selector) {
                    element = document.querySelector(selector);
                } else if (text_content) {
                    // Find elements containing the text
                    const elements = Array.from(document.querySelectorAll('*'));
                    element = elements.find(el => 
                        el.textContent?.trim() === text_content.trim() ||
                        el.value === text_content ||
                        el.placeholder === text_content
                    );
                }

                if (!element) {
                    return {
                        success: false,
                        error: `Element not found: ${selector || text_content}`
                    };
                }

                // Scroll element into view
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Create a promise for navigation if needed
                let navigationPromise = null;
                if (wait_for_navigation) {
                    navigationPromise = new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => reject(new Error('Navigation timeout')), timeout);
                        window.addEventListener('load', () => {
                            clearTimeout(timeoutId);
                            resolve();
                        }, { once: true });
                    });
                }

                // Perform the requested action
                switch (action) {
                    case 'click':
                        element.click();
                        break;
                    case 'hover':
                        element.dispatchEvent(new MouseEvent('mouseover', {
                            view: window,
                            bubbles: true,
                            cancelable: true
                        }));
                        break;
                    case 'focus':
                        element.focus();
                        break;
                }

                // Wait for navigation if requested
                if (wait_for_navigation) {
                    await navigationPromise;
                }

                return {
                    success: true,
                    result: {
                        action,
                        element: {
                            tagName: element.tagName,
                            id: element.id,
                            className: element.className,
                            text: element.textContent?.trim()
                        }
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }
    };

    static InputText = {
        function: {
            name: 'input_text',
            description: 'Enter text into form fields or contenteditable elements',
            parameters: {
                properties: {
                    selector: {
                        type: 'string',
                        description: 'CSS selector to find the input element'
                    },
                    placeholder_text: {
                        type: 'string',
                        description: 'Placeholder text to match the input field'
                    },
                    text: {
                        type: 'string',
                        description: 'Text to enter into the field'
                    },
                    submit: {
                        type: 'boolean',
                        description: 'Whether to submit the form after entering text',
                        default: false
                    },
                    clear_first: {
                        type: 'boolean',
                        description: 'Whether to clear the field before entering text',
                        default: true
                    }
                },
                required: ['text']
            }
        },
        execute: async function(scope, args) {
            const { selector, placeholder_text, text, submit = false, clear_first = true } = args;
            
            try {
                let element = null;

                // Find element by selector or placeholder
                if (selector) {
                    element = document.querySelector(selector);
                } else if (placeholder_text) {
                    element = Array.from(document.querySelectorAll('input, textarea')).find(el => 
                        el.placeholder === placeholder_text
                    );
                }

                if (!element) {
                    return {
                        success: false,
                        error: `Input element not found: ${selector || placeholder_text}`
                    };
                }

                // Scroll element into view
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Focus the element
                element.focus();

                // Clear the field if requested
                if (clear_first) {
                    if (element.isContentEditable) {
                        element.textContent = '';
                    } else {
                        element.value = '';
                    }
                }

                // Type the text
                if (element.isContentEditable) {
                    element.textContent = text;
                } else {
                    element.value = text;
                }

                // Dispatch input and change events
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));

                // Submit the form if requested
                if (submit && element.form) {
                    element.form.submit();
                }

                return {
                    success: true,
                    result: {
                        element: {
                            tagName: element.tagName,
                            id: element.id,
                            className: element.className,
                            value: element.value || element.textContent
                        },
                        text_entered: text
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        }
    };

    static NavigateTo = {
        function: {
            name: 'navigate_to',
            description: 'Navigate the current page to a target URL with various options',
            parameters: {
                properties: {
                    url: {
                        type: 'string',
                        description: 'The target URL to navigate to. Can be absolute or relative.'
                    },
                    wait_for_load: {
                        type: 'boolean',
                        description: 'Whether to wait for the page to fully load',
                        default: true
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds for waiting',
                        default: 30000
                    },
                    preserve_hash: {
                        type: 'boolean',
                        description: 'Whether to preserve the current URL hash/fragment',
                        default: false
                    },
                    replace_state: {
                        type: 'boolean',
                        description: 'Whether to replace the current history entry instead of adding a new one',
                        default: false
                    }
                },
                required: ['url']
            }
        },
        execute: async function(scope, args) {
            const { url, wait_for_load = true, timeout = 30000, preserve_hash = false, replace_state = false } = args;
            
            try {
                // Validate URL
                let targetUrl;
                try {
                    // Check if it's a relative URL
                    if (url.startsWith('/') || !url.includes('://')) {
                        targetUrl = new URL(url, window.location.origin);
                    } else {
                        targetUrl = new URL(url);
                    }
                } catch (error) {
                    return {
                        success: false,
                        error: `Invalid URL: ${error.message}`
                    };
                }

                // Security check - only allow HTTP/HTTPS protocols
                if (!['http:', 'https:'].includes(targetUrl.protocol)) {
                    return {
                        success: false,
                        error: `Invalid protocol: ${targetUrl.protocol}`
                    };
                }

                // Preserve hash if requested
                if (preserve_hash && window.location.hash && !url.includes('#')) {
                    targetUrl.hash = window.location.hash;
                }

                // Create a promise to wait for page load if requested
                let loadPromise = null;
                if (wait_for_load) {
                    loadPromise = new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => reject(new Error('Navigation timeout')), timeout);
                        
                        window.addEventListener('load', () => {
                            clearTimeout(timeoutId);
                            resolve();
                        }, { once: true });
                    });
                }

                // Perform the navigation
                const startTime = Date.now();
                if (replace_state) {
                    window.location.replace(targetUrl.href);
                } else {
                    window.location.href = targetUrl.href;
                }

                // Wait for load if requested
                if (wait_for_load) {
                    await loadPromise;
                }

                return {
                    success: true,
                    result: {
                        url: targetUrl.href,
                        navigationTime: Date.now() - startTime,
                        previousUrl: document.referrer
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
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