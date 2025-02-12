/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 450:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CarbonBarHelpTools: () => (/* binding */ CarbonBarHelpTools)
/* harmony export */ });
class CarbonBarHelpTools {
    static name = "CarbonBarHelpTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return true; //manually get injected as needed
    }

    static GetNoAIModeToolInfo() {
        return [
            CarbonBarHelpTools.SetOpenAIKey.function,
            CarbonBarHelpTools.CheckOllamaStatus.function,
            CarbonBarHelpTools.GetSetupGuide.function,
            CarbonBarHelpTools.GetUsageGuide.function,
            CarbonBarHelpTools.ChangeKeybind.function,
            CarbonBarHelpTools.ListGuides.function
        ];
    }

    static ListGuides = {
        function: {
            name: 'list_guides',
            description: 'List all available guides and documentation',
            parameters: {}
        },
        execute: async function(scope, args) {
            const guide = `# Available Guides in Carbon Commander

## Setup Guides
Use \`get_setup_guide [topic]\` with:
- \`openai\` - OpenAI API setup and configuration
- \`ollama\` - Ollama local AI setup and configuration
- \`mcp\` - MCP service setup and integration
- \`general\` - General setup and configuration overview

## Usage Guides
Use \`get_usage_guide [topic]\` with:
- \`keybinds\` - Keyboard shortcuts and customization
- \`commands\` - Available commands and usage
- \`tools\` - Tool system and functionality
- \`general\` - Quick start and overview

## Examples
1. Get OpenAI setup instructions:
   \`get_setup_guide openai\`

2. Learn about keyboard shortcuts:
   \`get_usage_guide keybinds\`

3. Set up MCP services:
   \`get_setup_guide mcp\`

4. Get general usage overview:
   \`get_usage_guide general\`

## Additional Help
- Type \`help\` for general assistance
- Type \`change-keybind\` to customize shortcuts
- Click the ⚡ icon to see all available tools
- Use \`mcp connect\` to add services

## Quick Links
- [OpenAI Platform](https://platform.openai.com)
- [Ollama Website](https://ollama.ai)
- [Chrome Extensions](chrome://extensions)`;

            return { success: true, result: guide };
        }
    };

    static GetSetupGuide = {
        function: {
            name: 'get_setup_guide',
            description: 'Get detailed setup instructions for OpenAI, Ollama, and MCP',
            parameters: {
                properties: {
                    topic: {
                        type: 'string',
                        description: 'The specific setup topic (openai, ollama, mcp, or general). Use list_guides to see all available guides.'
                    }
                },
                required: ['topic']
            }
        },
        execute: async function(scope, args) {
            const { topic } = args;
            let guide = '';

            switch(topic.toLowerCase()) {
                case 'openai':
                    guide = `# Setting up OpenAI

1. Visit [OpenAI's platform](https://platform.openai.com/signup)
2. Create an account or sign in
3. Go to [API Keys](https://platform.openai.com/api-keys)
4. Click "Create new secret key"
5. Copy your API key
6. Use the command: \`set openai-key YOUR_API_KEY\`

## Additional Configuration
- API key is stored securely and encrypted
- Key can be updated any time with the same command
- Use \`disconnect openai\` to remove the key

## Troubleshooting
- Ensure your API key is valid and has sufficient credits
- Check connection status in the status badges
- If issues persist, try disconnecting and reconnecting

## Tips
- Keep your API key secure and never share it
- Regularly rotate your API keys for security
- Monitor your API usage on OpenAI's platform

Need more help? Try:
- \`get_usage_guide general\` for general usage
- \`list_guides\` to see all available guides
- \`check-ollama\` to verify Ollama status`;
                    break;

                case 'ollama':
                    guide = `# Setting up Ollama

1. Visit [Ollama.ai](https://ollama.ai)
2. Download the installer for your system
3. Install and run Ollama
4. For macOS users, enable external connections:
   \`\`\`bash
   launchctl setenv OLLAMA_ORIGINS "*"
   \`\`\`
5. Restart Ollama after setting OLLAMA_ORIGINS

## Configuration
- No API key required
- Runs completely locally
- Automatic model management
- Supports multiple AI models

## Verification
Use \`check-ollama\` to verify:
- Connection status
- Available models
- Service health

## Troubleshooting
1. If Ollama is not detected:
   - Check if Ollama is running
   - Verify OLLAMA_ORIGINS setting (macOS)
   - Restart Ollama service

2. For connection issues:
   - Check firewall settings
   - Verify port 11434 is available
   - Ensure no conflicts with other services

## Tips
- Keep Ollama updated for best performance
- Use lightweight models for faster responses
- Configure resource limits as needed

Need more help? Try:
- \`get_usage_guide general\` for general usage
- \`list_guides\` to see all available guides
- \`check-ollama\` for status check`;
                    break;

                case 'mcp':
                    guide = `# Setting up MCP (Model Context Protocol)

## Overview
MCP allows you to extend Carbon Commander with external AI services and tools.

## Basic Setup
1. **Simple Connection**
   \`\`\`
   mcp connect my-service https://my-mcp-service.example.com
   \`\`\`

2. **With Authentication**
   \`\`\`javascript
   window.carbonCommander.mcpToolCaller.configureMCPService({
     serviceId: 'my-service',
     endpoint: 'https://my-mcp-service.example.com',
     apiKey: 'your-api-key',
     options: {
       autoConnect: true,
       autoReconnect: true
     }
   });
   \`\`\`

## Service Management
1. **View Status**:
   - Check status badges in UI
   - Look for "MCP:" prefix in tools list

2. **Disconnect Service**:
   \`mcp disconnect my-service\`

## Creating an MCP Service
Required endpoints:
\`\`\`javascript
GET  /discover-tools    // List available tools
POST /execute          // Execute tool function
GET  /status           // Service status

// Optional endpoints
POST /build-scope      // Custom tool scope
POST /system-prompt    // Enhance prompts
\`\`\`

## Example Service Definition
\`\`\`javascript
{
  name: "email-tools",
  tools: [{
    name: "send-email",
    description: "Send email via MCP",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  }]
}
\`\`\`

## Security Best Practices
1. Use HTTPS for all connections
2. Implement proper authentication
3. Validate all requests
4. Use rate limiting
5. Monitor service usage

## Troubleshooting
1. **Connection Issues**:
   - Verify endpoint URL
   - Check authentication
   - Ensure service is running

2. **Tool Discovery**:
   - Verify /discover-tools endpoint
   - Check tool definitions
   - Monitor browser console

3. **Execution Problems**:
   - Validate parameters
   - Check error responses
   - Verify tool implementation

## Tips
- Use autoConnect for reliability
- Implement error handling
- Monitor tool performance
- Keep services updated

Need more help? Try:
- \`get_usage_guide tools\` for tool usage
- \`list_guides\` for all guides
- Check service documentation`;
                    break;

                case 'general':
                    guide = `# General Setup Guide

## Quick Start
1. Install the extension
2. Configure providers:
   - OpenAI for advanced features (\`get_setup_guide openai\`)
   - Ollama for local processing (\`get_setup_guide ollama\`)
   - MCP for external services (\`get_setup_guide mcp\`)
3. Customize keyboard shortcuts
4. Start using commands

## AI Provider Setup
1. **OpenAI (Recommended)**
   - Get API key: \`get_setup_guide openai\`
   - Set key: \`set openai-key YOUR_KEY\`
   - Check status in badges

2. **Ollama (Optional)**
   - Install locally: \`get_setup_guide ollama\`
   - Runs automatically when detected
   - Provides faster local processing

3. **MCP Services (Optional)**
   - Connect services: \`mcp connect [service-id] [endpoint]\`
   - View status in badges
   - Use service-specific tools

## Keyboard Setup
1. Default: \`Ctrl/⌘ + K\`
2. Customize:
   - Use \`change-keybind\` command
   - Or click extension icon
   - Or use Chrome settings

## Verification
1. Check OpenAI:
   - Look for green status badge
   - Try a simple command
   
2. Check Ollama:
   - Use \`check-ollama\` command
   - Verify status badge

3. Check MCP:
   - Look for service badges
   - Try service-specific tools

## Next Steps
1. Try basic commands
2. Explore available tools
3. Set up keyboard shortcuts
4. Configure AI providers

Need more details? Try:
- \`get_setup_guide openai\` for OpenAI setup
- \`get_setup_guide ollama\` for Ollama setup
- \`get_setup_guide mcp\` for MCP setup
- \`get_usage_guide general\` for usage help
- \`list_guides\` to see all guides`;
                    break;

                default:
                    return { 
                        success: false, 
                        result: "Invalid topic. Available guides:\n\n" +
                               "1. Setup Guides (use get_setup_guide):\n" +
                               "   - openai: OpenAI configuration\n" +
                               "   - ollama: Ollama setup\n" +
                               "   - mcp: MCP service setup\n" +
                               "   - general: Overall setup\n\n" +
                               "2. Usage Guides (use get_usage_guide):\n" +
                               "   - keybinds: Keyboard shortcuts\n" +
                               "   - commands: Available commands\n" +
                               "   - tools: Tool system\n" +
                               "   - general: Quick start\n\n" +
                               "Use list_guides to see all available guides."
                    };
            }

            return { success: true, result: guide };
        }
    };

    static CheckOllamaStatus = {
        function: {
            name: 'check_ollama_status',
            description: 'Check if Ollama is running and accessible',
            parameters: {}
        },
        execute: async function(scope, args) {
            try {
                const response = await fetch('http://localhost:11434/api/tags');
                const data = await response.json();
                
                if (data) {
                    return { 
                        success: true, 
                        result: "✅ Ollama is running and accessible.\n\nAvailable models:\n" + 
                               data.models?.map(m => `- ${m.name}`).join('\n') 
                    };
                }
            } catch (error) {
                return { 
                    success: false, 
                    result: "❌ Ollama is not accessible. Common issues:\n\n" +
                           "1. Ollama is not installed\n" +
                           "2. Ollama service is not running\n" +
                           "3. OLLAMA_ORIGINS is not set (macOS)\n\n" +
                           "Use 'get_setup_guide ollama' for installation instructions."
                };
            }
        }
    };

    static SetOpenAIKey = {
        function: {
            name: 'set_openai_key',
            description: 'Set the OpenAI key',
            parameters: {
                properties: {
                    key: {
                        type: 'string',
                        description: 'The OpenAI key'
                    }
                },
                required: ['key']
            }
        },
        execute: async function(scope, args) {
            const { key } = args;
            scope.logMessage('set_openai_key', key);
            return new Promise((resolve, reject) => {
                window.postMessage({
                    type: 'SET_OPENAI_KEY',
                    payload: {
                        key: key
                    }
                }, window.location.origin);

                const listener = (event) => {   
                    if (event.data.type === 'SET_OPENAI_KEY_RESPONSE') {
                        scope.logMessage('SET_OPENAI_KEY_RESPONSE', event.data, event.data.payload);
                        if(event.data === true || event.data?.payload === true){
                            resolve({success: true, content: 'OpenAI key set successfully'});
                        }else{
                            resolve({success: false, content: 'Failed to set OpenAI key'});
                        }
                        window.removeEventListener('message', listener);
                    }
                };
                window.addEventListener('message', listener);
            });
        }
    };

    static GetUsageGuide = {
        function: {
            name: 'get_usage_guide',
            description: 'Get detailed usage instructions for Carbon Commander features',
            parameters: {
                properties: {
                    topic: {
                        type: 'string',
                        description: 'The specific usage topic (keybinds, commands, tools, or general)'
                    }
                },
                required: ['topic']
            }
        },
        execute: async function(scope, args) {
            const { topic } = args;
            let guide = '';

            switch(topic.toLowerCase()) {
                case 'keybinds':
                    guide = `# Keyboard Shortcuts Guide

## Default Shortcuts
- Open/Close: \`Ctrl + K\` (Windows/Linux) or \`⌘ + K\` (Mac)
- Close: \`Esc\`
- Command History: \`↑\` and \`↓\` arrow keys
- Autocomplete: \`Tab\`

## Customizing Shortcuts
1. **Through Extension Icon**:
   - Click Carbon Commander icon
   - Select "Change Keybind"
   - Press desired key combination
   - Click "Save"

2. **Through Chrome Settings**:
   - Go to \`chrome://extensions/shortcuts\`
   - Find Carbon Commander
   - Click the pencil icon
   - Set your shortcut

3. **Using Command**:
   - Type \`change-keybind\` in Carbon Commander
   - Follow the prompts

## Tips
- Combine with \`Ctrl\` or \`⌘\` for better shortcuts
- Avoid system-reserved shortcuts
- Use single letter keys for quick access`;
                    break;

                case 'commands':
                    guide = `# Available Commands Guide

## Basic Commands
- \`help\`: Show general help
- \`get_usage_guide [topic]\`: Get detailed usage instructions
- \`change-keybind\`: Change keyboard shortcut
- \`set openai-key [key]\`: Set OpenAI API key
- \`check-ollama\`: Check Ollama status

## Navigation
- Use arrow keys (↑/↓) for command history
- Press Tab for autocomplete suggestions
- Type partial command name to search

## Tool Commands
- Click the ⚡ icon to see all available tools
- Tools are grouped by source (Local/MCP)
- Each tool has a description and parameters

## Tips
- Commands are case-insensitive
- Use autocomplete for faster input
- Check tool descriptions for parameter info`;
                    break;

                case 'tools':
                    guide = `# Tools Usage Guide

## Tool Categories
1. **Local Tools**
   - Built-in functionality
   - No external dependencies
   - Fast execution

2. **MCP Tools**
   - External service integration
   - Additional capabilities
   - Network-dependent

## Using Tools
1. Click the ⚡ icon to view all tools
2. Select a tool to auto-fill command
3. Provide required parameters
4. View results in the response area

## Tool Features
- Real-time execution feedback
- Error handling and recovery
- Parameter validation
- Result formatting

## Tips
- Use tool descriptions for guidance
- Check parameter requirements
- Monitor tool status indicators
- Use command history for repeated tasks`;
                    break;

                case 'general':
                    guide = `# Carbon Commander Quick Start Guide

## Getting Started
1. Open with \`Ctrl/⌘ + K\` or click extension icon
2. Type your command or question
3. Use Tab for autocomplete
4. Press Enter to execute

## Key Features
1. **AI Integration**
   - OpenAI for advanced processing
   - Ollama for local operations
   - Real-time responses

2. **Tool System**
   - Built-in tools
   - MCP service integration
   - Custom tool support

3. **Command History**
   - Arrow keys navigation
   - Persistent storage
   - Quick access to recent commands

4. **Autocomplete**
   - Smart suggestions
   - Tab completion
   - Context-aware

## Best Practices
- Start with simple commands
- Use help guides for specific topics
- Customize shortcuts for efficiency
- Check tool documentation

Need more help? Try:
- \`get_usage_guide keybinds\`
- \`get_usage_guide commands\`
- \`get_usage_guide tools\``;
                    break;

                default:
                    return { success: false, error: 'Invalid topic. Use "keybinds", "commands", "tools", or "general".' };
            }

            return { success: true, result: guide };
        }
    };

    static ChangeKeybind = {
        function: {
            name: 'change-keybind',
            description: 'Change the keyboard shortcut for opening Carbon Commander',
            parameters: {}
        },
        execute: async function(scope, args) {
            window.postMessage({ type: 'SHOW_KEYBIND_DIALOG' }, window.location.origin);
            return { 
                success: true, 
                result: "Opening keybind configuration dialog..." 
            };
        }
    };
}

(window.sbaiTools ??= {}).CarbonBarHelpTools = CarbonBarHelpTools;



/***/ }),

/***/ 565:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GeneralTools: () => (/* binding */ GeneralTools)
/* harmony export */ });
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

                // Send message to command bar to show confirmation dialog
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

                // Send message to command bar to show input dialog
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



/***/ }),

/***/ 796:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BitbucketTools: () => (/* binding */ BitbucketTools)
/* harmony export */ });
class BitbucketTools {
    static name = "BitbucketTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('bitbucket.org');
    }

    static CreatePullRequest = {
        function: {
            name: 'create_pullrequest',
            description: 'Create a new pull request',
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'Title of the pull request'
                    },
                    source_branch: {
                        type: 'string',
                        description: 'Source branch name'
                    },
                    target_branch: {
                        type: 'string',
                        description: 'Target branch name (default: main/master)'
                    },
                    description: {
                        type: 'string',
                        description: 'Description of the changes'
                    },
                    reviewers: {
                        type: 'string',
                        description: 'Comma-separated list of reviewer usernames'
                    }
                },
                required: ['title', 'source_branch']
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                const prData = {
                    title: args.title,
                    source: {
                        branch: { name: args.source_branch }
                    },
                    target: {
                        branch: { name: args.target_branch || 'main' }
                    },
                    description: args.description || '',
                    reviewers: args.reviewers ? 
                        args.reviewers.split(',').map(username => ({ username: username.trim() })) 
                        : []
                };

                const response = await scope.$http.post(
                    `/api/2.0/repositories/${workspace}/${repo}/pullrequests`,
                    prData
                );

                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error creating pull request:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetPullRequests = {
        function: {
            name: 'get_pullrequests',
            description: 'Get list of pull requests',
            parameters: {
                properties: {
                    state: {
                        type: 'string',
                        description: 'Filter by PR state (OPEN, MERGED, DECLINED, SUPERSEDED)'
                    },
                    author: {
                        type: 'string',
                        description: 'Filter by author username'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                let endpoint = `/api/2.0/repositories/${workspace}/${repo}/pullrequests`;
                const params = new URLSearchParams();
                
                if (args.state) params.append('state', args.state);
                if (args.author) params.append('q', `author.username="${args.author}"`);
                
                if (params.toString()) {
                    endpoint += `?${params.toString()}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error getting pull requests:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetRecentCommits = {
        function: {
            name: 'get_recent_commits',
            description: 'Get recent commits for a branch',
            parameters: {
                properties: {
                    branch: {
                        type: 'string',
                        description: 'Branch name (default: main/master)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of commits to return (default: 10)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                const branch = args.branch || 'main';
                const limit = args.limit || 10;
                
                const endpoint = `/api/2.0/repositories/${workspace}/${repo}/commits/${branch}?limit=${limit}`;
                
                const response = await scope.$http.get(endpoint);
                
                // Format the commit data
                const commits = response.data.values.map(commit => ({
                    hash: commit.hash,
                    message: commit.message,
                    author: commit.author.raw,
                    date: commit.date,
                    links: commit.links
                }));

                return { success: true, result: commits };
            } catch (error) {
                scope.logError('Error getting recent commits:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['BitbucketTools'] = BitbucketTools;
} else {
    window.sbaiTools = {
        'BitbucketTools': BitbucketTools
    };
}

 

/***/ }),

/***/ 138:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HackerNewsTools: () => (/* binding */ HackerNewsTools)
/* harmony export */ });
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

 

/***/ }),

/***/ 541:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   JiraTools: () => (/* binding */ JiraTools)
/* harmony export */ });
class JiraTools {
    static name = "JiraTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Match Jira Cloud or Server URLs
        return window.location.hostname.includes('atlassian.net') || 
               window.location.pathname.includes('/jira/');
    }

    static GetSprints = {
        function: {
            name: 'get_sprints',
            description: 'Get list of sprints for a board',
            parameters: {
                properties: {
                    board_id: {
                        type: 'string',
                        description: 'The ID of the board to get sprints from'
                    },
                    state: {
                        type: 'string',
                        description: 'Filter sprints by state (active, future, closed)'
                    }
                },
                required: ['board_id']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = `/rest/agile/1.0/board/${args.board_id}/sprint`;
                if (args.state) {
                    endpoint += `?state=${args.state}`;
                }
                
                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error getting sprints:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadSprintBoard = {
        function: {
            name: 'read_sprint_board',
            description: 'Get all issues in a sprint board',
            parameters: {
                properties: {
                    board_id: {
                        type: 'string',
                        description: 'The ID of the board to read'
                    },
                    sprint_id: {
                        type: 'string',
                        description: 'The ID of the sprint to read (optional)'
                    }
                },
                required: ['board_id']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = `/rest/agile/1.0/board/${args.board_id}/issue`;
                if (args.sprint_id) {
                    endpoint += `?sprint=${args.sprint_id}`;
                }
                
                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading sprint board:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateIssue = {
        function: {
            name: 'create_issue',
            description: 'Create a new issue (bug or task)',
            parameters: {
                properties: {
                    project_key: {
                        type: 'string',
                        description: 'The project key (e.g., "PROJ")'
                    },
                    issue_type: {
                        type: 'string',
                        description: 'Type of issue (bug, task)'
                    },
                    summary: {
                        type: 'string',
                        description: 'Issue summary/title'
                    },
                    description: {
                        type: 'string',
                        description: 'Detailed description of the issue'
                    },
                    priority: {
                        type: 'string',
                        description: 'Issue priority (Highest, High, Medium, Low, Lowest)'
                    },
                    assignee: {
                        type: 'string',
                        description: 'Username of the assignee'
                    },
                    sprint_id: {
                        type: 'string',
                        description: 'ID of the sprint to add the issue to'
                    }
                },
                required: ['project_key', 'issue_type', 'summary']
            }
        },
        execute: async function(scope, args) {
            try {
                const issueData = {
                    fields: {
                        project: { key: args.project_key },
                        issuetype: { name: args.issue_type },
                        summary: args.summary,
                        description: args.description,
                        priority: args.priority ? { name: args.priority } : undefined,
                        assignee: args.assignee ? { name: args.assignee } : undefined
                    }
                };

                // Create the issue
                const response = await scope.$http.post('/rest/api/2/issue', issueData);
                
                // If sprint_id is provided, add issue to sprint
                if (args.sprint_id && response.data.id) {
                    await scope.$http.post(`/rest/agile/1.0/sprint/${args.sprint_id}/issue`, {
                        issues: [response.data.id]
                    });
                }

                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error creating issue:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ChangeIssueStatus = {
        function: {
            name: 'change_issue_status',
            description: 'Change the status of an issue',
            parameters: {
                properties: {
                    issue_key: {
                        type: 'string',
                        description: 'The issue key (e.g., "PROJ-123")'
                    },
                    status: {
                        type: 'string',
                        description: 'The new status to set'
                    }
                },
                required: ['issue_key', 'status']
            }
        },
        execute: async function(scope, args) {
            try {
                // First get available transitions
                const transitionsResponse = await scope.$http.get(
                    `/rest/api/2/issue/${args.issue_key}/transitions`
                );
                
                // Find the transition ID that matches the requested status
                const transition = transitionsResponse.data.transitions.find(
                    t => t.name.toLowerCase() === args.status.toLowerCase()
                );

                if (!transition) {
                    throw new Error(`Status transition to "${args.status}" not available`);
                }

                // Perform the transition
                const response = await scope.$http.post(
                    `/rest/api/2/issue/${args.issue_key}/transitions`,
                    { transition: { id: transition.id } }
                );

                return { success: true, result: `Issue ${args.issue_key} status changed to ${args.status}` };
            } catch (error) {
                scope.logError('Error changing issue status:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['JiraTools'] = JiraTools;
} else {
    window.sbaiTools = {
        'JiraTools': JiraTools
    };
}

 

/***/ }),

/***/ 471:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   RocketChatTools: () => (/* binding */ RocketChatTools)
/* harmony export */ });
class RocketChatTools {
    static name = "RocketChatTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Match Rocket.Chat URLs - both cloud and self-hosted instances
        return window.location.hostname.includes('rocket.chat') || 
               document.querySelector('meta[name="application-name"][content="Rocket.Chat"]') !== null;
    }

    static ReadChannel = {
        function: {
            name: 'read_channel',
            description: 'Read messages from a Rocket.Chat channel',
            parameters: {
                properties: {
                    channel_name: {
                        type: 'string',
                        description: 'Name of the channel to read'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of messages to return (default: 50)'
                    },
                    include_threads: {
                        type: 'boolean',
                        description: 'Whether to include thread messages (default: false)'
                    }
                },
                required: ['channel_name']
            }
        },
        execute: async function(scope, args) {
            try {
                const limit = args.limit || 50;
                const includeThreads = args.include_threads || false;

                // Get the Meteor instance from window
                const Meteor = window.Meteor;
                if (!Meteor) {
                    throw new Error('Rocket.Chat Meteor instance not found');
                }

                // Get room ID from channel name
                const room = await new Promise((resolve, reject) => {
                    Meteor.call('getRoomByName', args.channel_name, (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    });
                });

                if (!room) {
                    throw new Error(`Channel "${args.channel_name}" not found`);
                }

                // Get messages
                const messages = await new Promise((resolve, reject) => {
                    Meteor.call('loadHistory', room._id, null, limit, null, (error, result) => {
                        if (error) reject(error);
                        else resolve(result.messages);
                    });
                });

                // Format messages
                let formattedMessages = messages.map(msg => ({
                    id: msg._id,
                    text: msg.msg,
                    sender: msg.u.username,
                    timestamp: msg.ts,
                    attachments: msg.attachments,
                    reactions: msg.reactions,
                    threadCount: msg.tcount || 0,
                    threadMainMessage: msg.tmid ? true : false
                }));

                // Get thread messages if requested
                if (includeThreads) {
                    const threadMainMessages = formattedMessages.filter(msg => msg.threadCount > 0);
                    for (const mainMsg of threadMainMessages) {
                        const threadMessages = await new Promise((resolve, reject) => {
                            Meteor.call('getThreadMessages', mainMsg.id, (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            });
                        });

                        mainMsg.thread = threadMessages.map(msg => ({
                            id: msg._id,
                            text: msg.msg,
                            sender: msg.u.username,
                            timestamp: msg.ts,
                            attachments: msg.attachments,
                            reactions: msg.reactions
                        }));
                    }
                }

                return { 
                    success: true, 
                    result: {
                        channel: {
                            id: room._id,
                            name: room.name,
                            type: room.t,
                            topic: room.topic,
                            memberCount: room.usersCount
                        },
                        messages: formattedMessages
                    }
                };
            } catch (error) {
                scope.logError('Error reading channel:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['RocketChatTools'] = RocketChatTools;
} else {
    window.sbaiTools = {
        'RocketChatTools': RocketChatTools
    };
}

 

/***/ }),

/***/ 952:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmarterMailTools: () => (/* binding */ SmarterMailTools)
/* harmony export */ });

//TODO: Reduce size of SM content returns

class SmarterMailTools {
    static name = "SmarterMailTools";

    static _CarbonBarPageLoadFilter = (window) => {
        try{
            const user = angular.element(document).injector().get('coreData').user;
            if(user.username != null && user.username != '') {
                //If system admin, don't allow tools to be called they have a seperate list of tools
                if(user.isSysAdmin) {
                    return false;
                }
                //smartermail user logged in
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    static _CarbonBarBuildScope = async (scope) => {
        scope.getService = (serviceName) => {
            return angular.element(document).injector().get(serviceName);
        }
        scope.$http = scope.getService('$http');
        scope.$rootScope = window.smRsHook.$root;
        scope.getUserInfo = () => 
        {
            return new Promise(async (resolve, reject) => {
              try {
                const userService = await scope.getService('userDataService');
                const timeService = await scope.getService('userTimeService');
                
                resolve({
                  displayName: userService.user.displayName,
                  username: userService.user.username,
                  emailAddress: userService.user.emailAddress,
                  locale: userService.user.settings.userMailSettings.localeId,
                  categories: userService.user.categories,
                  tzid: timeService.userTimeZone.id
                });
              } catch (error) {
                reject(error);
              }
            });
        }

        try{
            var userInfo = await scope.getUserInfo();
            scope.appName = `SmarterMail [${userInfo.emailAddress}]`;
        } catch (error) {
            scope.logError('Error building scope', error);
            scope.appName = 'SmarterMail [Unknown User]';
        }

        return scope;
    }

    static _CarbonBarSystemPrompt = async (basePrompt, scope) => {
        var systemPrompt = basePrompt + '\n';
        try {
            var userInfo = await scope.getUserInfo();
            //include the user info
            systemPrompt += `The user is "${userInfo.displayName}" with email "${userInfo.emailAddress}" and timezone "${userInfo.tzid}" and locale "${userInfo.locale}"`;
    
            //include the categories
            if (userInfo.categories) {
              systemPrompt += `. User categories: ${userInfo.categories.map(category => category.name).join(', ')}`;
            }
          } catch (error) {
            scope.logError('Error getting user info:', error);
            systemPrompt += '. Unable to get user info.';
          }

        return systemPrompt;
    }


    static GetHelp = {
        function: {
            name: 'get_help',
            description: 'User is asking for help with something',
            parameters: {
                properties: {
                    topic: {
                        type: 'string'
                    },
                    command: {
                        type: 'string'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            scope.logMessage(`GetHelp: ${JSON.stringify(args, null, 2)}`);
            const { topic, command } = args;
            const result = await scope.$http.get(`https://api.openai.com/v1/chat/completions`, {
                headers: {
                    'Authorization': `Bearer ${scope.apiKey}`
                }
            });
            scope.logMessage(`GetHelp result: ${JSON.stringify(result, null, 2)}`);
            var response = result.data.choices[0].message.content;
            return { success: true, result: response };
        }
    };

    
    static GetCategoriesAndOtherFolders = {
        function: {
            name: 'get_categories_and_other_folders',
            description: "Get user's categories and folders for non-email sources",
        },
        execute: async function(scope, args) {
            const catService = scope.getService('coreDataCategories');
            const coreDataCalendar = scope.getService('coreDataCalendar');
            const coreDataNotes = scope.getService('coreDataNotes');
            const coreDataTasks = scope.getService('coreDataTasks');
            const coreDataContacts = scope.getService('coreDataContacts');
            await catService.loadUsersCategories();           
            const categories = await catService.getUsersCategories();
            //const folderList = await coreMailService.getFolderList();
            var folderList = [];

            coreDataCalendar.loadSources().then(function () {
                var calendars = coreDataCalendar.getCalendars();
                var calItems = [];
                for (var i = 0; i < calendars.length; i++) {
                    if (calendars[i].isSharedItem)
                        continue;
                    calItems.push({ translation: calendars[i].untranslatedName ? $translate.instant(calendars[i].untranslatedName) : calendars[i].name, value: calendars[i].id });
                }
                folderList['calendar'] = calItems;
            });
            coreDataNotes.ensureSourcesLoadedPromise().then(function () {
                var notes = coreDataNotes.getSources();
                notes = notes.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['notes'] = notes;
            });

            coreDataTasks.ensureSourcesLoadedPromise().then(function () {
                var tasks = coreDataTasks.getSources();
                tasks = tasks.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['tasks'] = tasks;
            });

            coreDataContacts.ensureSourcesLoadedPromise().then(function () {
                $scope.contactFolders = coreDataContacts.getSources();
                var contacts = coreDataContacts.getSources();
                contacts = contacts.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['contacts'] = contacts;
            });
            
            return { success: true, result: { categories, folderList } };
        }
    };

    static UpdateCategory = {
        function: {
            name: 'update_category',
            description: "Update or create a category for the user's account.",
            parameters: {
                properties: {
                    guid: {
                        type: 'string',
                        description: 'The guid of the category to update (only for updating)'
                    },
                    name: {
                        type: 'string'
                    },
                    color_index: {
                        type: 'number',
                        description: 'The color index (-1 = none/default, 0 = red, 1 = orange, 3 = yellow, 4 = green, 7 = blue, 8 = purple)'
                    },
                    is_default: {
                        type: 'boolean',
                        description: 'Whether this category is the default category'
                    }
                },
                required: ['name']
            }
        },
        execute: async function(scope, args) {
            const { guid, name, color_index, is_default } = args;
            var catResult = await scope.$http.get("~/api/v1/categories/user-category-settings");
            var catSettings = catResult.categorySettings;

            if(is_default) {
                catSettings.defaultCategory = name;
            }

            if(guid) {
                catSettings.categories = catSettings.categories.filter(cat => cat.guid !== guid);
            }
            catSettings.categories.push({ guid, name, colorIndex: color_index });
            try {
                await scope.$http.post("~/api/v1/categories/user-category-settings", catSettings);
                return { success: true, result: "Categories set" };
            } catch (error) {
                scope.logError('Error setting categories:', error);
                return { success: false, error: error.message };
            }
        }
    };

    //TODO: Newsfeeds?
    //TODO: basic user settings, contents filters, etc

    //TODO: (later) domain and system admin tools 
    //TODO: force user verification based on tool property



    static GetEmailFolders = {
        function: {
            name: 'get_email_folders',
            description: "Get folders for the user's emails"
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');
            const folderList = await coreMailService.getFolderList();
            return { success: true, result: folderList };
        }
    };

    static RemoveFolders = {
        function: {
            name: 'remove_folders',
            description: 'Remove folders for the user.',
            parameters: {
                properties: {
                    folder_ids: {
                        type: 'string',
                        description: "The id's of the folders to remove. Child folders are also removed. (comma separated)"
                    }
                },
                required: ['folder_ids']
            }
        },
        execute: async function(scope, args) {
            let folderIds = args.folder_ids.split(',').map(f => f.trim());
            const coreMailService = scope.getService('coreDataMail');
            await coreMailService.loadMailTree();

            const tasksService = scope.getService('coreDataTasks');
            await tasksService.ensureSourcesLoadedPromise();

            const notesService = scope.getService('coreDataNotes');
            await notesService.ensureSourcesLoadedPromise();

            const contactService = scope.getService('coreDataContacts');
            await contactService.ensureSourcesLoadedPromise();

            const calendarService = scope.getService('coreDataCalendar');
            await calendarService.loadSources();

            let totalRemovedFolders = 0;
            let removedFolders = [];
            let aiOutput = '';

            for(var i = 0; i < folderIds.length; i++) {
                //email folders
                const emailFolders = await coreMailService.getFolderList();
                var emailFolder = null;
                for(var j = 0; j < emailFolders.length; j++) { 
                    scope.logMessage(`Checking email folder: ${emailFolders[j].name} (${emailFolders[j].id})`, `Match: ${emailFolders[j].id} == ${folderIds[i]}`);
                    if(emailFolders[j].id == folderIds[i]) {
                        emailFolder = emailFolders[j];
                        break;
                    }
                }
                if(emailFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/folders/delete-folder', { 
                            folder: emailFolder.path,
                            parentFolder: ""
                        });
                        scope.logMessage('RemoveEmailFolder result:', result);
                        if(result.data.success) {
                            removedFolders.push({name: emailFolder.name, id: emailFolder.id});
                        } else {
                            aiOutput += `Error removing email folder: ${folderIds[i]} - ${result.data.message}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing email folder:', error);
                        aiOutput += `Error removing email folder: ${folderIds[i]} - ${error.data?.message}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed email folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const taskFolders = await tasksService.getSources();
                var taskFolder = null;
                for(var j = 0; j < taskFolders.length; j++) { 
                    scope.logMessage(`Checking task folder: ${taskFolders[j].name} (${taskFolders[j].folderId})`, `Match: ${taskFolders[j].folderId} == ${folderIds[i]}`);
                    if(taskFolders[j].folderId == folderIds[i]) {
                        taskFolder = taskFolders[j];
                        break;
                    }
                }
                if(taskFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/tasks/sources/delete', { 
                            folder: taskFolder.name,
                            uid: taskFolder.id
                        });
                        scope.logMessage('RemoveTaskFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: taskFolder.name, id: taskFolder.id});
                        } else {
                            aiOutput += `Error removing task folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing task folder:', error);
                        aiOutput += `Error removing task folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed task folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const noteFolders = await notesService.getSources();
                var noteFolder = null;
                for(var j = 0; j < noteFolders.length; j++) { 
                    scope.logMessage(`Checking note folder: ${noteFolders[j].displayName} (${noteFolders[j].folderId})`, `Match: ${noteFolders[j].folderId} == ${folderIds[i]}`);
                    if(noteFolders[j].folderId == folderIds[i]) {
                        noteFolder = noteFolders[j];
                        break;
                    }
                }
                if(noteFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/notes/sources/delete', { 
                            uid: noteFolder.itemID,
                            folder: noteFolder.displayName
                        });
                        scope.logMessage('RemoveNoteFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: noteFolder.displayName, id: noteFolder.itemID});
                        } else {
                            aiOutput += `Error removing note folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing note folder:', error);
                        aiOutput += `Error removing note folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed note folders: ${removedFolders.map(rf => rf.displayName).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const contactFolders = await contactService.getSources();
                var contactFolder = null;
                for(var j = 0; j < contactFolders.length; j++) { 
                    scope.logMessage(`Checking contact folder: ${contactFolders[j].displayName} (${contactFolders[j].folderId})`, `Match: ${contactFolders[j].folderId} == ${folderIds[i]}`);
                    if(contactFolders[j].folderId == folderIds[i]) {
                        contactFolder = contactFolders[j];
                        break;
                    }
                }
                if(contactFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/contacts/address-book/delete', { 
                            uid: contactFolder.itemID,
                            //folder: contactFolder.displayName //not needed
                        });
                        scope.logMessage('RemoveContactFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: contactFolder.displayName, id: contactFolder.itemID});
                        } else {
                            aiOutput += `Error removing contact folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing contact folder:', error);
                        aiOutput += `Error removing contact folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed contact folders: ${removedFolders.map(rf => rf.displayName).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }


            for(var i = 0; i < folderIds.length; i++) {
                const calendarFolders = await calendarService.getCalendars();
                var calendarFolder = null;
                for(var j = 0; j < calendarFolders.length; j++) { 
                    scope.logMessage(`Checking calendar folder: ${calendarFolders[j].name} (${calendarFolders[j].folderId})`, `Match: ${calendarFolders[j].folderId} == ${folderIds[i]}`);
                    if(calendarFolders[j].folderId == folderIds[i]) {
                        calendarFolder = calendarFolders[j];
                        break;
                    }
                }
                if(calendarFolder) {
                    try {
                        var result = await scope.$http.post(`~/api/v1/calendars/calendar-delete/${calendarFolder.id}`);
                        scope.logMessage('RemoveCalendarFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: calendarFolder.name, id: calendarFolder.id});
                        } else {
                            aiOutput += `Error removing calendar folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing calendar folder:', error);
                        aiOutput += `Error removing calendar folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed calendar folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];    
            }

            if(totalRemovedFolders > 0) {
                return { success: true, result: aiOutput };
            } else {
                aiOutput += "\nNo folders removed";
                return { success: false, error: aiOutput };
            }
        }
    };

    static UpdateFolder = {
        function: {
            name: 'update_folder',
            description: 'Update or create a folder for the user.',
            parameters: {
                properties: {
                    type: {
                        type: 'string',
                        description: 'The type of the folder to update (email, calendar, notes, tasks, contacts)'
                    },
                    name: {
                        type: 'string',
                        description: 'The name of the folder to update'
                    },
                    parent_folder_id: {
                        type: 'string',
                        description: 'The parent folder_id to nest the folder in (optional, only for email)'
                    },
                    folder_id: {
                        type: 'string',
                        description: 'The id of the folder to update (only for updating)'
                    },
                    color: {
                        type: 'string',
                        description: 'The hex color of the calendar to update (only for calendars and tasks)'
                    }
                },
                required: ['type', 'name']
            }
        },
        execute: async function(scope, args) {
            const { type, name, parent_folder_id, folder_id, color } = args;

            if(type == 'email') {
                const coreMailService = scope.getService('coreDataMail');
                await coreMailService.loadMailTree();
                const folderList = await coreMailService.getFolderList();
                if(folder_id) {
                    //update in place
                    var folder = folderList.find(f => f.id == folder_id);
                    var parentFolder = parent_folder_id ? folderList.find(f => f.id == parent_folder_id) : null;
                    
                    if(parent_folder_id && !parentFolder) {
                        scope.logMessage(`Parent folder not found: ${parent_folder_id}`, folderList.map(f => `(${f.id} - ${f.path})`));
                        return { success: false, error: `Parent folder not found: ${parent_folder_id}, folderList: ${folderList.map(f => ` (${f.id} - ${f.path})`)}` };
                    }

                    if(folder) {
                        //This uses the folder names so we need to get the folders by id first
                        try {
                            var result = await scope.$http.post("~/api/v1/folders/folder-put", {
                                folder: name,
                                parentFolder: parentFolder?.path,
                                //ownerEmailAddress: ""
                            });
                            return { success: true, result: result.data };
                        } catch (error) {
                            scope.logError('Error updating folder:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Folder to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    var parentFolder = parent_folder_id ? folderList.find(f => f.id == parent_folder_id) : null;
                    try {
                        var result = await scope.$http.post("~/api/v1/folders/folder-put", {
                            folder: name,
                            parentFolder: parentFolder?.path,
                        });
                        return { success: true, result: result.data };
                    } catch (error) {
                        scope.logError('Error creating folder:', error);
                        return { success: false, error: error.message };
                    }
                }

            } else if(type == 'calendar') {
                var calendarService = scope.getService('coreDataCalendar');
                await calendarService.loadSources();
                var calendars = await calendarService.getCalendars();

                if(folder_id) {
                    var calendar = calendars.find(c => c.folderId == folder_id);
                    if(calendar) {
                        try {
                            let request = await scope.$http.post('~/api/v1/calendars/calendar', {
                                setting: {
                                    id: calendar.id,
                                    friendlyName: name || calendar.friendlyName,
                                    calendarViewColor: color || calendar.calendarViewColor,
                                    isPrimary: calendar.isPrimary
                                }
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                if(request.data)
                                    request.data.success = false; //Fixes an issue with calendar api
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            if(error.data)
                                error.data.success = false; //Fixes an issue with calendar api
                            scope.logError('Error updating calendar:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Calendar to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/calendars/calendar-put', {
                            setting: {
                                friendlyName: name,
                                calendarViewColor: color || "#7FC56F",
                                isPrimary: false
                            }
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            if(request.data)
                                request.data.success = false; //Fixes an issue with calendar api
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        if(error.data)
                            error.data.success = false; //Fixes an issue with calendar api
                        scope.logError('Error adding calendar:', error);
                        return { success: false, error: error.data };
                    }
                }
                
            } else if(type == 'notes') {
                var notesService = scope.getService('coreDataNotes');
                await notesService.ensureSourcesLoadedPromise();
                var noteFolders = await notesService.getSources();

                if(folder_id) {
                    var noteFolder = noteFolders.find(n => n.folderId == folder_id);
                    if(noteFolder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/notes/sources/edit', {
                                folder: name,
                                uid: noteFolder.itemID
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating note:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Note to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/notes/sources/add', {
                            folder: name
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding note:', error);
                        return { success: false, error: error.data };
                    }
                }

            } else if(type == 'tasks') {

                var tasksService = scope.getService('coreDataTasks');
                await tasksService.ensureSourcesLoadedPromise();
                var taskFolders = await tasksService.getSources();

                if(folder_id) {
                    var taskFolder = taskFolders.find(t => t.folderId == folder_id);
                    if(taskFolder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/tasks/sources/edit', {
                                folder: name,
                                uid: taskFolder.id,
                                color: color || "#7FC56F"
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating task:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Task to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/tasks/sources/add', {
                            folder: name,
                            color: color || "#7FC56F"
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding task:', error);
                        return { success: false, error: error.data };
                    }
                }
                
            } else if(type == 'contacts') {
                var contactService = scope.getService('coreDataContacts');
                var contactFolders = await contactService.getSources();
                
                if(folder_id) {
                    var folder = contactFolders.find(f => f.folderId == folder_id);
                    if(folder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/contacts/address-book/edit', {
                                folder: name,
                                uid: folder.itemID,
                                //ownerEmailAddress: ""
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating folder:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Folder to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/contacts/address-book/add', {
                            folder: name,
                            //ownerEmailAddress: ""
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding folder:', error);
                        return { success: false, error: error.data };
                    }
                }
            }
            
            return { success: false, error: `Folder type not supported: ${type}, supported types are: email, calendar, notes, tasks, contacts` };
        }
    }




    static ReadEmailsFast = {
        function: {
            name: 'read_emails_fast',
            description: 'Get the emails including only the subject and metadata for a given folder',
            parameters: {
                properties: {
                    message_filter: {
                        type: 'number',
                        description: '0 = most recent, 1 = unread, 2 = flagged, 3 = calendar, 4 = replied, -1 = all'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to read emails from (default = inbox)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from'
                    }
                },
                required: ['message_filter']
            }
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');
            const folder = args.folder?.toLowerCase() || 'inbox';
            const maxResults = args.max_results || 10;
            const startIndex = args.startIndex || 0;

            let searchCriteria = {
                folder: folder,
                ownerEmailAddress: '',
                sortType: 5, // internalDate
                sortAscending: false,
                startIndex: startIndex,
                maxResults: maxResults
            };

            // Add filter based on message_filter parameter
            if (args.message_filter !== -1) {
                searchCriteria.searchFlags = {};
                switch(args.message_filter) {
                    case 0: // most recent - no additional flags needed
                        break;
                    case 1: // unread
                        searchCriteria.searchFlags[0] = false; 
                        break;
                    case 2: // flagged
                        searchCriteria.searchFlags[4] = true;
                        break;
                    case 3: // calendar
                        searchCriteria.searchFlags[8] = true;
                        break;
                    case 4: // replied
                        searchCriteria.searchFlags[1] = true;
                        break;
                }
            }

            try {
                const result = await scope.$http.post("~/api/v1/mail/messages", searchCriteria);
                return { success: true, result: result.data };
            } catch (error) {
                scope.logError('Error fetching emails:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadEmail = {
        function: {
            name: 'read_email',
            description: 'Get the full email data for a given email by folder and uid',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: 'The uid of the email to read'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to read emails from (default = inbox)'
                    },
                    include_attachments: {
                        type: 'boolean',
                        description: 'Whether to include attachments in the email data (default = false)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const parameters = {
                    'Folder': args.folder || 'inbox',
                    'UID': args.uid,
                    'OwnerEmailAddress': ""
                };

                // Get the full message data
                const messageResponse = await scope.$http.post("~/api/v1/mail/message", parameters);
                
                // If attachments are requested, get them
                if (args.include_attachments && messageResponse.data.messageData.hasAttachments) {
                    const attachmentResponse = await scope.$http.post("~/api/v1/mail/message/attachments", parameters);
                    messageResponse.data.messageData.attachments = attachmentResponse.data.attachments;
                }

                return { success: true, result: messageResponse.data.messageData };
            } catch (error) {
                scope.logError('Error fetching email:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetCalendarEvents = {
        function: {
            name: "get_calendar_events",
            description: "Get calendar events for a given date range",
            parameters: {
                properties: {
                    start_date: {
                        type: 'string',
                        description: 'The start date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_date:{ 
                        type: 'string',
                        description: 'The end date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 10)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from (default = 0)'
                    }
                },
                required: ['start_date', 'end_date']
            }
        },
        execute: async function(scope, args) {
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const maxResults = args.max_results || 10;
            const startIndex = args.startIndex || 0;
            const calendarId = args.calendar_id || (await cs.getCalendars()).filter(x=> x.isPrimary)[0].id;

            const calendar = (await cs.getCalendars()).filter(x=> x.id == calendarId)[0];
            
            const startDate = moment(args.start_date);
            const endDate = moment(args.end_date);


            var params = JSON.stringify({
                startDate: moment.utc(startDate),
                endDate: moment.utc(endDate),
            });
            var result = await scope.$http.post("~/api/v1/calendars/events/" + calendar.owner + "/" + calendar.id, params);
            var events = result.data.events;

            return { success: true, result: events };
        }
    };

    static GetNotes = {
        function: {
            name: 'get_notes',
            description: 'Get notes sorted by most recently edited',
            parameters: {
                properties: {
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 5)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from (default = 0)'
                    },
                    search_text: {
                        type: 'string',
                        description: "Text to search for in notes (default = '')"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const notesService = scope.getService('coreDataNotes');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            await notesService.ensureSourcesLoadedPromise();
            await notesService.ensureNotesLoadedPromise();
            
            const sources = notesService.getSources();
            scope.logMessage('SOURCES', sources);
            // Set search parameters if provided
            if (args.search_text) {
                notesService.parameters.searchText = args.search_text;
            }

            // Get filtered notes
            const notes = notesService.getFilteredNotes();
            
            // Apply pagination
            const paginatedNotes = notes.slice(startIndex, startIndex + maxResults);
            
            // Format the response
            const formattedNotes = paginatedNotes.map(note => ({
                id: note.id,
                title: note.subject,
                content: note.text,
                color: note.color,
                dateCreated: note.dateCreated,
                lastModified: note.lastModifiedUTC,
                categories: note.categoriesString,
                hasAttachments: note.hasAttachments
            }));

            return { success: true, result: formattedNotes };
        }
    };

    static GetTasks = {
        function: {
            name: "get_tasks",
            description: "Get tasks sorted by most recently edited",
            parameters: {
                properties: {
                    max_results: {
                        type: "number",
                        description: "The maximum number of results to return (default = 5)"
                    },
                    startIndex: {
                        type: "number",
                        description: "The index to start from"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const tasksService = scope.getService('coreDataTasks');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            // Load sources and tasks
            await tasksService.ensureSourcesLoadedPromise();
            await tasksService.ensureTasksLoadedPromise();

            // Get filtered tasks
            const tasks = tasksService.getFilteredTasks();
            
            // Apply pagination
            const paginatedTasks = tasks.slice(startIndex, startIndex + maxResults);
            
            return { success: true, result: paginatedTasks };
        }
    };

    static GetContacts = {
        function: {
            name: 'get_contacts',
            description: 'Get contacts sorted by most recently contacted',
            parameters: {
                properties: {
                    search_query: {
                        type: 'string',
                        description: 'The search query to filter contacts by (searches all fields)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 5)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const contactsService = scope.getService('coreDataContacts');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            // Set search parameters if provided
            if (args.search_query) {
                contactsService.parameters.searchText = args.search_query;
            }

            // Load sources and contacts
            await contactsService.ensureSourcesLoadedPromise();
            await contactsService.ensureContactsLoadedPromise();

            // Get filtered contacts
            const contacts = contactsService.getFilteredContacts();
            
            // Apply pagination
            const paginatedContacts = contacts.slice(startIndex, startIndex + maxResults);

            const mappedContacts = paginatedContacts.map(contact => ({  
                id: contact.id,
                name: contact.displayAs,
                email: contact.emailAddressList[0] || undefined,
                phone: contact.phoneNumberList[0]?.number || undefined,
                quick_notes: contact.additionalInfo || undefined,
                flagInfo: contact.flagInfo,
                categories: contact.categoriesString || undefined
            }));
            
            return { success: true, result: mappedContacts };
        }
    };

    //static OpenComposerWindow = {
    //    function: {
    //        name: "OpenComposerWindow",
    //        description: "Open the email composer window",
    //        parameters: {
    //            properties: {
    //                ai_prompt: {
    //                    type: "string",
    //                    description: "The prompt that will be given to the reasoning model to generate the email content once the window is opened"
    //                }
    //            }
    //        }
    //    },
    //    execute: async function(scope, args) {
    //        // Open composer window with AI prompt
    //        const composerWindow = window.open('/composer', 'composer', 'width=800,height=600');
    //        composerWindow.aiPrompt = args.ai_prompt;
    //        return { success: true, result: `Composer window opened` };
    //    }
    //};

    static NewOrUpdateNote = {
        function: {
            name: 'new_or_update_note',
            description: 'Create a new note or update an existing one',
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'The title of the note'
                    },
                    content: {
                        type: 'string', 
                        description: 'The content of the note'
                    },
                    note_id: {
                        type: 'string',
                        description: 'The id of the note to update (guid)'
                    },
                    color: {
                        type: 'string',
                        description: 'The color of the note (white, yellow, pink, green, blue)'
                    }
                },
                required: ['title', 'content']
            }
        },
        execute: async function(scope, args) {
            try {
                // First get the primary source
                const sourcesResult = await scope.$http.get("~/api/v1/notes/sources");
                const sources = sourcesResult.data.sharedLists;
                const primarySource = sources.find(s => s.isPrimary);
                
                if (!primarySource) {
                    throw new Error('No primary notes source found');
                }

                // Format note object according to API requirements
                const note = {
                    subject: args.title,
                    text: `<div>${args.content}</div>`, // Wrap content in div as expected by the API
                    color: args.color || 'white',
                    sourceOwner: primarySource.ownerUsername || "~",
                    sourceId: primarySource.itemID,
                    sourceName: primarySource.displayName,
                    sourcePermission: primarySource.access,
                    isVisible: primarySource.enabled
                };

                if (args.note_id) {
                    note.id = args.note_id;
                    // Update existing note
                    const params = JSON.stringify(note);
                    await scope.$http.post(`~/api/v1/notes/note-patch/${note.id}/${note.sourceId}/${note.sourceOwner}`, params);
                } else {
                    // Create new note
                    const params = JSON.stringify(note);
                    await scope.$http.post(`~/api/v1/notes/note-put/${note.sourceId}/${note.sourceOwner}/`, params);
                }

                return { success: true, result: `Note ${args.title} saved` };
            } catch (error) {
                scope.logError('Error saving note:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static NewOrUpdateContact = {
        function: {
            name: 'new_or_update_contact',
            description: 'Create a new contact or update an existing one',
            parameters: {
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the contact'
                    },
                    email: {
                        type: 'string',
                        description: 'The email address of the contact'
                    },
                    phone: {
                        type: 'string',
                        description: 'The phone number of the contact'
                    },
                    address: {
                        type: 'string',
                        description: 'The address of the contact'
                    },
                    quick_notes: {
                        type: 'string',
                        description: 'Quick notes about the contact'
                    },
                    contact_id: {
                        type: 'string',
                        description: 'The id of the contact to update (guid)'
                    }
                },
                required: ['name']
            }
        },
        execute: async function(scope, args) {
            const contactsService = scope.getService('coreDataContacts');
            
            // Load sources first
            await contactsService.ensureSourcesLoadedPromise();
            await contactsService.ensureContactsLoadedPromise();
            const sources = contactsService.getSources();
            
            // Find primary source
            const primarySource = sources.find(s => s.isPrimary);
            if (!primarySource) {
                throw new Error('No primary contacts source found');
            }

            const contact = {
                id: args.contact_id || null,
                displayAs: args.name,
                email: args.email,
                phoneNumberList: args.phone ? [{ number: args.phone }] : [],
                busStreet: args.address,
                additionalInfo: args.quick_notes,
                source: primarySource,
                sourceOwner: primarySource.ownerUsername,
                sourceId: primarySource.itemID
            };

            if (args.contact_id) {
                // Update existing contact
                await contactsService.editContact(contact);
            } else {
                // Create new contact
                await contactsService.addContact(contact);
            }

            return { success: true, result: `Contact ${args.name} saved` };
        }
    };

    static NewOrUpdateTask = {
        function: {
            name: 'new_or_update_task',
            description: 'Create a new task or update an existing one',
            parameters: {
                properties: {
                    task_id: {
                        type: 'string',
                        description: 'The id of the task to update (guid)'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the task'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the task'
                    },
                    percent_complete: {
                        type: 'number',
                        description: 'The percentage of the task that is complete (0-100)'
                    },
                    start: {
                        type: 'string',
                        description: 'The start date of the task (YYYY-MM-DD HH:mm)'
                    },
                    due: {
                        type: 'string',
                        description: 'The due date of the task (YYYY-MM-DD HH:mm)'
                    },
                    reminder: {
                        type: 'string',
                        description: 'The reminder date of the task (YYYY-MM-DD HH:mm)'
                    }
                },
                required: ['subject']
            }
        },
        execute: async function(scope, args) {
            const tasksService = scope.getService('coreDataTasks');

            await tasksService.ensureSourcesLoadedPromise();
            await tasksService.ensureTasksLoadedPromise();
            
            const sources = tasksService.getSources();
            
            // Find primary source
            const primarySource = sources.find(s => s.isPrimary);
            if (!primarySource) {
                throw new Error('No primary tasks source found');
            }

            if(args.due && !args.start) {
                args.start = moment().toDate();
            }


            const task = {
                id: args.task_id || null,
                description: args.description,
                subject: args.subject,
                percentComplete: args.percent_complete || 0,
                due: args.due ? moment(args.due).toDate() : null,
                start: args.start ? moment(args.start).toDate() : null,
                reminder: args.reminder ? moment(args.reminder).toDate() : null,
                sourceOwner: primarySource.owner,
                sourceId: primarySource.id,
                useDateTime: (args.start || args.due) ? true : false,
                reminderSet: args.reminder ? true : false
            };

            scope.logMessage('TASK', task, args.due, args.start);

            // Use saveTasks for both new and update
            await tasksService.saveTasks([task]);

            return { success: true, result: `Task ${args.subject} saved` };
        }
    };

    static NewOrUpdateCalendarEvent = {
        function: {
            name: 'new_or_update_calendar_event',
            description: 'Create a new calendar event or update an existing one',
            parameters: {
                properties: {
                    event_id: {
                        type: 'string',
                        description: 'The id of the event to update (if it exists)'
                    },
                    subject: {
                        type: 'string',
                        description: 'The title of the event'
                    },
                    start_time: {
                        type: 'string', 
                        description: 'The start time of the event (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_time: {
                        type: 'string',
                        description: 'The end time of the event (YYYY-MM-DDTHH:mm:ss)'
                    },
                    location: {
                        type: 'string',
                        description: 'The location of the event'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the event'
                    },
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to add/update the event to (default is primary calendar)'
                    }
                },
                required: ['subject', 'start_time', 'end_time']
            }
        },
        execute: async function(scope, args) {
            let responseContext = '';
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const calendars = await cs.getCalendars();
            let calendar = args.calendar_id ? calendars.find(x=> x.id == args.calendar_id) : calendars.find(x=> x.isPrimary);

            if (!calendar) {
                responseContext = `Calendar (${args.calendar_id}) not found, using primary calendar`;
                calendar = calendars.find(x=> x.isPrimary);
            }

            // Format the event object according to API requirements
            const event = {
                id: args.event_id || null,
                subject: args.subject,
                start: {
                    dt: moment(args.start_time).toISOString(),
                    tz: moment.tz.guess()
                },
                end: {
                    dt: moment(args.end_time).toISOString(), 
                    tz: moment.tz.guess()
                },
                location: args.location,
                description: args.description,
                calendarId: calendar.id,
                calendarOwner: calendar.owner || null
            };

            try {
                if (args.event_id) {
                    // Update existing event
                    await scope.$http.post(`~/api/v1/calendars/events/save/${calendar.owner}/${calendar.id}/${args.event_id}`, JSON.stringify(event));
                } else {
                    // Create new event
                    await scope.$http.post(`~/api/v1/calendars/events/save/${calendar.owner}/${calendar.id}/null`, JSON.stringify(event));
                }
                
                return { success: true, result: `Event ${args.subject} saved. ${responseContext}` };
            } catch (error) {
                scope.logError('Error saving event:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SendMeetingInvite = {
        function: {
            name: 'send_meeting_invite',
            description: 'Send a meeting invite',
            parameters: {
                properties: {
                    to: {
                        type: 'string',
                        description: 'The email addresses to send the meeting invite to, separated by commas'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the meeting'
                    },
                    start_time: {
                        type: 'string',
                        description: 'The start time of the meeting'
                    },
                    end_time: {
                        type: 'string',
                        description: 'The end time of the meeting'
                    },
                    location: {
                        type: 'string',
                        description: 'The location of the meeting'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the meeting'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const calendarService = scope.getService('coreDataCalendar');
            const emailService = scope.getService('coreDataMail');

            // Create calendar event
            const event = {
                title: args.subject,
                start: moment(args.start_time).toDate(),
                end: moment(args.end_time).toDate(),
                location: args.location,
                description: args.description
            };

            // Add event to calendar
            await calendarService.addEvents([event]);

            // Send email invite
            const emailData = {
                to: args.to,
                subject: args.subject,
                body: `You are invited to: ${args.subject}\n\nWhen: ${args.start_time} - ${args.end_time}\nWhere: ${args.location}\n\n${args.description}`,
                isHtml: false
            };

            await emailService.sendEmail(emailData);
            return { success: true, result: `Meeting invite sent to ${args.to}` };
        }
    };

    static RemoveItems = {
        function: {
            name: 'remove_items',
            description: 'Remove items from the system',
            parameters: {
                properties: {
                    item_id: {
                        type: 'string',
                        description: "The id's of the items to remove, comma separated. (id/guid only)"
                    },
                    item_type: {
                        type: 'string',
                        description: 'The type of the item to remove - note, task, contact, event'
                    },
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to remove the event from'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const ids = args.item_id.split(',').map(id => id.trim());
            const type = args.item_type.toLowerCase();
            const calendarId = args.calendar_id;
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const calendar = (await cs.getCalendars()).filter(x=> x.id == calendarId)[0];
            try{
                let service;
                switch(type) {
                    case 'note':
                        service = scope.getService('coreDataNotes');
                        await service.removeNotes(ids);
                        break;
                    case 'task':
                        service = scope.getService('coreDataTasks');
                        await service.removeTasks(ids);
                        break;
                    case 'contact':
                        // Get contacts service to find source info for the contacts
                        service = scope.getService('coreDataContacts');
                        await service.ensureSourcesLoadedPromise();
                        await service.ensureContactsLoadedPromise();
                        
                        // Find the contacts to get their source info
                        const contacts = ids.map(id => service.getContactById(id))
                            .filter(contact => contact && contact.sourceId !== "gal") // Filter out null contacts and GAL contacts
                            .map(contact => ({
                                sourceOwner: contact.sourceOwner,
                                sourceId: contact.sourceId,
                                id: contact.id
                            }));

                        if (contacts.length === 0) {
                            throw new Error('No valid contacts found to delete');
                        }

                        // Call delete-bulk API directly
                        await scope.$http.post('~/api/v1/contacts/delete-bulk', JSON.stringify(contacts));
                        break;
                    case 'event':
                        var deleteMetaData = [];
                        for(var i = 0; i < ids.length; i++){
                            deleteMetaData.push({ "owner": calendar.owner, "calendarId": calendar.id, "eventId": ids[i] });
                        }

                        scope.logMessage('DELETE METADATA', deleteMetaData);
                        const params = JSON.stringify(deleteMetaData);
                        var result = await scope.$http.post('~/api/v1/calendars/events/delete-bulk/', params);
                        scope.logMessage('DELETE RESULT', result);

                        await cs.removeCalendarEvents(ids);
                        break;
                    default:
                        throw new Error('Invalid item type');
                }
            }catch(e){
                scope.logError('Error removing items', e);
                return { success: false, error: e.message };
            }

            return { success: true, result: `Items removed` };
        }
    };

    static RemoveEmails = {
        function: {
            name: 'remove_emails',
            description: 'Remove emails from the system',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The id's of the emails to remove, comma separated."
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to remove the emails from.'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const mailService = scope.getService('coreDataMail');
            const uids = args.uid.split(',').map(id => id.trim());

            const parameters = {
                'UID': uids,
                'folder': args.folder,
                'ownerEmailAddress': '',
                'moveToDeleted': true
            };

            await scope.$http.post("~/api/v1/mail/delete-messages", parameters);
            return { success: true, result: `Emails removed` };
        }
    };

    static MoveEmails = {
        function: {
            name: 'move_emails',
            description: 'Move emails to a different folder',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The uid's of the emails to move, comma separated (get uids with read_emails_fast tool)."
                    },
                    src_folder: {
                        type: 'string',
                        description: 'The folder the emails are in.'
                    },
                    dest_folder: {
                        type: 'string',
                        description: 'The folder to move the emails to.'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');

            //uids need to not be strings
            const uids = args.uid.split(',').map(id => id.trim()).map(id => parseInt(id));

            //if src_folder is an integer, its a folder_id, fetch email folders and get the path
            if(typeof args.src_folder === 'number'){
                await coreMailService.loadMailTree();
                const folders = await coreMailService.getFolderList();
                const folder = folders.find(x => x.id == args.src_folder);
                args.src_folder = folder.path;
            }

            //if dest_folder is an integer, its a folder_id, fetch email folders and get the path
            if(typeof args.dest_folder === 'number'){
                await coreMailService.loadMailTree();
                const folders = await coreMailService.getFolderList();
                const folder = folders.find(x => x.id == args.dest_folder);
                args.dest_folder = folder.path;
            }


            const parameters = {
                'UID': uids,
                'folder': args.src_folder,
                'ownerEmailAddress': '',
                'destinationFolder': args.dest_folder,
                'destinationOwnerEmailAddress': ''
            };

            await scope.$http.post("~/api/v1/mail/move-messages", parameters);
            return { success: true, result: `Emails moved to ${args.dest_folder}` };
        }
    };

    static SetEmailProperties = {
        function: {
            name: 'set_email_properties',
            description: 'Mark emails as read/unread, flagged/unflagged, or add tags',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The id's of the emails to mark, comma separated."
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder the emails are in.'
                    },
                    read: {
                        type: 'boolean',
                        description: 'Whether to mark the emails as read or unread'
                    },
                    flagged: {
                        type: 'boolean',
                        description: 'Whether to mark the emails as flagged or unflagged'
                    },
                    tags: {
                        type: 'string',
                        description: 'The tags to add to the emails, comma separated'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const mailService = scope.getService('coreDataMail');
            const uids = args.uid.split(',').map(id => id.trim());

            const parameters = {
                'UID': uids,
                'folder': args.folder,
                'ownerEmailAddress': ''
            };

            if (args.read !== undefined) {
                parameters.markRead = args.read;
            }

            if (args.flagged !== undefined) {
                parameters.flagAction = {
                    type: args.flagged ? 'SetBasic' : 'Clear'
                };
            }

            if (args.tags) {
                parameters.categories = args.tags.split(',').map(tag => tag.trim());
            }

            await scope.$http.post("~/api/v1/mail/messages-patch", parameters);
            return { success: true, result: `Emails marked as ${args.read ? 'read' : 'unread'}, ${args.flagged ? 'flagged' : 'unflagged'}, and tagged with ${args.tags}` };
        }
    };

    static SendEmail = {
        function: {
            name: "send_email",
            description: "Send a simple email",
            parameters: {
                properties: {
                    to: {
                        type: 'string',
                        description: 'The email addresses to send the email to, separated by commas'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the email'
                    },
                    body: {
                        type: 'string',
                        description: 'The body of the email'
                    },
                    cc: {
                        type: 'string',
                        description: 'The email address to cc'
                    },
                    bcc: {
                        type: 'string',
                        description: 'The email address to bcc'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {

                var userInfo = scope.getUserInfo();

                const emailData = {
                    to: args.to,
                    subject: args.subject,
                    body: args.body,
                    cc: args.cc,
                    bcc: args.bcc,
                    isHtml: false
                };


                // Check if the to field is empty
                if(!emailData.to || emailData.to.length == 0 || emailData.to == 'undefined' || emailData.to == 'null'){
                    emailData.to = userInfo.emailAddress;
                }

                if(!emailData.subject || emailData.subject.length == 0 || emailData.subject == 'undefined' || emailData.subject == 'null'){
                    emailData.subject = 'No subject';
                }

                if(!emailData.body || emailData.body.length == 0 || emailData.body == 'undefined' || emailData.body == 'null'){
                    emailData.body = 'No body';
                }

                // Post directly to the mail API endpoint
                await scope.$http.post('~/api/v1/mail/message-put', {
                    to: emailData.to,
                    cc: emailData.cc || '',
                    bcc: emailData.bcc || '',
                    date: new Date(),
                    from: userInfo.emailAddress,
                    replyTo: userInfo.emailAddress,
                    subject: emailData.subject,
                    messageHTML: `<div>${emailData.body}</div>`,
                    priority: 1,
                    selectedFrom: `default:${userInfo.emailAddress}`
                });

                return { success: true, result: 'Email sent successfully' };
            } catch (error) {
                scope.logError('Error sending email:', error);
                return { success: false, error: error.message };
            }
        }
    };
} 

(window.sbaiTools ??= {}).SmarterMailTools = SmarterMailTools;



/***/ }),

/***/ 268:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmarterTrackPortalTools: () => (/* binding */ SmarterTrackPortalTools)
/* harmony export */ });
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

 

/***/ }),

/***/ 865:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   StackOverflowTools: () => (/* binding */ StackOverflowTools)
/* harmony export */ });
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

 

/***/ }),

/***/ 244:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TwitchTools: () => (/* binding */ TwitchTools)
/* harmony export */ });
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

 

/***/ }),

/***/ 686:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var map = {
	"./CarbonBarHelpTools.js": 450,
	"./GeneralTools.js": 565,
	"./external/BitbucketTools.js": 796,
	"./external/HackerNewsTools.js": 138,
	"./external/JiraTools.js": 541,
	"./external/RocketChatTools.js": 471,
	"./external/SmarterMailTools.js": 952,
	"./external/SmarterTrackPortalTools.js": 268,
	"./external/StackOverflowTools.js": 865,
	"./external/TwitchTools.js": 244
};


function webpackContext(req) {
	var id = webpackContextResolve(req);
	return __webpack_require__(id);
}
function webpackContextResolve(req) {
	if(!__webpack_require__.o(map, req)) {
		var e = new Error("Cannot find module '" + req + "'");
		e.code = 'MODULE_NOT_FOUND';
		throw e;
	}
	return map[req];
}
webpackContext.keys = function webpackContextKeys() {
	return Object.keys(map);
};
webpackContext.resolve = webpackContextResolve;
module.exports = webpackContext;
webpackContext.id = 686;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";

;// ./node_modules/marked/lib/marked.esm.js
/**
 * marked v15.0.6 - a markdown parser
 * Copyright (c) 2011-2025, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/markedjs/marked
 */

/**
 * DO NOT EDIT THIS FILE
 * The code in this file is generated from files in ./src/
 */

/**
 * Gets the original marked default options.
 */
function _getDefaults() {
    return {
        async: false,
        breaks: false,
        extensions: null,
        gfm: true,
        hooks: null,
        pedantic: false,
        renderer: null,
        silent: false,
        tokenizer: null,
        walkTokens: null,
    };
}
let _defaults = _getDefaults();
function changeDefaults(newDefaults) {
    _defaults = newDefaults;
}

const noopTest = { exec: () => null };
function edit(regex, opt = '') {
    let source = typeof regex === 'string' ? regex : regex.source;
    const obj = {
        replace: (name, val) => {
            let valSource = typeof val === 'string' ? val : val.source;
            valSource = valSource.replace(other.caret, '$1');
            source = source.replace(name, valSource);
            return obj;
        },
        getRegex: () => {
            return new RegExp(source, opt);
        },
    };
    return obj;
}
const other = {
    codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
    outputLinkReplace: /\\([\[\]])/g,
    indentCodeCompensation: /^(\s+)(?:```)/,
    beginningSpace: /^\s+/,
    endingHash: /#$/,
    startingSpaceChar: /^ /,
    endingSpaceChar: / $/,
    nonSpaceChar: /[^ ]/,
    newLineCharGlobal: /\n/g,
    tabCharGlobal: /\t/g,
    multipleSpaceGlobal: /\s+/g,
    blankLine: /^[ \t]*$/,
    doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
    blockquoteStart: /^ {0,3}>/,
    blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
    blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
    listReplaceTabs: /^\t+/,
    listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
    listIsTask: /^\[[ xX]\] /,
    listReplaceTask: /^\[[ xX]\] +/,
    anyLine: /\n.*\n/,
    hrefBrackets: /^<(.*)>$/,
    tableDelimiter: /[:|]/,
    tableAlignChars: /^\||\| *$/g,
    tableRowBlankLine: /\n[ \t]*$/,
    tableAlignRight: /^ *-+: *$/,
    tableAlignCenter: /^ *:-+: *$/,
    tableAlignLeft: /^ *:-+ *$/,
    startATag: /^<a /i,
    endATag: /^<\/a>/i,
    startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
    endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
    startAngleBracket: /^</,
    endAngleBracket: />$/,
    pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
    unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
    escapeTest: /[&<>"']/,
    escapeReplace: /[&<>"']/g,
    escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
    escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
    unescapeTest: /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,
    caret: /(^|[^\[])\^/g,
    percentDecode: /%25/g,
    findPipe: /\|/g,
    splitPipe: / \|/,
    slashPipe: /\\\|/g,
    carriageReturn: /\r\n|\r/g,
    spaceLine: /^ +$/gm,
    notSpaceStart: /^\S*/,
    endingNewline: /\n$/,
    listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`),
    nextBulletRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`),
    hrRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),
    fencesBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`),
    headingBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`),
    htmlBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}<(?:[a-z].*>|!--)`, 'i'),
};
/**
 * Block-Level Grammar
 */
const newline = /^(?:[ \t]*(?:\n|$))+/;
const blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
const hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const bullet = /(?:[*+-]|\d{1,9}[.)])/;
const lheading = edit(/^(?!bull |blockCode|fences|blockquote|heading|html)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html))+?)\n {0,3}(=+|-+) *(?:\n+|$)/)
    .replace(/bull/g, bullet) // lists can interrupt
    .replace(/blockCode/g, /(?: {4}| {0,3}\t)/) // indented code blocks can interrupt
    .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/) // fenced code blocks can interrupt
    .replace(/blockquote/g, / {0,3}>/) // blockquote can interrupt
    .replace(/heading/g, / {0,3}#{1,6}/) // ATX heading can interrupt
    .replace(/html/g, / {0,3}<[^\n>]+>\n/) // block html can interrupt
    .getRegex();
const _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
const blockText = /^[^\n]+/;
const _blockLabel = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
const def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
    .replace('label', _blockLabel)
    .replace('title', /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/)
    .getRegex();
const list = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/)
    .replace(/bull/g, bullet)
    .getRegex();
const _tag = 'address|article|aside|base|basefont|blockquote|body|caption'
    + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
    + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
    + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
    + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
    + '|tr|track|ul';
const _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const html = edit('^ {0,3}(?:' // optional indentation
    + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)' // (1)
    + '|comment[^\\n]*(\\n+|$)' // (2)
    + '|<\\?[\\s\\S]*?(?:\\?>\\n*|$)' // (3)
    + '|<![A-Z][\\s\\S]*?(?:>\\n*|$)' // (4)
    + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)' // (5)
    + '|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (6)
    + '|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) open tag
    + '|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) closing tag
    + ')', 'i')
    .replace('comment', _comment)
    .replace('tag', _tag)
    .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
    .getRegex();
const paragraph = edit(_paragraph)
    .replace('hr', hr)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
    .replace('|table', '')
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', _tag) // pars can be interrupted by type (6) html blocks
    .getRegex();
const blockquote = edit(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/)
    .replace('paragraph', paragraph)
    .getRegex();
/**
 * Normal Block Grammar
 */
const blockNormal = {
    blockquote,
    code: blockCode,
    def,
    fences,
    heading,
    hr,
    html,
    lheading,
    list,
    newline,
    paragraph,
    table: noopTest,
    text: blockText,
};
/**
 * GFM Block Grammar
 */
const gfmTable = edit('^ *([^\\n ].*)\\n' // Header
    + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)' // Align
    + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)') // Cells
    .replace('hr', hr)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('blockquote', ' {0,3}>')
    .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', _tag) // tables can be interrupted by type (6) html blocks
    .getRegex();
const blockGfm = {
    ...blockNormal,
    table: gfmTable,
    paragraph: edit(_paragraph)
        .replace('hr', hr)
        .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
        .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
        .replace('table', gfmTable) // interrupt paragraphs with table
        .replace('blockquote', ' {0,3}>')
        .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
        .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
        .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
        .replace('tag', _tag) // pars can be interrupted by type (6) html blocks
        .getRegex(),
};
/**
 * Pedantic grammar (original John Gruber's loose markdown specification)
 */
const blockPedantic = {
    ...blockNormal,
    html: edit('^ *(?:comment *(?:\\n|\\s*$)'
        + '|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)' // closed tag
        + '|<tag(?:"[^"]*"|\'[^\']*\'|\\s[^\'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))')
        .replace('comment', _comment)
        .replace(/tag/g, '(?!(?:'
        + 'a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub'
        + '|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)'
        + '\\b)\\w+(?!:|[^\\w\\s@]*@)\\b')
        .getRegex(),
    def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
    heading: /^(#{1,6})(.*)(?:\n+|$)/,
    fences: noopTest, // fences not supported
    lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
    paragraph: edit(_paragraph)
        .replace('hr', hr)
        .replace('heading', ' *#{1,6} *[^\n]')
        .replace('lheading', lheading)
        .replace('|table', '')
        .replace('blockquote', ' {0,3}>')
        .replace('|fences', '')
        .replace('|list', '')
        .replace('|html', '')
        .replace('|tag', '')
        .getRegex(),
};
/**
 * Inline-Level Grammar
 */
const escape$1 = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const br = /^( {2,}|\\)\n(?!\s*$)/;
const inlineText = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
// list of unicode punctuation marks, plus any missing characters from CommonMark spec
const _punctuation = /[\p{P}\p{S}]/u;
const _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;
const punctuation = edit(/^((?![*_])punctSpace)/, 'u')
    .replace(/punctSpace/g, _punctuationOrSpace).getRegex();
// GFM allows ~ inside strong and em for strikethrough
const _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
const _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;
// sequences em should skip over [title](link), `code`, <html>
const blockSkip = /\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g;
const emStrongLDelimCore = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/;
const emStrongLDelim = edit(emStrongLDelimCore, 'u')
    .replace(/punct/g, _punctuation)
    .getRegex();
const emStrongLDelimGfm = edit(emStrongLDelimCore, 'u')
    .replace(/punct/g, _punctuationGfmStrongEm)
    .getRegex();
const emStrongRDelimAstCore = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // Skip orphan inside strong
    + '|[^*]+(?=[^*])' // Consume to delim
    + '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1) #*** can only be a Right Delimiter
    + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2) a***#, a*** can only be a Right Delimiter
    + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3) #***a, ***a can only be Left Delimiter
    + '|[\\s](\\*+)(?!\\*)(?=punct)' // (4) ***# can only be Left Delimiter
    + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5) #***# can be either Left or Right Delimiter
    + '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6) a***a can be either Left or Right Delimiter
const emStrongRDelimAst = edit(emStrongRDelimAstCore, 'gu')
    .replace(/notPunctSpace/g, _notPunctuationOrSpace)
    .replace(/punctSpace/g, _punctuationOrSpace)
    .replace(/punct/g, _punctuation)
    .getRegex();
const emStrongRDelimAstGfm = edit(emStrongRDelimAstCore, 'gu')
    .replace(/notPunctSpace/g, _notPunctuationOrSpaceGfmStrongEm)
    .replace(/punctSpace/g, _punctuationOrSpaceGfmStrongEm)
    .replace(/punct/g, _punctuationGfmStrongEm)
    .getRegex();
// (6) Not allowed for _
const emStrongRDelimUnd = edit('^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)' // Skip orphan inside strong
    + '|[^_]+(?=[^_])' // Consume to delim
    + '|(?!_)punct(_+)(?=[\\s]|$)' // (1) #___ can only be a Right Delimiter
    + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' // (2) a___#, a___ can only be a Right Delimiter
    + '|(?!_)punctSpace(_+)(?=notPunctSpace)' // (3) #___a, ___a can only be Left Delimiter
    + '|[\\s](_+)(?!_)(?=punct)' // (4) ___# can only be Left Delimiter
    + '|(?!_)punct(_+)(?!_)(?=punct)', 'gu') // (5) #___# can be either Left or Right Delimiter
    .replace(/notPunctSpace/g, _notPunctuationOrSpace)
    .replace(/punctSpace/g, _punctuationOrSpace)
    .replace(/punct/g, _punctuation)
    .getRegex();
const anyPunctuation = edit(/\\(punct)/, 'gu')
    .replace(/punct/g, _punctuation)
    .getRegex();
const autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
    .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
    .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
    .getRegex();
const _inlineComment = edit(_comment).replace('(?:-->|$)', '-->').getRegex();
const tag = edit('^comment'
    + '|^</[a-zA-Z][\\w:-]*\\s*>' // self-closing tag
    + '|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>' // open tag
    + '|^<\\?[\\s\\S]*?\\?>' // processing instruction, e.g. <?php ?>
    + '|^<![a-zA-Z]+\\s[\\s\\S]*?>' // declaration, e.g. <!DOCTYPE html>
    + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>') // CDATA section
    .replace('comment', _inlineComment)
    .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
    .getRegex();
const _inlineLabel = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
const marked_esm_link = edit(/^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/)
    .replace('label', _inlineLabel)
    .replace('href', /<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/)
    .replace('title', /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/)
    .getRegex();
const reflink = edit(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', _inlineLabel)
    .replace('ref', _blockLabel)
    .getRegex();
const nolink = edit(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', _blockLabel)
    .getRegex();
const reflinkSearch = edit('reflink|nolink(?!\\()', 'g')
    .replace('reflink', reflink)
    .replace('nolink', nolink)
    .getRegex();
/**
 * Normal Inline Grammar
 */
const inlineNormal = {
    _backpedal: noopTest, // only used for GFM url
    anyPunctuation,
    autolink,
    blockSkip,
    br,
    code: inlineCode,
    del: noopTest,
    emStrongLDelim,
    emStrongRDelimAst,
    emStrongRDelimUnd,
    escape: escape$1,
    link: marked_esm_link,
    nolink,
    punctuation,
    reflink,
    reflinkSearch,
    tag,
    text: inlineText,
    url: noopTest,
};
/**
 * Pedantic Inline Grammar
 */
const inlinePedantic = {
    ...inlineNormal,
    link: edit(/^!?\[(label)\]\((.*?)\)/)
        .replace('label', _inlineLabel)
        .getRegex(),
    reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/)
        .replace('label', _inlineLabel)
        .getRegex(),
};
/**
 * GFM Inline Grammar
 */
const inlineGfm = {
    ...inlineNormal,
    emStrongRDelimAst: emStrongRDelimAstGfm,
    emStrongLDelim: emStrongLDelimGfm,
    url: edit(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/, 'i')
        .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/)
        .getRegex(),
    _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
    del: /^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,
    text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/,
};
/**
 * GFM + Line Breaks Inline Grammar
 */
const inlineBreaks = {
    ...inlineGfm,
    br: edit(br).replace('{2,}', '*').getRegex(),
    text: edit(inlineGfm.text)
        .replace('\\b_', '\\b_| {2,}\\n')
        .replace(/\{2,\}/g, '*')
        .getRegex(),
};
/**
 * exports
 */
const block = {
    normal: blockNormal,
    gfm: blockGfm,
    pedantic: blockPedantic,
};
const inline = {
    normal: inlineNormal,
    gfm: inlineGfm,
    breaks: inlineBreaks,
    pedantic: inlinePedantic,
};

/**
 * Helpers
 */
const escapeReplacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};
const getEscapeReplacement = (ch) => escapeReplacements[ch];
function marked_esm_escape(html, encode) {
    if (encode) {
        if (other.escapeTest.test(html)) {
            return html.replace(other.escapeReplace, getEscapeReplacement);
        }
    }
    else {
        if (other.escapeTestNoEncode.test(html)) {
            return html.replace(other.escapeReplaceNoEncode, getEscapeReplacement);
        }
    }
    return html;
}
function cleanUrl(href) {
    try {
        href = encodeURI(href).replace(other.percentDecode, '%');
    }
    catch {
        return null;
    }
    return href;
}
function splitCells(tableRow, count) {
    // ensure that every cell-delimiting pipe has a space
    // before it to distinguish it from an escaped pipe
    const row = tableRow.replace(other.findPipe, (match, offset, str) => {
        let escaped = false;
        let curr = offset;
        while (--curr >= 0 && str[curr] === '\\')
            escaped = !escaped;
        if (escaped) {
            // odd number of slashes means | is escaped
            // so we leave it alone
            return '|';
        }
        else {
            // add space before unescaped |
            return ' |';
        }
    }), cells = row.split(other.splitPipe);
    let i = 0;
    // First/last cell in a row cannot be empty if it has no leading/trailing pipe
    if (!cells[0].trim()) {
        cells.shift();
    }
    if (cells.length > 0 && !cells.at(-1)?.trim()) {
        cells.pop();
    }
    if (count) {
        if (cells.length > count) {
            cells.splice(count);
        }
        else {
            while (cells.length < count)
                cells.push('');
        }
    }
    for (; i < cells.length; i++) {
        // leading or trailing whitespace is ignored per the gfm spec
        cells[i] = cells[i].trim().replace(other.slashPipe, '|');
    }
    return cells;
}
/**
 * Remove trailing 'c's. Equivalent to str.replace(/c*$/, '').
 * /c*$/ is vulnerable to REDOS.
 *
 * @param str
 * @param c
 * @param invert Remove suffix of non-c chars instead. Default falsey.
 */
function rtrim(str, c, invert) {
    const l = str.length;
    if (l === 0) {
        return '';
    }
    // Length of suffix matching the invert condition.
    let suffLen = 0;
    // Step left until we fail to match the invert condition.
    while (suffLen < l) {
        const currChar = str.charAt(l - suffLen - 1);
        if (currChar === c && true) {
            suffLen++;
        }
        else {
            break;
        }
    }
    return str.slice(0, l - suffLen);
}
function findClosingBracket(str, b) {
    if (str.indexOf(b[1]) === -1) {
        return -1;
    }
    let level = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '\\') {
            i++;
        }
        else if (str[i] === b[0]) {
            level++;
        }
        else if (str[i] === b[1]) {
            level--;
            if (level < 0) {
                return i;
            }
        }
    }
    return -1;
}

function outputLink(cap, link, raw, lexer, rules) {
    const href = link.href;
    const title = link.title || null;
    const text = cap[1].replace(rules.other.outputLinkReplace, '$1');
    if (cap[0].charAt(0) !== '!') {
        lexer.state.inLink = true;
        const token = {
            type: 'link',
            raw,
            href,
            title,
            text,
            tokens: lexer.inlineTokens(text),
        };
        lexer.state.inLink = false;
        return token;
    }
    return {
        type: 'image',
        raw,
        href,
        title,
        text,
    };
}
function indentCodeCompensation(raw, text, rules) {
    const matchIndentToCode = raw.match(rules.other.indentCodeCompensation);
    if (matchIndentToCode === null) {
        return text;
    }
    const indentToCode = matchIndentToCode[1];
    return text
        .split('\n')
        .map(node => {
        const matchIndentInNode = node.match(rules.other.beginningSpace);
        if (matchIndentInNode === null) {
            return node;
        }
        const [indentInNode] = matchIndentInNode;
        if (indentInNode.length >= indentToCode.length) {
            return node.slice(indentToCode.length);
        }
        return node;
    })
        .join('\n');
}
/**
 * Tokenizer
 */
class _Tokenizer {
    options;
    rules; // set by the lexer
    lexer; // set by the lexer
    constructor(options) {
        this.options = options || _defaults;
    }
    space(src) {
        const cap = this.rules.block.newline.exec(src);
        if (cap && cap[0].length > 0) {
            return {
                type: 'space',
                raw: cap[0],
            };
        }
    }
    code(src) {
        const cap = this.rules.block.code.exec(src);
        if (cap) {
            const text = cap[0].replace(this.rules.other.codeRemoveIndent, '');
            return {
                type: 'code',
                raw: cap[0],
                codeBlockStyle: 'indented',
                text: !this.options.pedantic
                    ? rtrim(text, '\n')
                    : text,
            };
        }
    }
    fences(src) {
        const cap = this.rules.block.fences.exec(src);
        if (cap) {
            const raw = cap[0];
            const text = indentCodeCompensation(raw, cap[3] || '', this.rules);
            return {
                type: 'code',
                raw,
                lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, '$1') : cap[2],
                text,
            };
        }
    }
    heading(src) {
        const cap = this.rules.block.heading.exec(src);
        if (cap) {
            let text = cap[2].trim();
            // remove trailing #s
            if (this.rules.other.endingHash.test(text)) {
                const trimmed = rtrim(text, '#');
                if (this.options.pedantic) {
                    text = trimmed.trim();
                }
                else if (!trimmed || this.rules.other.endingSpaceChar.test(trimmed)) {
                    // CommonMark requires space before trailing #s
                    text = trimmed.trim();
                }
            }
            return {
                type: 'heading',
                raw: cap[0],
                depth: cap[1].length,
                text,
                tokens: this.lexer.inline(text),
            };
        }
    }
    hr(src) {
        const cap = this.rules.block.hr.exec(src);
        if (cap) {
            return {
                type: 'hr',
                raw: rtrim(cap[0], '\n'),
            };
        }
    }
    blockquote(src) {
        const cap = this.rules.block.blockquote.exec(src);
        if (cap) {
            let lines = rtrim(cap[0], '\n').split('\n');
            let raw = '';
            let text = '';
            const tokens = [];
            while (lines.length > 0) {
                let inBlockquote = false;
                const currentLines = [];
                let i;
                for (i = 0; i < lines.length; i++) {
                    // get lines up to a continuation
                    if (this.rules.other.blockquoteStart.test(lines[i])) {
                        currentLines.push(lines[i]);
                        inBlockquote = true;
                    }
                    else if (!inBlockquote) {
                        currentLines.push(lines[i]);
                    }
                    else {
                        break;
                    }
                }
                lines = lines.slice(i);
                const currentRaw = currentLines.join('\n');
                const currentText = currentRaw
                    // precede setext continuation with 4 spaces so it isn't a setext
                    .replace(this.rules.other.blockquoteSetextReplace, '\n    $1')
                    .replace(this.rules.other.blockquoteSetextReplace2, '');
                raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
                text = text ? `${text}\n${currentText}` : currentText;
                // parse blockquote lines as top level tokens
                // merge paragraphs if this is a continuation
                const top = this.lexer.state.top;
                this.lexer.state.top = true;
                this.lexer.blockTokens(currentText, tokens, true);
                this.lexer.state.top = top;
                // if there is no continuation then we are done
                if (lines.length === 0) {
                    break;
                }
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'code') {
                    // blockquote continuation cannot be preceded by a code block
                    break;
                }
                else if (lastToken?.type === 'blockquote') {
                    // include continuation in nested blockquote
                    const oldToken = lastToken;
                    const newText = oldToken.raw + '\n' + lines.join('\n');
                    const newToken = this.blockquote(newText);
                    tokens[tokens.length - 1] = newToken;
                    raw = raw.substring(0, raw.length - oldToken.raw.length) + newToken.raw;
                    text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
                    break;
                }
                else if (lastToken?.type === 'list') {
                    // include continuation in nested list
                    const oldToken = lastToken;
                    const newText = oldToken.raw + '\n' + lines.join('\n');
                    const newToken = this.list(newText);
                    tokens[tokens.length - 1] = newToken;
                    raw = raw.substring(0, raw.length - lastToken.raw.length) + newToken.raw;
                    text = text.substring(0, text.length - oldToken.raw.length) + newToken.raw;
                    lines = newText.substring(tokens.at(-1).raw.length).split('\n');
                    continue;
                }
            }
            return {
                type: 'blockquote',
                raw,
                tokens,
                text,
            };
        }
    }
    list(src) {
        let cap = this.rules.block.list.exec(src);
        if (cap) {
            let bull = cap[1].trim();
            const isordered = bull.length > 1;
            const list = {
                type: 'list',
                raw: '',
                ordered: isordered,
                start: isordered ? +bull.slice(0, -1) : '',
                loose: false,
                items: [],
            };
            bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
            if (this.options.pedantic) {
                bull = isordered ? bull : '[*+-]';
            }
            // Get next list item
            const itemRegex = this.rules.other.listItemRegex(bull);
            let endsWithBlankLine = false;
            // Check if current bullet point can start a new List Item
            while (src) {
                let endEarly = false;
                let raw = '';
                let itemContents = '';
                if (!(cap = itemRegex.exec(src))) {
                    break;
                }
                if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
                    break;
                }
                raw = cap[0];
                src = src.substring(raw.length);
                let line = cap[2].split('\n', 1)[0].replace(this.rules.other.listReplaceTabs, (t) => ' '.repeat(3 * t.length));
                let nextLine = src.split('\n', 1)[0];
                let blankLine = !line.trim();
                let indent = 0;
                if (this.options.pedantic) {
                    indent = 2;
                    itemContents = line.trimStart();
                }
                else if (blankLine) {
                    indent = cap[1].length + 1;
                }
                else {
                    indent = cap[2].search(this.rules.other.nonSpaceChar); // Find first non-space char
                    indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
                    itemContents = line.slice(indent);
                    indent += cap[1].length;
                }
                if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
                    raw += nextLine + '\n';
                    src = src.substring(nextLine.length + 1);
                    endEarly = true;
                }
                if (!endEarly) {
                    const nextBulletRegex = this.rules.other.nextBulletRegex(indent);
                    const hrRegex = this.rules.other.hrRegex(indent);
                    const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent);
                    const headingBeginRegex = this.rules.other.headingBeginRegex(indent);
                    const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent);
                    // Check if following lines should be included in List Item
                    while (src) {
                        const rawLine = src.split('\n', 1)[0];
                        let nextLineWithoutTabs;
                        nextLine = rawLine;
                        // Re-align to follow commonmark nesting rules
                        if (this.options.pedantic) {
                            nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ');
                            nextLineWithoutTabs = nextLine;
                        }
                        else {
                            nextLineWithoutTabs = nextLine.replace(this.rules.other.tabCharGlobal, '    ');
                        }
                        // End list item if found code fences
                        if (fencesBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of new heading
                        if (headingBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of html block
                        if (htmlBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of new bullet
                        if (nextBulletRegex.test(nextLine)) {
                            break;
                        }
                        // Horizontal rule found
                        if (hrRegex.test(nextLine)) {
                            break;
                        }
                        if (nextLineWithoutTabs.search(this.rules.other.nonSpaceChar) >= indent || !nextLine.trim()) { // Dedent if possible
                            itemContents += '\n' + nextLineWithoutTabs.slice(indent);
                        }
                        else {
                            // not enough indentation
                            if (blankLine) {
                                break;
                            }
                            // paragraph continuation unless last line was a different block level element
                            if (line.replace(this.rules.other.tabCharGlobal, '    ').search(this.rules.other.nonSpaceChar) >= 4) { // indented code block
                                break;
                            }
                            if (fencesBeginRegex.test(line)) {
                                break;
                            }
                            if (headingBeginRegex.test(line)) {
                                break;
                            }
                            if (hrRegex.test(line)) {
                                break;
                            }
                            itemContents += '\n' + nextLine;
                        }
                        if (!blankLine && !nextLine.trim()) { // Check if current line is blank
                            blankLine = true;
                        }
                        raw += rawLine + '\n';
                        src = src.substring(rawLine.length + 1);
                        line = nextLineWithoutTabs.slice(indent);
                    }
                }
                if (!list.loose) {
                    // If the previous item ended with a blank line, the list is loose
                    if (endsWithBlankLine) {
                        list.loose = true;
                    }
                    else if (this.rules.other.doubleBlankLine.test(raw)) {
                        endsWithBlankLine = true;
                    }
                }
                let istask = null;
                let ischecked;
                // Check for task list items
                if (this.options.gfm) {
                    istask = this.rules.other.listIsTask.exec(itemContents);
                    if (istask) {
                        ischecked = istask[0] !== '[ ] ';
                        itemContents = itemContents.replace(this.rules.other.listReplaceTask, '');
                    }
                }
                list.items.push({
                    type: 'list_item',
                    raw,
                    task: !!istask,
                    checked: ischecked,
                    loose: false,
                    text: itemContents,
                    tokens: [],
                });
                list.raw += raw;
            }
            // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
            const lastItem = list.items.at(-1);
            if (lastItem) {
                lastItem.raw = lastItem.raw.trimEnd();
                lastItem.text = lastItem.text.trimEnd();
            }
            else {
                // not a list since there were no items
                return;
            }
            list.raw = list.raw.trimEnd();
            // Item child tokens handled here at end because we needed to have the final item to trim it first
            for (let i = 0; i < list.items.length; i++) {
                this.lexer.state.top = false;
                list.items[i].tokens = this.lexer.blockTokens(list.items[i].text, []);
                if (!list.loose) {
                    // Check if list should be loose
                    const spacers = list.items[i].tokens.filter(t => t.type === 'space');
                    const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => this.rules.other.anyLine.test(t.raw));
                    list.loose = hasMultipleLineBreaks;
                }
            }
            // Set all items to loose if list is loose
            if (list.loose) {
                for (let i = 0; i < list.items.length; i++) {
                    list.items[i].loose = true;
                }
            }
            return list;
        }
    }
    html(src) {
        const cap = this.rules.block.html.exec(src);
        if (cap) {
            const token = {
                type: 'html',
                block: true,
                raw: cap[0],
                pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
                text: cap[0],
            };
            return token;
        }
    }
    def(src) {
        const cap = this.rules.block.def.exec(src);
        if (cap) {
            const tag = cap[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, ' ');
            const href = cap[2] ? cap[2].replace(this.rules.other.hrefBrackets, '$1').replace(this.rules.inline.anyPunctuation, '$1') : '';
            const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, '$1') : cap[3];
            return {
                type: 'def',
                tag,
                raw: cap[0],
                href,
                title,
            };
        }
    }
    table(src) {
        const cap = this.rules.block.table.exec(src);
        if (!cap) {
            return;
        }
        if (!this.rules.other.tableDelimiter.test(cap[2])) {
            // delimiter row must have a pipe (|) or colon (:) otherwise it is a setext heading
            return;
        }
        const headers = splitCells(cap[1]);
        const aligns = cap[2].replace(this.rules.other.tableAlignChars, '').split('|');
        const rows = cap[3]?.trim() ? cap[3].replace(this.rules.other.tableRowBlankLine, '').split('\n') : [];
        const item = {
            type: 'table',
            raw: cap[0],
            header: [],
            align: [],
            rows: [],
        };
        if (headers.length !== aligns.length) {
            // header and align columns must be equal, rows can be different.
            return;
        }
        for (const align of aligns) {
            if (this.rules.other.tableAlignRight.test(align)) {
                item.align.push('right');
            }
            else if (this.rules.other.tableAlignCenter.test(align)) {
                item.align.push('center');
            }
            else if (this.rules.other.tableAlignLeft.test(align)) {
                item.align.push('left');
            }
            else {
                item.align.push(null);
            }
        }
        for (let i = 0; i < headers.length; i++) {
            item.header.push({
                text: headers[i],
                tokens: this.lexer.inline(headers[i]),
                header: true,
                align: item.align[i],
            });
        }
        for (const row of rows) {
            item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
                return {
                    text: cell,
                    tokens: this.lexer.inline(cell),
                    header: false,
                    align: item.align[i],
                };
            }));
        }
        return item;
    }
    lheading(src) {
        const cap = this.rules.block.lheading.exec(src);
        if (cap) {
            return {
                type: 'heading',
                raw: cap[0],
                depth: cap[2].charAt(0) === '=' ? 1 : 2,
                text: cap[1],
                tokens: this.lexer.inline(cap[1]),
            };
        }
    }
    paragraph(src) {
        const cap = this.rules.block.paragraph.exec(src);
        if (cap) {
            const text = cap[1].charAt(cap[1].length - 1) === '\n'
                ? cap[1].slice(0, -1)
                : cap[1];
            return {
                type: 'paragraph',
                raw: cap[0],
                text,
                tokens: this.lexer.inline(text),
            };
        }
    }
    text(src) {
        const cap = this.rules.block.text.exec(src);
        if (cap) {
            return {
                type: 'text',
                raw: cap[0],
                text: cap[0],
                tokens: this.lexer.inline(cap[0]),
            };
        }
    }
    escape(src) {
        const cap = this.rules.inline.escape.exec(src);
        if (cap) {
            return {
                type: 'escape',
                raw: cap[0],
                text: cap[1],
            };
        }
    }
    tag(src) {
        const cap = this.rules.inline.tag.exec(src);
        if (cap) {
            if (!this.lexer.state.inLink && this.rules.other.startATag.test(cap[0])) {
                this.lexer.state.inLink = true;
            }
            else if (this.lexer.state.inLink && this.rules.other.endATag.test(cap[0])) {
                this.lexer.state.inLink = false;
            }
            if (!this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(cap[0])) {
                this.lexer.state.inRawBlock = true;
            }
            else if (this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(cap[0])) {
                this.lexer.state.inRawBlock = false;
            }
            return {
                type: 'html',
                raw: cap[0],
                inLink: this.lexer.state.inLink,
                inRawBlock: this.lexer.state.inRawBlock,
                block: false,
                text: cap[0],
            };
        }
    }
    link(src) {
        const cap = this.rules.inline.link.exec(src);
        if (cap) {
            const trimmedUrl = cap[2].trim();
            if (!this.options.pedantic && this.rules.other.startAngleBracket.test(trimmedUrl)) {
                // commonmark requires matching angle brackets
                if (!(this.rules.other.endAngleBracket.test(trimmedUrl))) {
                    return;
                }
                // ending angle bracket cannot be escaped
                const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
                if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
                    return;
                }
            }
            else {
                // find closing parenthesis
                const lastParenIndex = findClosingBracket(cap[2], '()');
                if (lastParenIndex > -1) {
                    const start = cap[0].indexOf('!') === 0 ? 5 : 4;
                    const linkLen = start + cap[1].length + lastParenIndex;
                    cap[2] = cap[2].substring(0, lastParenIndex);
                    cap[0] = cap[0].substring(0, linkLen).trim();
                    cap[3] = '';
                }
            }
            let href = cap[2];
            let title = '';
            if (this.options.pedantic) {
                // split pedantic href and title
                const link = this.rules.other.pedanticHrefTitle.exec(href);
                if (link) {
                    href = link[1];
                    title = link[3];
                }
            }
            else {
                title = cap[3] ? cap[3].slice(1, -1) : '';
            }
            href = href.trim();
            if (this.rules.other.startAngleBracket.test(href)) {
                if (this.options.pedantic && !(this.rules.other.endAngleBracket.test(trimmedUrl))) {
                    // pedantic allows starting angle bracket without ending angle bracket
                    href = href.slice(1);
                }
                else {
                    href = href.slice(1, -1);
                }
            }
            return outputLink(cap, {
                href: href ? href.replace(this.rules.inline.anyPunctuation, '$1') : href,
                title: title ? title.replace(this.rules.inline.anyPunctuation, '$1') : title,
            }, cap[0], this.lexer, this.rules);
        }
    }
    reflink(src, links) {
        let cap;
        if ((cap = this.rules.inline.reflink.exec(src))
            || (cap = this.rules.inline.nolink.exec(src))) {
            const linkString = (cap[2] || cap[1]).replace(this.rules.other.multipleSpaceGlobal, ' ');
            const link = links[linkString.toLowerCase()];
            if (!link) {
                const text = cap[0].charAt(0);
                return {
                    type: 'text',
                    raw: text,
                    text,
                };
            }
            return outputLink(cap, link, cap[0], this.lexer, this.rules);
        }
    }
    emStrong(src, maskedSrc, prevChar = '') {
        let match = this.rules.inline.emStrongLDelim.exec(src);
        if (!match)
            return;
        // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
        if (match[3] && prevChar.match(this.rules.other.unicodeAlphaNumeric))
            return;
        const nextChar = match[1] || match[2] || '';
        if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
            // unicode Regex counts emoji as 1 char; spread into array for proper count (used multiple times below)
            const lLength = [...match[0]].length - 1;
            let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
            const endReg = match[0][0] === '*' ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
            endReg.lastIndex = 0;
            // Clip maskedSrc to same section of string as src (move to lexer?)
            maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
            while ((match = endReg.exec(maskedSrc)) != null) {
                rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
                if (!rDelim)
                    continue; // skip single * in __abc*abc__
                rLength = [...rDelim].length;
                if (match[3] || match[4]) { // found another Left Delim
                    delimTotal += rLength;
                    continue;
                }
                else if (match[5] || match[6]) { // either Left or Right Delim
                    if (lLength % 3 && !((lLength + rLength) % 3)) {
                        midDelimTotal += rLength;
                        continue; // CommonMark Emphasis Rules 9-10
                    }
                }
                delimTotal -= rLength;
                if (delimTotal > 0)
                    continue; // Haven't found enough closing delimiters
                // Remove extra characters. *a*** -> *a*
                rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
                // char length can be >1 for unicode characters;
                const lastCharLength = [...match[0]][0].length;
                const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
                // Create `em` if smallest delimiter has odd char count. *a***
                if (Math.min(lLength, rLength) % 2) {
                    const text = raw.slice(1, -1);
                    return {
                        type: 'em',
                        raw,
                        text,
                        tokens: this.lexer.inlineTokens(text),
                    };
                }
                // Create 'strong' if smallest delimiter has even char count. **a***
                const text = raw.slice(2, -2);
                return {
                    type: 'strong',
                    raw,
                    text,
                    tokens: this.lexer.inlineTokens(text),
                };
            }
        }
    }
    codespan(src) {
        const cap = this.rules.inline.code.exec(src);
        if (cap) {
            let text = cap[2].replace(this.rules.other.newLineCharGlobal, ' ');
            const hasNonSpaceChars = this.rules.other.nonSpaceChar.test(text);
            const hasSpaceCharsOnBothEnds = this.rules.other.startingSpaceChar.test(text) && this.rules.other.endingSpaceChar.test(text);
            if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
                text = text.substring(1, text.length - 1);
            }
            return {
                type: 'codespan',
                raw: cap[0],
                text,
            };
        }
    }
    br(src) {
        const cap = this.rules.inline.br.exec(src);
        if (cap) {
            return {
                type: 'br',
                raw: cap[0],
            };
        }
    }
    del(src) {
        const cap = this.rules.inline.del.exec(src);
        if (cap) {
            return {
                type: 'del',
                raw: cap[0],
                text: cap[2],
                tokens: this.lexer.inlineTokens(cap[2]),
            };
        }
    }
    autolink(src) {
        const cap = this.rules.inline.autolink.exec(src);
        if (cap) {
            let text, href;
            if (cap[2] === '@') {
                text = cap[1];
                href = 'mailto:' + text;
            }
            else {
                text = cap[1];
                href = text;
            }
            return {
                type: 'link',
                raw: cap[0],
                text,
                href,
                tokens: [
                    {
                        type: 'text',
                        raw: text,
                        text,
                    },
                ],
            };
        }
    }
    url(src) {
        let cap;
        if (cap = this.rules.inline.url.exec(src)) {
            let text, href;
            if (cap[2] === '@') {
                text = cap[0];
                href = 'mailto:' + text;
            }
            else {
                // do extended autolink path validation
                let prevCapZero;
                do {
                    prevCapZero = cap[0];
                    cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? '';
                } while (prevCapZero !== cap[0]);
                text = cap[0];
                if (cap[1] === 'www.') {
                    href = 'http://' + cap[0];
                }
                else {
                    href = cap[0];
                }
            }
            return {
                type: 'link',
                raw: cap[0],
                text,
                href,
                tokens: [
                    {
                        type: 'text',
                        raw: text,
                        text,
                    },
                ],
            };
        }
    }
    inlineText(src) {
        const cap = this.rules.inline.text.exec(src);
        if (cap) {
            const escaped = this.lexer.state.inRawBlock;
            return {
                type: 'text',
                raw: cap[0],
                text: cap[0],
                escaped,
            };
        }
    }
}

/**
 * Block Lexer
 */
class _Lexer {
    tokens;
    options;
    state;
    tokenizer;
    inlineQueue;
    constructor(options) {
        // TokenList cannot be created in one go
        this.tokens = [];
        this.tokens.links = Object.create(null);
        this.options = options || _defaults;
        this.options.tokenizer = this.options.tokenizer || new _Tokenizer();
        this.tokenizer = this.options.tokenizer;
        this.tokenizer.options = this.options;
        this.tokenizer.lexer = this;
        this.inlineQueue = [];
        this.state = {
            inLink: false,
            inRawBlock: false,
            top: true,
        };
        const rules = {
            other,
            block: block.normal,
            inline: inline.normal,
        };
        if (this.options.pedantic) {
            rules.block = block.pedantic;
            rules.inline = inline.pedantic;
        }
        else if (this.options.gfm) {
            rules.block = block.gfm;
            if (this.options.breaks) {
                rules.inline = inline.breaks;
            }
            else {
                rules.inline = inline.gfm;
            }
        }
        this.tokenizer.rules = rules;
    }
    /**
     * Expose Rules
     */
    static get rules() {
        return {
            block,
            inline,
        };
    }
    /**
     * Static Lex Method
     */
    static lex(src, options) {
        const lexer = new _Lexer(options);
        return lexer.lex(src);
    }
    /**
     * Static Lex Inline Method
     */
    static lexInline(src, options) {
        const lexer = new _Lexer(options);
        return lexer.inlineTokens(src);
    }
    /**
     * Preprocessing
     */
    lex(src) {
        src = src.replace(other.carriageReturn, '\n');
        this.blockTokens(src, this.tokens);
        for (let i = 0; i < this.inlineQueue.length; i++) {
            const next = this.inlineQueue[i];
            this.inlineTokens(next.src, next.tokens);
        }
        this.inlineQueue = [];
        return this.tokens;
    }
    blockTokens(src, tokens = [], lastParagraphClipped = false) {
        if (this.options.pedantic) {
            src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
        }
        while (src) {
            let token;
            if (this.options.extensions?.block?.some((extTokenizer) => {
                if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
                    src = src.substring(token.raw.length);
                    tokens.push(token);
                    return true;
                }
                return false;
            })) {
                continue;
            }
            // newline
            if (token = this.tokenizer.space(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (token.raw.length === 1 && lastToken !== undefined) {
                    // if there's a single \n as a spacer, it's terminating the last line,
                    // so move it there so that we don't get unnecessary paragraph tags
                    lastToken.raw += '\n';
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // code
            if (token = this.tokenizer.code(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                // An indented code block cannot interrupt a paragraph.
                if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // fences
            if (token = this.tokenizer.fences(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // heading
            if (token = this.tokenizer.heading(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // hr
            if (token = this.tokenizer.hr(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // blockquote
            if (token = this.tokenizer.blockquote(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // list
            if (token = this.tokenizer.list(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // html
            if (token = this.tokenizer.html(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // def
            if (token = this.tokenizer.def(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.raw;
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else if (!this.tokens.links[token.tag]) {
                    this.tokens.links[token.tag] = {
                        href: token.href,
                        title: token.title,
                    };
                }
                continue;
            }
            // table (gfm)
            if (token = this.tokenizer.table(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // lheading
            if (token = this.tokenizer.lheading(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // top-level paragraph
            // prevent paragraph consuming extensions by clipping 'src' to extension start
            let cutSrc = src;
            if (this.options.extensions?.startBlock) {
                let startIndex = Infinity;
                const tempSrc = src.slice(1);
                let tempStart;
                this.options.extensions.startBlock.forEach((getStartIndex) => {
                    tempStart = getStartIndex.call({ lexer: this }, tempSrc);
                    if (typeof tempStart === 'number' && tempStart >= 0) {
                        startIndex = Math.min(startIndex, tempStart);
                    }
                });
                if (startIndex < Infinity && startIndex >= 0) {
                    cutSrc = src.substring(0, startIndex + 1);
                }
            }
            if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
                const lastToken = tokens.at(-1);
                if (lastParagraphClipped && lastToken?.type === 'paragraph') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.pop();
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                lastParagraphClipped = cutSrc.length !== src.length;
                src = src.substring(token.raw.length);
                continue;
            }
            // text
            if (token = this.tokenizer.text(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.pop();
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            if (src) {
                const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
                if (this.options.silent) {
                    console.error(errMsg);
                    break;
                }
                else {
                    throw new Error(errMsg);
                }
            }
        }
        this.state.top = true;
        return tokens;
    }
    inline(src, tokens = []) {
        this.inlineQueue.push({ src, tokens });
        return tokens;
    }
    /**
     * Lexing/Compiling
     */
    inlineTokens(src, tokens = []) {
        // String with links masked to avoid interference with em and strong
        let maskedSrc = src;
        let match = null;
        // Mask out reflinks
        if (this.tokens.links) {
            const links = Object.keys(this.tokens.links);
            if (links.length > 0) {
                while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
                    if (links.includes(match[0].slice(match[0].lastIndexOf('[') + 1, -1))) {
                        maskedSrc = maskedSrc.slice(0, match.index)
                            + '[' + 'a'.repeat(match[0].length - 2) + ']'
                            + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
                    }
                }
            }
        }
        // Mask out other blocks
        while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
            maskedSrc = maskedSrc.slice(0, match.index) + '[' + 'a'.repeat(match[0].length - 2) + ']' + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
        }
        // Mask out escaped characters
        while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
            maskedSrc = maskedSrc.slice(0, match.index) + '++' + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
        }
        let keepPrevChar = false;
        let prevChar = '';
        while (src) {
            if (!keepPrevChar) {
                prevChar = '';
            }
            keepPrevChar = false;
            let token;
            // extensions
            if (this.options.extensions?.inline?.some((extTokenizer) => {
                if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
                    src = src.substring(token.raw.length);
                    tokens.push(token);
                    return true;
                }
                return false;
            })) {
                continue;
            }
            // escape
            if (token = this.tokenizer.escape(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // tag
            if (token = this.tokenizer.tag(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // link
            if (token = this.tokenizer.link(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // reflink, nolink
            if (token = this.tokenizer.reflink(src, this.tokens.links)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (token.type === 'text' && lastToken?.type === 'text') {
                    lastToken.raw += token.raw;
                    lastToken.text += token.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // em & strong
            if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // code
            if (token = this.tokenizer.codespan(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // br
            if (token = this.tokenizer.br(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // del (gfm)
            if (token = this.tokenizer.del(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // autolink
            if (token = this.tokenizer.autolink(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // url (gfm)
            if (!this.state.inLink && (token = this.tokenizer.url(src))) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // text
            // prevent inlineText consuming extensions by clipping 'src' to extension start
            let cutSrc = src;
            if (this.options.extensions?.startInline) {
                let startIndex = Infinity;
                const tempSrc = src.slice(1);
                let tempStart;
                this.options.extensions.startInline.forEach((getStartIndex) => {
                    tempStart = getStartIndex.call({ lexer: this }, tempSrc);
                    if (typeof tempStart === 'number' && tempStart >= 0) {
                        startIndex = Math.min(startIndex, tempStart);
                    }
                });
                if (startIndex < Infinity && startIndex >= 0) {
                    cutSrc = src.substring(0, startIndex + 1);
                }
            }
            if (token = this.tokenizer.inlineText(cutSrc)) {
                src = src.substring(token.raw.length);
                if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
                    prevChar = token.raw.slice(-1);
                }
                keepPrevChar = true;
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'text') {
                    lastToken.raw += token.raw;
                    lastToken.text += token.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            if (src) {
                const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
                if (this.options.silent) {
                    console.error(errMsg);
                    break;
                }
                else {
                    throw new Error(errMsg);
                }
            }
        }
        return tokens;
    }
}

/**
 * Renderer
 */
class _Renderer {
    options;
    parser; // set by the parser
    constructor(options) {
        this.options = options || _defaults;
    }
    space(token) {
        return '';
    }
    code({ text, lang, escaped }) {
        const langString = (lang || '').match(other.notSpaceStart)?.[0];
        const code = text.replace(other.endingNewline, '') + '\n';
        if (!langString) {
            return '<pre><code>'
                + (escaped ? code : marked_esm_escape(code, true))
                + '</code></pre>\n';
        }
        return '<pre><code class="language-'
            + marked_esm_escape(langString)
            + '">'
            + (escaped ? code : marked_esm_escape(code, true))
            + '</code></pre>\n';
    }
    blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        return `<blockquote>\n${body}</blockquote>\n`;
    }
    html({ text }) {
        return text;
    }
    heading({ tokens, depth }) {
        return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
    }
    hr(token) {
        return '<hr>\n';
    }
    list(token) {
        const ordered = token.ordered;
        const start = token.start;
        let body = '';
        for (let j = 0; j < token.items.length; j++) {
            const item = token.items[j];
            body += this.listitem(item);
        }
        const type = ordered ? 'ol' : 'ul';
        const startAttr = (ordered && start !== 1) ? (' start="' + start + '"') : '';
        return '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
    }
    listitem(item) {
        let itemBody = '';
        if (item.task) {
            const checkbox = this.checkbox({ checked: !!item.checked });
            if (item.loose) {
                if (item.tokens[0]?.type === 'paragraph') {
                    item.tokens[0].text = checkbox + ' ' + item.tokens[0].text;
                    if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === 'text') {
                        item.tokens[0].tokens[0].text = checkbox + ' ' + marked_esm_escape(item.tokens[0].tokens[0].text);
                        item.tokens[0].tokens[0].escaped = true;
                    }
                }
                else {
                    item.tokens.unshift({
                        type: 'text',
                        raw: checkbox + ' ',
                        text: checkbox + ' ',
                        escaped: true,
                    });
                }
            }
            else {
                itemBody += checkbox + ' ';
            }
        }
        itemBody += this.parser.parse(item.tokens, !!item.loose);
        return `<li>${itemBody}</li>\n`;
    }
    checkbox({ checked }) {
        return '<input '
            + (checked ? 'checked="" ' : '')
            + 'disabled="" type="checkbox">';
    }
    paragraph({ tokens }) {
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
    }
    table(token) {
        let header = '';
        // header
        let cell = '';
        for (let j = 0; j < token.header.length; j++) {
            cell += this.tablecell(token.header[j]);
        }
        header += this.tablerow({ text: cell });
        let body = '';
        for (let j = 0; j < token.rows.length; j++) {
            const row = token.rows[j];
            cell = '';
            for (let k = 0; k < row.length; k++) {
                cell += this.tablecell(row[k]);
            }
            body += this.tablerow({ text: cell });
        }
        if (body)
            body = `<tbody>${body}</tbody>`;
        return '<table>\n'
            + '<thead>\n'
            + header
            + '</thead>\n'
            + body
            + '</table>\n';
    }
    tablerow({ text }) {
        return `<tr>\n${text}</tr>\n`;
    }
    tablecell(token) {
        const content = this.parser.parseInline(token.tokens);
        const type = token.header ? 'th' : 'td';
        const tag = token.align
            ? `<${type} align="${token.align}">`
            : `<${type}>`;
        return tag + content + `</${type}>\n`;
    }
    /**
     * span level renderer
     */
    strong({ tokens }) {
        return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    }
    em({ tokens }) {
        return `<em>${this.parser.parseInline(tokens)}</em>`;
    }
    codespan({ text }) {
        return `<code>${marked_esm_escape(text, true)}</code>`;
    }
    br(token) {
        return '<br>';
    }
    del({ tokens }) {
        return `<del>${this.parser.parseInline(tokens)}</del>`;
    }
    link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
            return text;
        }
        href = cleanHref;
        let out = '<a href="' + href + '"';
        if (title) {
            out += ' title="' + (marked_esm_escape(title)) + '"';
        }
        out += '>' + text + '</a>';
        return out;
    }
    image({ href, title, text }) {
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
            return marked_esm_escape(text);
        }
        href = cleanHref;
        let out = `<img src="${href}" alt="${text}"`;
        if (title) {
            out += ` title="${marked_esm_escape(title)}"`;
        }
        out += '>';
        return out;
    }
    text(token) {
        return 'tokens' in token && token.tokens
            ? this.parser.parseInline(token.tokens)
            : ('escaped' in token && token.escaped ? token.text : marked_esm_escape(token.text));
    }
}

/**
 * TextRenderer
 * returns only the textual part of the token
 */
class _TextRenderer {
    // no need for block level renderers
    strong({ text }) {
        return text;
    }
    em({ text }) {
        return text;
    }
    codespan({ text }) {
        return text;
    }
    del({ text }) {
        return text;
    }
    html({ text }) {
        return text;
    }
    text({ text }) {
        return text;
    }
    link({ text }) {
        return '' + text;
    }
    image({ text }) {
        return '' + text;
    }
    br() {
        return '';
    }
}

/**
 * Parsing & Compiling
 */
class _Parser {
    options;
    renderer;
    textRenderer;
    constructor(options) {
        this.options = options || _defaults;
        this.options.renderer = this.options.renderer || new _Renderer();
        this.renderer = this.options.renderer;
        this.renderer.options = this.options;
        this.renderer.parser = this;
        this.textRenderer = new _TextRenderer();
    }
    /**
     * Static Parse Method
     */
    static parse(tokens, options) {
        const parser = new _Parser(options);
        return parser.parse(tokens);
    }
    /**
     * Static Parse Inline Method
     */
    static parseInline(tokens, options) {
        const parser = new _Parser(options);
        return parser.parseInline(tokens);
    }
    /**
     * Parse Loop
     */
    parse(tokens, top = true) {
        let out = '';
        for (let i = 0; i < tokens.length; i++) {
            const anyToken = tokens[i];
            // Run any renderer extensions
            if (this.options.extensions?.renderers?.[anyToken.type]) {
                const genericToken = anyToken;
                const ret = this.options.extensions.renderers[genericToken.type].call({ parser: this }, genericToken);
                if (ret !== false || !['space', 'hr', 'heading', 'code', 'table', 'blockquote', 'list', 'html', 'paragraph', 'text'].includes(genericToken.type)) {
                    out += ret || '';
                    continue;
                }
            }
            const token = anyToken;
            switch (token.type) {
                case 'space': {
                    out += this.renderer.space(token);
                    continue;
                }
                case 'hr': {
                    out += this.renderer.hr(token);
                    continue;
                }
                case 'heading': {
                    out += this.renderer.heading(token);
                    continue;
                }
                case 'code': {
                    out += this.renderer.code(token);
                    continue;
                }
                case 'table': {
                    out += this.renderer.table(token);
                    continue;
                }
                case 'blockquote': {
                    out += this.renderer.blockquote(token);
                    continue;
                }
                case 'list': {
                    out += this.renderer.list(token);
                    continue;
                }
                case 'html': {
                    out += this.renderer.html(token);
                    continue;
                }
                case 'paragraph': {
                    out += this.renderer.paragraph(token);
                    continue;
                }
                case 'text': {
                    let textToken = token;
                    let body = this.renderer.text(textToken);
                    while (i + 1 < tokens.length && tokens[i + 1].type === 'text') {
                        textToken = tokens[++i];
                        body += '\n' + this.renderer.text(textToken);
                    }
                    if (top) {
                        out += this.renderer.paragraph({
                            type: 'paragraph',
                            raw: body,
                            text: body,
                            tokens: [{ type: 'text', raw: body, text: body, escaped: true }],
                        });
                    }
                    else {
                        out += body;
                    }
                    continue;
                }
                default: {
                    const errMsg = 'Token with "' + token.type + '" type was not found.';
                    if (this.options.silent) {
                        console.error(errMsg);
                        return '';
                    }
                    else {
                        throw new Error(errMsg);
                    }
                }
            }
        }
        return out;
    }
    /**
     * Parse Inline Tokens
     */
    parseInline(tokens, renderer = this.renderer) {
        let out = '';
        for (let i = 0; i < tokens.length; i++) {
            const anyToken = tokens[i];
            // Run any renderer extensions
            if (this.options.extensions?.renderers?.[anyToken.type]) {
                const ret = this.options.extensions.renderers[anyToken.type].call({ parser: this }, anyToken);
                if (ret !== false || !['escape', 'html', 'link', 'image', 'strong', 'em', 'codespan', 'br', 'del', 'text'].includes(anyToken.type)) {
                    out += ret || '';
                    continue;
                }
            }
            const token = anyToken;
            switch (token.type) {
                case 'escape': {
                    out += renderer.text(token);
                    break;
                }
                case 'html': {
                    out += renderer.html(token);
                    break;
                }
                case 'link': {
                    out += renderer.link(token);
                    break;
                }
                case 'image': {
                    out += renderer.image(token);
                    break;
                }
                case 'strong': {
                    out += renderer.strong(token);
                    break;
                }
                case 'em': {
                    out += renderer.em(token);
                    break;
                }
                case 'codespan': {
                    out += renderer.codespan(token);
                    break;
                }
                case 'br': {
                    out += renderer.br(token);
                    break;
                }
                case 'del': {
                    out += renderer.del(token);
                    break;
                }
                case 'text': {
                    out += renderer.text(token);
                    break;
                }
                default: {
                    const errMsg = 'Token with "' + token.type + '" type was not found.';
                    if (this.options.silent) {
                        console.error(errMsg);
                        return '';
                    }
                    else {
                        throw new Error(errMsg);
                    }
                }
            }
        }
        return out;
    }
}

class _Hooks {
    options;
    block;
    constructor(options) {
        this.options = options || _defaults;
    }
    static passThroughHooks = new Set([
        'preprocess',
        'postprocess',
        'processAllTokens',
    ]);
    /**
     * Process markdown before marked
     */
    preprocess(markdown) {
        return markdown;
    }
    /**
     * Process HTML after marked is finished
     */
    postprocess(html) {
        return html;
    }
    /**
     * Process all tokens before walk tokens
     */
    processAllTokens(tokens) {
        return tokens;
    }
    /**
     * Provide function to tokenize markdown
     */
    provideLexer() {
        return this.block ? _Lexer.lex : _Lexer.lexInline;
    }
    /**
     * Provide function to parse tokens
     */
    provideParser() {
        return this.block ? _Parser.parse : _Parser.parseInline;
    }
}

class Marked {
    defaults = _getDefaults();
    options = this.setOptions;
    parse = this.parseMarkdown(true);
    parseInline = this.parseMarkdown(false);
    Parser = _Parser;
    Renderer = _Renderer;
    TextRenderer = _TextRenderer;
    Lexer = _Lexer;
    Tokenizer = _Tokenizer;
    Hooks = _Hooks;
    constructor(...args) {
        this.use(...args);
    }
    /**
     * Run callback for every token
     */
    walkTokens(tokens, callback) {
        let values = [];
        for (const token of tokens) {
            values = values.concat(callback.call(this, token));
            switch (token.type) {
                case 'table': {
                    const tableToken = token;
                    for (const cell of tableToken.header) {
                        values = values.concat(this.walkTokens(cell.tokens, callback));
                    }
                    for (const row of tableToken.rows) {
                        for (const cell of row) {
                            values = values.concat(this.walkTokens(cell.tokens, callback));
                        }
                    }
                    break;
                }
                case 'list': {
                    const listToken = token;
                    values = values.concat(this.walkTokens(listToken.items, callback));
                    break;
                }
                default: {
                    const genericToken = token;
                    if (this.defaults.extensions?.childTokens?.[genericToken.type]) {
                        this.defaults.extensions.childTokens[genericToken.type].forEach((childTokens) => {
                            const tokens = genericToken[childTokens].flat(Infinity);
                            values = values.concat(this.walkTokens(tokens, callback));
                        });
                    }
                    else if (genericToken.tokens) {
                        values = values.concat(this.walkTokens(genericToken.tokens, callback));
                    }
                }
            }
        }
        return values;
    }
    use(...args) {
        const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };
        args.forEach((pack) => {
            // copy options to new object
            const opts = { ...pack };
            // set async to true if it was set to true before
            opts.async = this.defaults.async || opts.async || false;
            // ==-- Parse "addon" extensions --== //
            if (pack.extensions) {
                pack.extensions.forEach((ext) => {
                    if (!ext.name) {
                        throw new Error('extension name required');
                    }
                    if ('renderer' in ext) { // Renderer extensions
                        const prevRenderer = extensions.renderers[ext.name];
                        if (prevRenderer) {
                            // Replace extension with func to run new extension but fall back if false
                            extensions.renderers[ext.name] = function (...args) {
                                let ret = ext.renderer.apply(this, args);
                                if (ret === false) {
                                    ret = prevRenderer.apply(this, args);
                                }
                                return ret;
                            };
                        }
                        else {
                            extensions.renderers[ext.name] = ext.renderer;
                        }
                    }
                    if ('tokenizer' in ext) { // Tokenizer Extensions
                        if (!ext.level || (ext.level !== 'block' && ext.level !== 'inline')) {
                            throw new Error("extension level must be 'block' or 'inline'");
                        }
                        const extLevel = extensions[ext.level];
                        if (extLevel) {
                            extLevel.unshift(ext.tokenizer);
                        }
                        else {
                            extensions[ext.level] = [ext.tokenizer];
                        }
                        if (ext.start) { // Function to check for start of token
                            if (ext.level === 'block') {
                                if (extensions.startBlock) {
                                    extensions.startBlock.push(ext.start);
                                }
                                else {
                                    extensions.startBlock = [ext.start];
                                }
                            }
                            else if (ext.level === 'inline') {
                                if (extensions.startInline) {
                                    extensions.startInline.push(ext.start);
                                }
                                else {
                                    extensions.startInline = [ext.start];
                                }
                            }
                        }
                    }
                    if ('childTokens' in ext && ext.childTokens) { // Child tokens to be visited by walkTokens
                        extensions.childTokens[ext.name] = ext.childTokens;
                    }
                });
                opts.extensions = extensions;
            }
            // ==-- Parse "overwrite" extensions --== //
            if (pack.renderer) {
                const renderer = this.defaults.renderer || new _Renderer(this.defaults);
                for (const prop in pack.renderer) {
                    if (!(prop in renderer)) {
                        throw new Error(`renderer '${prop}' does not exist`);
                    }
                    if (['options', 'parser'].includes(prop)) {
                        // ignore options property
                        continue;
                    }
                    const rendererProp = prop;
                    const rendererFunc = pack.renderer[rendererProp];
                    const prevRenderer = renderer[rendererProp];
                    // Replace renderer with func to run extension, but fall back if false
                    renderer[rendererProp] = (...args) => {
                        let ret = rendererFunc.apply(renderer, args);
                        if (ret === false) {
                            ret = prevRenderer.apply(renderer, args);
                        }
                        return ret || '';
                    };
                }
                opts.renderer = renderer;
            }
            if (pack.tokenizer) {
                const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
                for (const prop in pack.tokenizer) {
                    if (!(prop in tokenizer)) {
                        throw new Error(`tokenizer '${prop}' does not exist`);
                    }
                    if (['options', 'rules', 'lexer'].includes(prop)) {
                        // ignore options, rules, and lexer properties
                        continue;
                    }
                    const tokenizerProp = prop;
                    const tokenizerFunc = pack.tokenizer[tokenizerProp];
                    const prevTokenizer = tokenizer[tokenizerProp];
                    // Replace tokenizer with func to run extension, but fall back if false
                    // @ts-expect-error cannot type tokenizer function dynamically
                    tokenizer[tokenizerProp] = (...args) => {
                        let ret = tokenizerFunc.apply(tokenizer, args);
                        if (ret === false) {
                            ret = prevTokenizer.apply(tokenizer, args);
                        }
                        return ret;
                    };
                }
                opts.tokenizer = tokenizer;
            }
            // ==-- Parse Hooks extensions --== //
            if (pack.hooks) {
                const hooks = this.defaults.hooks || new _Hooks();
                for (const prop in pack.hooks) {
                    if (!(prop in hooks)) {
                        throw new Error(`hook '${prop}' does not exist`);
                    }
                    if (['options', 'block'].includes(prop)) {
                        // ignore options and block properties
                        continue;
                    }
                    const hooksProp = prop;
                    const hooksFunc = pack.hooks[hooksProp];
                    const prevHook = hooks[hooksProp];
                    if (_Hooks.passThroughHooks.has(prop)) {
                        // @ts-expect-error cannot type hook function dynamically
                        hooks[hooksProp] = (arg) => {
                            if (this.defaults.async) {
                                return Promise.resolve(hooksFunc.call(hooks, arg)).then(ret => {
                                    return prevHook.call(hooks, ret);
                                });
                            }
                            const ret = hooksFunc.call(hooks, arg);
                            return prevHook.call(hooks, ret);
                        };
                    }
                    else {
                        // @ts-expect-error cannot type hook function dynamically
                        hooks[hooksProp] = (...args) => {
                            let ret = hooksFunc.apply(hooks, args);
                            if (ret === false) {
                                ret = prevHook.apply(hooks, args);
                            }
                            return ret;
                        };
                    }
                }
                opts.hooks = hooks;
            }
            // ==-- Parse WalkTokens extensions --== //
            if (pack.walkTokens) {
                const walkTokens = this.defaults.walkTokens;
                const packWalktokens = pack.walkTokens;
                opts.walkTokens = function (token) {
                    let values = [];
                    values.push(packWalktokens.call(this, token));
                    if (walkTokens) {
                        values = values.concat(walkTokens.call(this, token));
                    }
                    return values;
                };
            }
            this.defaults = { ...this.defaults, ...opts };
        });
        return this;
    }
    setOptions(opt) {
        this.defaults = { ...this.defaults, ...opt };
        return this;
    }
    lexer(src, options) {
        return _Lexer.lex(src, options ?? this.defaults);
    }
    parser(tokens, options) {
        return _Parser.parse(tokens, options ?? this.defaults);
    }
    parseMarkdown(blockType) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parse = (src, options) => {
            const origOpt = { ...options };
            const opt = { ...this.defaults, ...origOpt };
            const throwError = this.onError(!!opt.silent, !!opt.async);
            // throw error if an extension set async to true but parse was called with async: false
            if (this.defaults.async === true && origOpt.async === false) {
                return throwError(new Error('marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise.'));
            }
            // throw error in case of non string input
            if (typeof src === 'undefined' || src === null) {
                return throwError(new Error('marked(): input parameter is undefined or null'));
            }
            if (typeof src !== 'string') {
                return throwError(new Error('marked(): input parameter is of type '
                    + Object.prototype.toString.call(src) + ', string expected'));
            }
            if (opt.hooks) {
                opt.hooks.options = opt;
                opt.hooks.block = blockType;
            }
            const lexer = opt.hooks ? opt.hooks.provideLexer() : (blockType ? _Lexer.lex : _Lexer.lexInline);
            const parser = opt.hooks ? opt.hooks.provideParser() : (blockType ? _Parser.parse : _Parser.parseInline);
            if (opt.async) {
                return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src)
                    .then(src => lexer(src, opt))
                    .then(tokens => opt.hooks ? opt.hooks.processAllTokens(tokens) : tokens)
                    .then(tokens => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens)
                    .then(tokens => parser(tokens, opt))
                    .then(html => opt.hooks ? opt.hooks.postprocess(html) : html)
                    .catch(throwError);
            }
            try {
                if (opt.hooks) {
                    src = opt.hooks.preprocess(src);
                }
                let tokens = lexer(src, opt);
                if (opt.hooks) {
                    tokens = opt.hooks.processAllTokens(tokens);
                }
                if (opt.walkTokens) {
                    this.walkTokens(tokens, opt.walkTokens);
                }
                let html = parser(tokens, opt);
                if (opt.hooks) {
                    html = opt.hooks.postprocess(html);
                }
                return html;
            }
            catch (e) {
                return throwError(e);
            }
        };
        return parse;
    }
    onError(silent, async) {
        return (e) => {
            e.message += '\nPlease report this to https://github.com/markedjs/marked.';
            if (silent) {
                const msg = '<p>An error occurred:</p><pre>'
                    + marked_esm_escape(e.message + '', true)
                    + '</pre>';
                if (async) {
                    return Promise.resolve(msg);
                }
                return msg;
            }
            if (async) {
                return Promise.reject(e);
            }
            throw e;
        };
    }
}

const markedInstance = new Marked();
function marked(src, opt) {
    return markedInstance.parse(src, opt);
}
/**
 * Sets the default options.
 *
 * @param options Hash of options
 */
marked.options =
    marked.setOptions = function (options) {
        markedInstance.setOptions(options);
        marked.defaults = markedInstance.defaults;
        changeDefaults(marked.defaults);
        return marked;
    };
/**
 * Gets the original marked default options.
 */
marked.getDefaults = _getDefaults;
marked.defaults = _defaults;
/**
 * Use Extension
 */
marked.use = function (...args) {
    markedInstance.use(...args);
    marked.defaults = markedInstance.defaults;
    changeDefaults(marked.defaults);
    return marked;
};
/**
 * Run callback for every token
 */
marked.walkTokens = function (tokens, callback) {
    return markedInstance.walkTokens(tokens, callback);
};
/**
 * Compiles markdown to HTML without enclosing `p` tag.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options
 * @return String of compiled HTML
 */
marked.parseInline = markedInstance.parseInline;
/**
 * Expose
 */
marked.Parser = _Parser;
marked.parser = _Parser.parse;
marked.Renderer = _Renderer;
marked.TextRenderer = _TextRenderer;
marked.Lexer = _Lexer;
marked.lexer = _Lexer.lex;
marked.Tokenizer = _Tokenizer;
marked.Hooks = _Hooks;
marked.parse = marked;
const options = marked.options;
const setOptions = marked.setOptions;
const use = marked.use;
const walkTokens = marked.walkTokens;
const parseInline = marked.parseInline;
const parse = (/* unused pure expression or super */ null && (marked));
const parser = _Parser.parse;
const lexer = _Lexer.lex;


//# sourceMappingURL=marked.esm.js.map

;// ./src/global.js
/**
 * Global logger implementation for Carbon Commander
 */
const ccLogger = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    group: console.group.bind(console),
    groupEnd: console.groupEnd.bind(console),
    time: console.time.bind(console),
    timeEnd: console.timeEnd.bind(console)
};
;// ./src/tool-caller.js


class ToolCaller {

    //TODO: [MAJOR] add MCP support for calling as a client.
    //TODO: [MAJOR] Convert tools (or create a wrapper) to MCP.


    currentPageTools = null;

    reset() {
        ccLogger.debug('Resetting tool caller state');
        this.currentPageTools = null;
    }

    getToolSets() {
        return this.getAllToolsets();
    }

    getTools(onlyFunctionInfo = false) {        
        ccLogger.group('Getting Tools');
        let allTools = [];
        let pageTools = this.getAllToolSetsForPage();
        pageTools.forEach(toolSet => {
            toolSet.tools.forEach(prop => {
                allTools.push(onlyFunctionInfo ? prop.function : prop);
            });
        });
        ccLogger.debug(`Found ${allTools.length} tools`);
        ccLogger.groupEnd();
        return allTools;
    }

    getTool(toolName, onlyFunctionInfo = false) {
        ccLogger.debug('Getting tool:', toolName);
        const allTools = this.getTools(onlyFunctionInfo);
        const tool = allTools.find(tool => onlyFunctionInfo ? tool.name == toolName : tool.function.name == toolName);
        if (!tool) {
            ccLogger.warn(`Tool not found: ${toolName}`);
        }
        return tool;
    }

    async getToolScope(bar) {
        ccLogger.group('Building Tool Scope');
        var scope = {
            bar: bar,
            logMessage: (message, important = false) => {
                if(important) {
                    ccLogger.info('[ToolScope] ' + message);
                } else {
                    ccLogger.debug('[ToolScope] ' + message);
                }
            },
            logError: (message) => {
                ccLogger.error('[ToolScope] ' + message);
            }
        }
        //Apply the current toolsets scope functions
        for(let toolSet of this.getAllToolSetsForPage()) {
            try {
                if(toolSet.toolSet._CarbonBarBuildScope) {
                    ccLogger.debug(`Building scope for toolset: ${toolSet.name}`);
                    scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                    ccLogger.debug('App name after scope build:', scope.appName);
                }
            } catch (e) {
                ccLogger.error('Error building scope:', e);
            }
        }

        if(!scope.appName) {
            ccLogger.warn('No app name found in scope, using default');
            scope.appName = 'CarbonCommander [Unknown App (2)]';
        }
        ccLogger.debug('Final app name:', scope.appName);
        ccLogger.groupEnd();
        return scope;
    }

    getAllToolSetsForPage() {
        if(this.currentPageTools) {
            return this.currentPageTools;
        }
        
        ccLogger.group('Getting Tool Sets for Page');
        this.currentPageTools = this.getAllToolsets().filter(toolSet => 
            (toolSet.tools && toolSet.tools.length > 0) &&
            (toolSet.toolSet._CarbonBarPageLoadFilter && toolSet.toolSet._CarbonBarPageLoadFilter(window))
        );
        
        ccLogger.debug(`Found ${this.currentPageTools.length} tool sets for current page`);
        ccLogger.groupEnd();
        return this.currentPageTools;
    }

    getAllToolsets() {
        ccLogger.group('Getting All Tool Sets');
        const allTools = [];
        if (window.sbaiTools) {
            Object.entries(window.sbaiTools).forEach(([_, toolSet]) => {
                try {
                    let toolset = {
                        name: toolSet.name,
                        toolSet: toolSet,
                        tools: Object.getOwnPropertyNames(toolSet)
                            .filter(prop => typeof toolSet[prop] === 'object' && toolSet[prop]?.function)
                            .map(prop => toolSet[prop])
                    };

                    ccLogger.debug('Processing toolset:', { 
                        name: toolset.name, 
                        toolCount: toolset.tools.length 
                    });

                    if(toolset.tools && toolset.tools.length > 0) {
                        allTools.push(toolset);
                    }
                } catch (e) {
                    ccLogger.error(`Error getting tools from ${toolSet.name}:`, e);
                }
            });
        }
        ccLogger.debug(`Total tool sets found: ${allTools.length}`);
        ccLogger.groupEnd();
        return allTools;
    }


    async buildSystemPrompt(basePrompt, scope) {
        ccLogger.group('Building System Prompt');
        let toolSets = this.getAllToolSetsForPage();
        if(toolSets.length > 0) {
            for(let toolSet of toolSets) { 
                if(toolSet.toolSet._CarbonBarSystemPrompt) {
                    ccLogger.debug(`Adding system prompt from toolSet: ${toolSet.name || 'unnamed'}`);
                    if(toolSet.toolSet._CarbonBarBuildScope) {
                        scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                    }
                    basePrompt = await toolSet.toolSet._CarbonBarSystemPrompt(basePrompt, scope);
                }
            }
        }
        ccLogger.groupEnd();
        return basePrompt;
    }

    getToolHtml(chunk) {
        ccLogger.group('Generating Tool HTML');
        const toolName = chunk.name;
        const toolArgs = chunk.arguments;
        let toolResult = chunk.result;
        const toolCallIndex = chunk.index;
        const toolCallStarted = chunk.callStarted;
        const toolCallFinished = chunk.callFinished;
        const tool = this.getTool(toolName, true);

        ccLogger.debug('Tool chunk info:', {
            name: toolName,
            hasArgs: !!toolArgs,
            started: toolCallStarted,
            finished: toolCallFinished
        });

        try {
            if(toolResult && typeof toolResult === 'string') {
                toolResult = JSON.parse(toolResult);
                if(toolResult.startsWith('ERROR: ')) {
                    toolResult = JSON.parse(toolResult.substring(7));
                }
            }
        } catch(e) {
            
        }

        ccLogger.debug('Tool result status:', {
            hasResult: !!toolResult,
            hasError: !!toolResult?.error
        });

        let status = 'pending';
        let statusText = 'Preparing...';
        
        if (toolCallStarted && !toolCallFinished) {
            status = 'running';
            statusText = 'Running';
        } else if (toolCallFinished) {
            status = toolResult?.error ? 'error' : 'completed';
            statusText = toolResult?.error ? 'Error' : 'Completed';
        }

        // Generate parameters documentation HTML
        let parametersHtml = '';
        if (tool.parameters?.properties) {
            parametersHtml = `
                <div class="tool-parameters">
                    <h4>Parameters:</h4>
                    <table class="tool-params-table">
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Required</th>
                            <th>Description</th>
                        </tr>
                        ${Object.entries(tool.parameters.properties).map(([name, param]) => `
                            <tr>
                                <td>${name}</td>
                                <td>${param.type}</td>
                                <td>${tool.parameters.required?.includes(name) ? '✓' : ''}</td>
                                <td>${param.description || ''}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            `;
        }

        ccLogger.debug('parametersHtmlTest', toolResult?.result ? toolResult.result : 'No result');

        // Generate advanced view HTML
        const advancedHtml = `
            <div class="tool-advanced-container">
                <button class="tool-view-toggle">Show Simple</button>
                <div class="tool-header">
                    <span class="tool-name">${toolName}</span>
                    <span class="tool-status ${status}">${statusText}</span>
                </div>
                ${tool.description ? `<div class="tool-description">${tool.description}</div>` : ''}
                ${parametersHtml}
                ${toolArgs ? `
                    <div class="tool-arguments-section">
                        <h4>Current Call Arguments:</h4>
                        <div class="tool-arguments">${ (toolArgs instanceof Object) ? JSON.stringify(toolArgs) : toolArgs}</div>
                    </div>
                ` : ''}
                ${toolResult?.error ? `<div class="cc-error">${toolResult.error}</div>` : ''}
                ${toolResult ? `
                    <div class="tool-result-section">
                        <h4>Result:</h4>
                        <div class="tool-result-content">${ (toolResult instanceof Object) ? JSON.stringify(toolResult) : toolResult}</div>
                    </div>
                ` : ''}
            </div>
        `;

        // Generate simple view HTML
        const simpleHtml = `
            <div class="tool-simple-container ${status}">
                <div class="tool-simple-content">
                    <div class="tool-simple-icon ${status}">🔧</div>
                    <div class="tool-simple-info">
                        <div class="tool-simple-name">${toolName}</div>
                        ${toolResult?.error ? 
                            `<div class="cc-error">${toolResult.error}</div>` :
                            toolResult ? 
                                `<div class="tool-simple-progress">
                                    <div class="progress-bar" style="width: 100%"></div>
                                </div>` :
                                `<div class="tool-simple-progress">
                                    <div class="progress-bar" style="width: ${toolCallFinished ? '100%' : toolCallStarted ? '50%' : '20%'}"></div>
                                </div>`
                        }
                    </div>
                </div>
            </div>
        `;

        ccLogger.debug('Generated HTML with status:', status);
        ccLogger.groupEnd();
        return { simpleHtml, advancedHtml };
    }

    static getService(serviceName) {
        ccLogger.debug('Getting service:', serviceName);
        return angular.element(document).injector().get(serviceName);
    }
}
const toolCaller = new ToolCaller();
/* harmony default export */ const tool_caller = (toolCaller);
;// ./src/mcp-tool-caller.js


class MCPToolCaller {
    constructor() {
        this.currentPageTools = null;
        this.mcpClients = new Map(); // Map of MCP client connections
        this.mcpConfig = new Map(); // Map of MCP service configurations
        this.mcpToolsets = new Map(); // Map of MCP-provided toolsets
    }

    // MCP-specific methods
    async configureMCPService(serviceConfig) {
        const { serviceId, endpoint, apiKey, options = {} } = serviceConfig;
        
        ccLogger.debug(`Configuring MCP service: ${serviceId}`);
        
        try {
            this.mcpConfig.set(serviceId, {
                endpoint,
                apiKey,
                options,
                status: 'configured',
                toolsets: [] // Will store toolsets provided by this service
            });
            
            // Initialize client connection if autoConnect is true
            if (options.autoConnect) {
                await this.connectMCPService(serviceId);
            }
            
            return true;
        } catch (error) {
            ccLogger.error(`Error configuring MCP service ${serviceId}:`, error);
            return false;
        }
    }

    async connectMCPService(serviceId) {
        ccLogger.debug(`Connecting to MCP service: ${serviceId}`);
        
        const config = this.mcpConfig.get(serviceId);
        if (!config) {
            throw new Error(`MCP service ${serviceId} not configured`);
        }

        try {
            // Initialize MCP client connection with enhanced capabilities
            const client = {
                serviceId,
                endpoint: config.endpoint,
                connected: true,
                // Enhanced client methods
                callFunction: async (functionName, args) => {
                    return await this.mcpCallFunction(serviceId, functionName, args);
                },
                discoverTools: async () => {
                    return await this.discoverMCPTools(serviceId);
                },
                getSystemPrompt: async (basePrompt, scope) => {
                    return await this.getMCPSystemPrompt(serviceId, basePrompt, scope);
                }
            };

            this.mcpClients.set(serviceId, client);
            config.status = 'connected';

            // Discover available tools after connection
            await this.discoverMCPTools(serviceId);
            
            return true;
        } catch (error) {
            ccLogger.error(`Error connecting to MCP service ${serviceId}:`, error);
            config.status = 'error';
            config.lastError = error.message;
            return false;
        }
    }

    async discoverMCPTools(serviceId) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            throw new Error(`MCP client ${serviceId} not connected`);
        }

        try {
            // Call the MCP service's tool discovery endpoint
            const response = await fetch(`${client.endpoint}/discover-tools`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`Tool discovery failed: ${response.statusText}`);
            }

            const toolsets = await response.json();
            
            // Process and store discovered toolsets
            toolsets.forEach(toolset => {
                // Add MCP-specific wrapper around toolset
                const wrappedToolset = this.wrapMCPToolset(serviceId, toolset);
                this.mcpToolsets.set(`${serviceId}:${toolset.name}`, wrappedToolset);
            });

            return toolsets;
        } catch (error) {
            ccLogger.error(`Error discovering tools for ${serviceId}:`, error);
            throw error;
        }
    }

    wrapMCPToolset(serviceId, toolset) {
        // Create a wrapper that maintains compatibility with local toolsets
        return {
            name: `${serviceId}:${toolset.name}`,
            toolSet: {
                ...toolset,
                _CarbonBarPageLoadFilter: toolset.pageLoadFilter || (() => true),
                _CarbonBarBuildScope: async (scope) => {
                    // Call MCP service for scope building if supported
                    try {
                        const client = this.mcpClients.get(serviceId);
                        const response = await fetch(`${client.endpoint}/build-scope`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                            },
                            body: JSON.stringify({ scope })
                        });
                        
                        if (response.ok) {
                            const customScope = await response.json();
                            return { ...scope, ...customScope };
                        }
                    } catch (error) {
                        ccLogger.error(`Error building MCP scope for ${serviceId}:`, error);
                    }
                    return scope;
                },
                _CarbonBarSystemPrompt: async (basePrompt, scope) => {
                    // Call MCP service for system prompt customization if supported
                    try {
                        const client = this.mcpClients.get(serviceId);
                        const response = await fetch(`${client.endpoint}/system-prompt`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                            },
                            body: JSON.stringify({ basePrompt, scope })
                        });
                        
                        if (response.ok) {
                            const { customPrompt } = await response.json();
                            return customPrompt || basePrompt;
                        }
                    } catch (error) {
                        ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
                    }
                    return basePrompt;
                }
            },
            tools: toolset.tools.map(tool => ({
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                },
                execute: async (scope, args) => {
                    return await this.mcpCallFunction(serviceId, tool.name, args);
                }
            }))
        };
    }

    async disconnectMCPService(serviceId) {
        ccLogger.debug(`Disconnecting from MCP service: ${serviceId}`);
        
        const client = this.mcpClients.get(serviceId);
        if (client) {
            try {
                // Remove all toolsets from this service
                for (const [toolsetId, toolset] of this.mcpToolsets.entries()) {
                    if (toolsetId.startsWith(`${serviceId}:`)) {
                        this.mcpToolsets.delete(toolsetId);
                    }
                }

                // Cleanup client connection
                this.mcpClients.delete(serviceId);
                const config = this.mcpConfig.get(serviceId);
                if (config) {
                    config.status = 'disconnected';
                }
                return true;
            } catch (error) {
                ccLogger.error(`Error disconnecting from MCP service ${serviceId}:`, error);
                return false;
            }
        }
        return false;
    }

    async mcpCallFunction(serviceId, functionName, args) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            throw new Error(`MCP client ${serviceId} not connected`);
        }

        try {
            const response = await fetch(`${client.endpoint}/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                },
                body: JSON.stringify({
                    function: functionName,
                    arguments: args
                })
            });

            if (!response.ok) {
                throw new Error(`MCP call failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            ccLogger.error(`Error calling MCP function ${functionName}:`, error);
            throw error;
        }
    }

    // Tool management methods with MCP support
    reset() {
        ccLogger.debug('Resetting MCP tool caller state');
        this.currentPageTools = null;
        // Don't reset MCP configurations/connections unless explicitly requested
    }

    getToolSets() {
        return [...this.getAllToolsets(), ...Array.from(this.mcpToolsets.values())];
    }

    getTools(onlyFunctionInfo = false) {        
        ccLogger.group('Getting Tools');
        let allTools = [];
        
        // Get local tools
        let pageTools = this.getAllToolSetsForPage();
        pageTools.forEach(toolSet => {
            toolSet.tools.forEach(prop => {
                allTools.push(onlyFunctionInfo ? prop.function : prop);
            });
        });
        
        // Add MCP tools
        this.mcpToolsets.forEach(toolset => {
            if (toolset.toolSet._CarbonBarPageLoadFilter(window)) {
                toolset.tools.forEach(tool => {
                    allTools.push(onlyFunctionInfo ? tool.function : tool);
                });
            }
        });
        
        ccLogger.debug(`Found ${allTools.length} tools (including MCP tools)`);
        ccLogger.groupEnd();
        return allTools;
    }

    getTool(toolName, onlyFunctionInfo = false) {
        ccLogger.debug('Getting tool:', toolName);
        const allTools = this.getTools(onlyFunctionInfo);
        const tool = allTools.find(tool => onlyFunctionInfo ? tool.name == toolName : tool.function.name == toolName);
        if (!tool) {
            ccLogger.warn(`Tool not found: ${toolName}`);
        }
        return tool;
    }

    async getToolScope(bar) {
        ccLogger.group('Building Tool Scope');
        var scope = {
            bar: bar,
            logMessage: (message, important = false) => {
                if(important) {
                    ccLogger.info('[ToolScope] ' + message);
                } else {
                    ccLogger.debug('[ToolScope] ' + message);
                }
            },
            logError: (message) => {
                ccLogger.error('[ToolScope] ' + message);
            }
        }

        // Add MCP-specific scope items
        scope.mcpServices = Array.from(this.mcpConfig.entries()).map(([id, config]) => ({
            id,
            status: config.status,
            endpoint: config.endpoint
        }));

        // Apply local toolsets scope functions
        for(let toolSet of this.getAllToolSetsForPage()) {
            try {
                if(toolSet.toolSet._CarbonBarBuildScope) {
                    ccLogger.debug(`Building scope for toolset: ${toolSet.name}`);
                    scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                }
            } catch (e) {
                ccLogger.error('Error building scope:', e);
            }
        }

        // Apply MCP toolsets scope functions
        for(let [_, toolset] of this.mcpToolsets) {
            try {
                if(toolset.toolSet._CarbonBarPageLoadFilter(window) && toolset.toolSet._CarbonBarBuildScope) {
                    ccLogger.debug(`Building scope for MCP toolset: ${toolset.name}`);
                    scope = await toolset.toolSet._CarbonBarBuildScope(scope);
                }
            } catch (e) {
                ccLogger.error('Error building MCP scope:', e);
            }
        }

        if(!scope.appName) {
            ccLogger.warn('No app name found in scope, using default');
            scope.appName = 'CarbonCommander [MCP Mode]';
        }
        
        ccLogger.groupEnd();
        return scope;
    }

    getAllToolSetsForPage() {
        if(this.currentPageTools) {
            return this.currentPageTools;
        }
        
        ccLogger.group('Getting Tool Sets for Page');
        this.currentPageTools = this.getAllToolsets().filter(toolSet => 
            (toolSet.tools && toolSet.tools.length > 0) &&
            (toolSet.toolSet._CarbonBarPageLoadFilter && toolSet.toolSet._CarbonBarPageLoadFilter(window))
        );
        
        ccLogger.debug(`Found ${this.currentPageTools.length} tool sets for current page`);
        ccLogger.groupEnd();
        return this.currentPageTools;
    }

    getAllToolsets() {
        ccLogger.group('Getting All Tool Sets');
        const allTools = [];
        if (window.sbaiTools) {
            Object.entries(window.sbaiTools).forEach(([_, toolSet]) => {
                try {
                    let toolset = {
                        name: toolSet.name,
                        toolSet: toolSet,
                        tools: Object.getOwnPropertyNames(toolSet)
                            .filter(prop => typeof toolSet[prop] === 'object' && toolSet[prop]?.function)
                            .map(prop => toolSet[prop])
                    };

                    ccLogger.debug('Processing toolset:', { 
                        name: toolset.name, 
                        toolCount: toolset.tools.length 
                    });

                    if(toolset.tools && toolset.tools.length > 0) {
                        allTools.push(toolset);
                    }
                } catch (e) {
                    ccLogger.error(`Error getting tools from ${toolSet.name}:`, e);
                }
            });
        }
        ccLogger.debug(`Total tool sets found: ${allTools.length}`);
        ccLogger.groupEnd();
        return allTools;
    }

    // MCP Service management methods
    getMCPServices() {
        return Array.from(this.mcpConfig.entries()).map(([id, config]) => ({
            id,
            status: config.status,
            endpoint: config.endpoint,
            connected: this.mcpClients.has(id),
            toolsets: Array.from(this.mcpToolsets.values())
                .filter(ts => ts.name.startsWith(`${id}:`))
                .map(ts => ts.name.substring(id.length + 1))
        }));
    }

    getMCPServiceStatus(serviceId) {
        const config = this.mcpConfig.get(serviceId);
        return config ? {
            status: config.status,
            connected: this.mcpClients.has(serviceId),
            lastError: config.lastError,
            toolsets: Array.from(this.mcpToolsets.values())
                .filter(ts => ts.name.startsWith(`${serviceId}:`))
                .map(ts => ts.name.substring(serviceId.length + 1))
        } : null;
    }

    async refreshMCPConnections() {
        ccLogger.debug('Refreshing all MCP connections');
        const results = [];
        for (const [serviceId, config] of this.mcpConfig.entries()) {
            if (config.status === 'connected' || config.options.autoReconnect) {
                results.push({
                    serviceId,
                    success: await this.connectMCPService(serviceId)
                });
            }
        }
        return results;
    }
}

const mcpToolCaller = new MCPToolCaller();
/* harmony default export */ const mcp_tool_caller = (mcpToolCaller); 
;// ./src/external-services/ollama.js


class OllamaClient {
    static FAST_MODEL = "mistral-small";
    static REASON_MODEL = "deepseek-r1:70b";
    static VISION_MODEL = "llama3.2-vision";


    //TODO: Create a downloader function for models with progress.
    //TODO: Integrate this with the app especially the new user flow.
    
    constructor() {
        this.defaultModel = OllamaClient.FAST_MODEL;
        this.callIndex = -1;
        this.available = null;
        //this.apiKey = null;


        // For testing purposes, we can override the availability check.
        // Ollama wont show for 20 seconds after starting up.
        //this.availableOverrideActive = true;
        //var _this = this;
        //setTimeout(() => {
        //    _this.availableOverrideActive = false;
        //}, 20000);
    }

    async isAvailable() {
        if(this.availableOverrideActive)
            return false;

        if(this.available != null)
            return this.available;

        ccLogger.debug('Checking Ollama availability');
        try {
            const response = await fetch(`http://${this.hostEndpoint}/api/version`);
            this.available = response.ok;
            ccLogger.info(`Ollama availability check: ${this.available ? 'Available' : 'Not available'}`);
            
            // If Ollama just became available, initialize required models
            if (this.available) {
                try {
                    await this.initializeRequiredModels((progress) => {
                        // Log progress for debugging
                        ccLogger.debug('Model download progress:', progress);
                        
                        // Emit a custom event for the UI to potentially show progress
                        const event = new CustomEvent('ollama-model-progress', { 
                            detail: progress 
                        });
                        window.dispatchEvent(event);
                    });
                } catch (error) {
                    ccLogger.error('Failed to initialize required models:', error);
                    // Don't set available to false here, as Ollama is still running
                    // Just log the error and continue
                }
            }
            
            return this.available;
        } catch (error) {
            ccLogger.error('Ollama availability check failed:', error);
            this.available = false;
            return false;
        }
    }

    setApiKey(key) {
        //this.apiKey = key; 
    }
    
    get hostEndpoint() {
        //on macos: launchctl setenv OLLAMA_ORIGINS "*"
        return 'localhost:11434'
    }

    async getHttpClient() {
        return {
            timeout: 5 * 60 * 1000 // 5 minutes
        };
    }

    async getModelsList() {
        ccLogger.debug('Fetching Ollama models list');
        try {
            const response = await fetch(`http://${this.hostEndpoint}/api/tags`);
            const data = await response.json();
            ccLogger.debug(`Found ${data.models?.length || 0} models`);
            return data.models;
        } catch (error) {
            ccLogger.error('Failed to fetch Ollama models:', error);
            return [];
        }
    }

    async downloadModel(modelName, progressCallback = null) {
        ccLogger.group('Downloading Ollama model');
        ccLogger.debug(`Starting download for model: ${modelName}`);
        
        try {
            const response = await fetch(`http://${this.hostEndpoint}/api/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: modelName })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line) continue;
                    try {
                        const status = JSON.parse(line);
                        if (progressCallback && status.status) {
                            // Different progress states based on status message
                            switch (status.status) {
                                case 'pulling manifest':
                                    progressCallback({
                                        phase: 'manifest',
                                        status: 'Pulling manifest...',
                                        progress: 0
                                    });
                                    break;
                                    
                                case 'verifying sha256 digest':
                                    progressCallback({
                                        phase: 'verify',
                                        status: 'Verifying download...',
                                        progress: 95
                                    });
                                    break;
                                    
                                case 'writing manifest':
                                    progressCallback({
                                        phase: 'write',
                                        status: 'Writing manifest...',
                                        progress: 98
                                    });
                                    break;
                                    
                                case 'removing any unused layers':
                                    progressCallback({
                                        phase: 'cleanup',
                                        status: 'Cleaning up...',
                                        progress: 99
                                    });
                                    break;
                                    
                                case 'success':
                                    progressCallback({
                                        phase: 'complete',
                                        status: 'Download complete!',
                                        progress: 100
                                    });
                                    break;
                                    
                                default:
                                    // Handle downloading progress
                                    if (status.status.startsWith('downloading')) {
                                        const progress = status.completed && status.total 
                                            ? Math.round((status.completed / status.total) * 90) // Up to 90% for download phase
                                            : 0;
                                            
                                        progressCallback({
                                            phase: 'download',
                                            status: `Downloading ${status.digest || ''}...`,
                                            progress,
                                            detail: {
                                                downloaded: status.completed,
                                                total: status.total,
                                                digest: status.digest
                                            }
                                        });
                                    }
                                    break;
                            }
                        }
                    } catch (e) {
                        ccLogger.error('Error parsing model download status:', e, line);
                    }
                }
            }

            ccLogger.info('Model download completed successfully');
            ccLogger.groupEnd();
            return true;
        } catch (error) {
            ccLogger.error('Model download failed:', error);
            ccLogger.groupEnd();
            throw error;
        }
    }

    async ensureModelAvailable(modelName, progressCallback = null) {
        ccLogger.debug(`Ensuring model availability: ${modelName}`);
        const models = await this.getModelsList();
        const modelExists = models.some(m => m.name === modelName);

        if (!modelExists) {
            ccLogger.info(`Model ${modelName} not found, starting download`);
            return this.downloadModel(modelName, progressCallback);
        }

        ccLogger.debug(`Model ${modelName} is already available`);
        return true;
    }

    async initializeRequiredModels(progressCallback = null) {
        ccLogger.group('Initializing required models');
        const requiredModels = [
            OllamaClient.FAST_MODEL,
            'qwen2.5:14b',
            'qwen2.5:1.5b'
            //OllamaClient.REASON_MODEL,
            //OllamaClient.VISION_MODEL
        ];

        for (const model of requiredModels) {
            try {
                await this.ensureModelAvailable(model, progressCallback);
            } catch (error) {
                ccLogger.error(`Failed to initialize model ${model}:`, error);
                throw error;
            }
        }
        ccLogger.info('All required models initialized');
        ccLogger.groupEnd();
    }

    localToolFromSbTool(tool) {
        ccLogger.debug('Converting tool format:', tool.name);
        return {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool?.parameters ? {
                    type: 'object',
                    properties: {...tool.parameters.properties},
                    required: tool?.parameters?.required || []
                } : null
            }
        };
    }

    async chatCompletion(messages, chunkedOutput, model, toolCaller = null, tools = null, temp = 0.9, keepAlive = "30m") {
        ccLogger.group('Ollama Chat Completion');
        const startTime = Date.now();
        let output = '';
        let availableTools = tools;
        let selectedModel = model;

        ccLogger.debug('Starting chat completion:', {
            model: selectedModel,
            toolCount: tools?.length,
            temperature: temp,
            keepAlive
        });

        let token = null;
        do {
            output = '';
            token = await this.chatCompletionUnwrapped(
                toolCaller,
                messages,
                (chunk) => {
                    if(typeof chunk === 'string') {
                        output += chunk;
                    }
                    chunkedOutput?.(chunk);
                },
                selectedModel,
                availableTools,
                null,
                null,
                temp,
                true,
                keepAlive
            );

            if(token?.message?.tool_calls?.length > 0) {
                for(var toolCall of token.message.tool_calls) { 
                    ccLogger.debug('Processing tool call:', {
                        name: toolCall.name,
                        index: toolCall.index
                    });
                    messages.push({
                        role: 'assistant',
                        tool_calls: [{
                            function: {
                                index: toolCall.index,
                                name: toolCall.name,
                                arguments: toolCall.arguments
                            }
                        }]
                    });   
                    messages.push({
                        role: 'tool',
                        content: JSON.stringify(toolCall.result)
                    });
                }
            } else {
                messages.push({
                    role: 'assistant',
                    content: output
                });
            }

            var lastMessage = messages[messages.length - 1];
            ccLogger.debug('Last message type:', lastMessage.role);
            if(lastMessage.role !== 'tool') {
                break;
            }

        } while(true);

        selectedModel = model;
        availableTools = tools;

        const elapsed = Date.now() - startTime;
        ccLogger.info(`Chat completion completed in ${elapsed}ms`);
        ccLogger.debug('Final messages:', messages);
        ccLogger.debug('Final response:', output);
        ccLogger.groupEnd();

        return [output, token, messages];
    }

    async chatCompletionUnwrapped(toolCaller, messages, outputToken, model, tools = null, systemPrompt = null, format = null, temp = 0.9, stream = true, keepAlive = "30m") {
        ccLogger.group('Ollama Chat Completion Unwrapped');
        model = model || this.defaultModel;

        ccLogger.debug('Request configuration:', {
            model,
            messageCount: messages.length,
            hasTools: !!tools,
            hasSystemPrompt: !!systemPrompt,
            temperature: temp,
            stream,
            keepAlive
        });

        if(!outputToken) {
            outputToken = (s) => {};
        }

        const request = {
            model,
            messages,
            tools,
            format,
            options: { temperature: temp },
            stream,
            keep_alive: keepAlive,
            system: systemPrompt || undefined
        };

        try {
            const response = await fetch(`http://${this.hostEndpoint}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'Accept-Encoding': 'gzip',
                    'Accept-Charset': 'utf-8',
                    'Accept-Language': 'en-US',
                },
                body: JSON.stringify(request)
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            var toolCalls = [];

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                let output = '';

                for (const line of lines) {
                    if (!line) continue;
                    try {
                        var token = JSON.parse(line);                    
                        if (token?.message?.tool_calls?.length > 0) {
                            for (var toolCall of token?.message?.tool_calls) {
                                const { name, arguments: args } = toolCall.function;
                                const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
                                if(!toolCall.id) {
                                    toolCall.id = this.callIndex++;
                                }

                                ccLogger.debug('Processing tool call:', {
                                    id: toolCall.id,
                                    name,
                                    hasArgs: !!parsedArgs
                                });

                                outputToken({
                                    type: 'TOOL_CALL_CHUNK',
                                    payload: {
                                        id: toolCall.id,
                                        index: toolCall.index,
                                        name: name,
                                        arguments: parsedArgs,
                                        callStarted: true,
                                        callFinished: false
                                    },
                                });
                                
                                var result = null;
                                try {
                                    result = await toolCaller(toolCall.function);
                                } catch(e) {
                                    ccLogger.error('Error calling tool:', e);
                                    result = { result: `ERROR: ${e.message}` };
                                }

                                outputToken({
                                    type: 'TOOL_CALL_CHUNK',
                                    payload: {
                                        id: toolCall.id,
                                        index: toolCall.index,
                                        name: name,
                                        arguments: parsedArgs,
                                        result: JSON.stringify(result.result),
                                        callStarted: false,
                                        callFinished: true
                                    }
                                });

                                ccLogger.debug('Tool execution result:', {
                                    success: result.success,
                                    hasError: !!result.error
                                });

                                toolCall.result = result.result;
                                toolCall.name = name;
                                toolCall.arguments = parsedArgs;
                                toolCalls.push(toolCall);
                            }
                        } else {
                            output += token?.message?.content || '';
                            outputToken(token?.message?.content || '');
                        }
                        
                        if (token?.done) {
                            if(toolCalls.length > 0)
                                token.message.tool_calls = toolCalls;
                            token.message.content = output;
                            ccLogger.debug('Completion finished:', {
                                hasToolCalls: toolCalls.length > 0,
                                outputLength: output.length
                            });
                            ccLogger.groupEnd();
                            return token;
                        }
                    } catch (e) {
                        ccLogger.error('Error parsing token:', e);
                    }
                }
            }
        } catch (error) {
            ccLogger.error('Ollama API Error:', error);
            ccLogger.groupEnd();
            throw error;
        }
        ccLogger.debug('No response from Ollama');
        ccLogger.groupEnd();
        return null;
    }
}

/* harmony default export */ const ollama = (new OllamaClient()); 
;// ./src/local-storage.js
class CCLocalStorage {
    static #pass = 'CarbonLocalSecurityKey';
    
    static async setEncrypted(key, value) {
        let enc = '';
        for(let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i) ^ this.#pass.charCodeAt(i % this.#pass.length);
            enc += c.toString(16).padStart(4, '0');
        }
        await chrome.storage.local.set({ [key]: enc });
        console.log('setEncrypted', key, `[${value.substring(0, 4)}...]`);
    }

    static async getEncrypted(key) {
        const result = await chrome.storage.local.get([key]);
        const enc = result[key];
        if (!enc) return null;
        
        let dec = '';
        for(let i = 0; i < enc.length; i += 4) {
            const c = parseInt(enc.slice(i, i + 4), 16);
            dec += String.fromCharCode(c ^ this.#pass.charCodeAt((i/4) % this.#pass.length));
        }
        console.log('getEncrypted', key, `[${dec.substring(0, 4)}...]`);
        return dec;
    }

    static async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
    }

    static async get(key) {
        const result = await chrome.storage.local.get([key]);
        return result[key] || null;
    }

    static async getAll() {
        return await chrome.storage.local.get(null);
    }

    static async remove(key) {
        await chrome.storage.local.remove(key);
    }
}

/* harmony default export */ const local_storage = (CCLocalStorage);
;// ./src/external-services/openai.js



class OpenAIClient {
    static FAST_MODEL = "gpt-4o-mini";
    static REASON_MODEL = "o3-mini";
    static VISION_MODEL = "gpt-4-vision-preview";
    static isAvailable = null;

    constructor() {
        this.apiKey = '';
        this.defaultModel = OpenAIClient.FAST_MODEL;
    }

    setApiKey(key) {
        ccLogger.debug('Setting OpenAI API key');
        this.apiKey = key;
    }

    async isAvailable() {
        if(OpenAIClient.isAvailable == null) {
            let key = await local_storage.getEncrypted('openai_api_key');
            OpenAIClient.isAvailable = (key && key.length > 0);
            if(OpenAIClient.isAvailable) {
                this.apiKey = key;
                ccLogger.info('OpenAI is available and configured');
            } else {
                ccLogger.warn('OpenAI is not available - no API key found');
            }
        }
        return OpenAIClient.isAvailable;
    }

    async testKey(key) {
        ccLogger.group('Testing OpenAI API Key');
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${key}`
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Invalid API key');
            }
            
            const data = await response.json();
            const isValid = data.data && data.data.length > 0;
            ccLogger.info('API key test result:', isValid ? 'Valid' : 'Invalid');
            ccLogger.groupEnd();
            return isValid;
        } catch (error) {
            ccLogger.error('OpenAI key test failed:', error);
            ccLogger.groupEnd();
            throw new Error(`Invalid OpenAI key: ${error.message}`);
        }
    }

    async getHttpClient() {
        return {
            timeout: 5 * 60 * 1000 // 5 minutes
        };
    }

    async getModelsList() {
        ccLogger.debug('Fetching OpenAI models list');
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });
        const data = await response.json();
        ccLogger.debug(`Found ${data.data?.length || 0} models`);
        return data.data;
    }

    localToolFromSbTool(tool) {
        ccLogger.debug('Converting tool format:', tool.name);
        var properties = {};

        if(tool.parameters) {
            for(var paramKey of Object.keys(tool.parameters)) {
                var param = tool.parameters[paramKey];
                var paramType = param?.type || 'string';

                if(paramType === 'number') {
                    paramType = 'string';
                }
                properties[paramKey] = param;
            }
        }

        return {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: properties && Object.keys(properties).length > 0 ? {
                    type: 'object',
                    properties: {...properties.properties},
                    required: tool?.parameters?.required || []
                } : null
            }
        };
    }

    async chatCompletion(messages, chunkedOutput, model, toolCaller = null, tools = null, temp = 0.9) {
        ccLogger.group('OpenAI Chat Completion');
        const startTime = Date.now();
        let output = '';

        let availableTools = tools;
        let selectedModel = model || this.defaultModel;

        ccLogger.debug('Starting chat completion:', {
            model: selectedModel,
            toolCount: tools?.length,
            temperature: temp
        });

        let token = null;
        do {
            output = '';
            token = await this.chatCompletionUnwrapped(
                messages,
                (chunk) => {
                    if(typeof chunk === 'string') {
                        output += chunk;
                    }
                    chunkedOutput?.(chunk);
                },
                selectedModel,
                toolCaller,
                availableTools,
                temp
            );

            if(token?.tool_calls?.length > 0) {
                for(var toolCall of token.tool_calls) {
                    messages.push({
                        role: 'assistant',
                        tool_calls: [{
                            id: toolCall.id,
                            type: 'function',
                            function: {
                                name: toolCall.function.name,
                                arguments: toolCall.function.arguments
                            }
                        }]
                    });
                    
                    ccLogger.debug('Calling tool:', toolCall.function.name);
                    const parsedArgs = JSON.parse(toolCall.function.arguments);
                    const toolCallerResult = await toolCaller({ name: toolCall.function.name, arguments: parsedArgs });
                    chunkedOutput({
                        type: 'TOOL_CALL_CHUNK',
                        payload: {
                            id: toolCall.id,
                            index: toolCall.index,
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments,
                            callStarted: false,
                            callFinished: true,
                            result: JSON.stringify(toolCallerResult.result)
                        }
                    });
                    ccLogger.debug('Tool execution result:', {
                        success: toolCallerResult.success,
                        hasError: !!toolCallerResult.error
                    });

                    if(toolCallerResult && toolCallerResult.success) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: typeof toolCallerResult.result === 'string' ? toolCallerResult.result : JSON.stringify(toolCallerResult.result)
                        });
                    } else {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: typeof toolCallerResult.error === 'string' ? toolCallerResult.error : JSON.stringify(toolCallerResult.error)
                        });
                    }
                }
            } else {
                messages.push({
                    role: 'assistant',
                    content: output
                });
            }

            var lastMessage = messages[messages.length - 1];
            ccLogger.debug('Last message type:', lastMessage.role);
            if(lastMessage.role !== 'tool') {
                break;
            }

        } while(true);

        const elapsed = Date.now() - startTime;
        ccLogger.info(`Chat completion completed in ${elapsed}ms`);
        ccLogger.debug('Final messages:', messages);
        ccLogger.debug('Final response:', output);
        ccLogger.groupEnd();

        return [output, token, messages];
    }

    async chatCompletionUnwrapped(messages, outputToken, model, toolCaller = null, tools = null, temp = 0.9, stream = true) {
        ccLogger.group('OpenAI Chat Completion Unwrapped');
        model = model || this.defaultModel;

        ccLogger.debug('Request configuration:', {
            model,
            messageCount: messages.length,
            hasTools: !!tools,
            temperature: temp,
            stream
        });

        if(!outputToken) {
            outputToken = (s) => {};
        }

        const request = {
            model,
            messages,
            temperature: temp,
            stream,
            ...(tools && { tools, tool_choice: 'auto' })
        };

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Accept': stream ? 'text/event-stream' : 'application/json',
                },
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
            }

            if (!stream) {
                const data = await response.json();
                if (!data.choices?.[0]?.message) {
                    throw new Error('Invalid response format from OpenAI API');
                }
                const content = data.choices[0].message.content;
                outputToken(content);
                ccLogger.groupEnd();
                return {
                    message: { content },
                    tool_calls: data.choices[0].message.tool_calls,
                    usage: data.usage
                };
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let toolCalls = [];
            let currentToolCall = null;
            let output = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value);
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;
                    if (line.includes('[DONE]')) continue;

                    try {
                        const data = JSON.parse(line.slice(6));
                        const delta = data.choices?.[0]?.delta;
                        if (!delta) continue;

                        const finishReason = data.choices[0]?.finish_reason;
                        if (delta.tool_calls) {
                            const toolCall = delta.tool_calls[0];
                            
                            if (toolCall.index !== undefined) {
                                if (!toolCalls[toolCall.index]) {
                                    toolCalls[toolCall.index] = {
                                        id: toolCall.id,
                                        index: toolCall.index,
                                        function: {
                                            name: '',
                                            arguments: ''
                                        }
                                    };
                                }
                                currentToolCall = toolCalls[toolCall.index];
                            }

                            if (toolCall.function) {
                                if (toolCall.function.name) {
                                    currentToolCall.function.name = toolCall.function.name;
                                }
                                if (toolCall.function.arguments) {
                                    currentToolCall.function.arguments += toolCall.function.arguments;
                                }
                                outputToken({
                                    type: 'TOOL_CALL_CHUNK',
                                    payload: {
                                        id: currentToolCall.id,
                                        index: toolCall.index,
                                        name: currentToolCall.function.name,
                                        arguments: currentToolCall.function.arguments,
                                        callStarted: finishReason == 'tool_calls',
                                        callFinished: false
                                    }
                                });
                            }
                        } else if (delta.content) {
                            output += delta.content;
                            outputToken(delta.content);
                        }
                        
                        if (finishReason) {
                            if (toolCalls.length > 0) {
                                for(var toolCall of toolCalls) {
                                    outputToken({
                                        type: 'TOOL_CALL_CHUNK',
                                        payload: {
                                            id: toolCall.id,
                                            index: toolCall.index,
                                            name: toolCall.function.name,
                                            arguments: toolCall.function.arguments,
                                            callFinished: true,
                                            result: toolCall.result
                                        }
                                    });
                                }
                                ccLogger.groupEnd();
                                return {
                                    message: { content: output },
                                    tool_calls: toolCalls,
                                    finish_reason: finishReason
                                };
                            }
                            ccLogger.groupEnd();
                            return {
                                message: { content: output },
                                finish_reason: finishReason
                            };
                        }
                    } catch (e) {
                        ccLogger.error('Error parsing chunk:', e, line);
                    }
                }
            }
        } catch (error) {
            ccLogger.error('OpenAI API Error:', error);
            ccLogger.groupEnd();
            throw error;
        }
        ccLogger.groupEnd();
        return null;
    }
}

/* harmony default export */ const openai = (new OpenAIClient()); 
;// ./src/external-services/caller.js





const AICallerModels = {
    ['FAST']: {
        ollama: 'qwen2.5:14b',
        openai: 'gpt-4o-mini'
    },
    ['REASON']: {
        ollama: "deepseek-r1:70b",
        openai: "o3-mini"
    },
    ['VISION']: {
        ollama: "llama3.2-vision",
        openai: "gpt-4o"
    },
    ['AUTOCOMPLETE']: {
        ollama: 'mistral-small',//"qwen2.5:1.5b",
        openai: "gpt-4o-mini"
    }
}

class AICaller {
    constructor() {
        this.openai = openai;
        this.ollama = ollama;
        this.defaultProvider = '';
        this.init();
    }

    async init() {
        ccLogger.group('Initializing AI Caller');
        try {            
            // Prioritize OpenAI over Ollama if both are available
            if(await this.openai.isAvailable()) {
                ccLogger.info('OpenAI is available, setting as default provider');
                this.setDefaultProvider('openai');
            } else if(await this.ollama.isAvailable()) {
                ccLogger.info('Ollama is available, setting as default provider');
                this.setDefaultProvider('ollama');
            } else {
                ccLogger.warn('No AI providers available, setting to local');
                this.setDefaultProvider('local');
            }
            ccLogger.debug('AI Caller initialized with provider:', this.defaultProvider);
        } catch(e) {
            ccLogger.error('AI Caller initialization error:', e);
        }
        ccLogger.groupEnd();
    }

    async reinitialize() {
        ccLogger.info('Reinitializing AI Caller');
        this.defaultProvider = '';
        await this.init();
        return this.defaultProvider;
    }

    setDefaultProvider(provider) {
        if(provider !== 'ollama' && provider !== 'openai' && provider !== 'local') {
            throw new Error('Invalid provider. Must be either "ollama" or "openai" or "local"');
        }
        if(provider == 'local')
            throw new Error('No local AI provider available, yet...', { details: "no_provider" });
        
        ccLogger.info(`Setting default provider to: ${provider}`);
        this.defaultProvider = provider;
    }

    async setOpenAIKey(key) {
        ccLogger.group('Setting OpenAI API Key');
        try {
            // Test the key before setting it
            await this.openai.testKey(key);
            
            // If test passes, save the key and set it
            await local_storage.setEncrypted('openai_api_key', key);
            this.openai.setApiKey(key);
            this.setDefaultProvider('openai');
            ccLogger.info('OpenAI API key set successfully');
            ccLogger.groupEnd();
            return true;
        } catch (error) {
            ccLogger.error('Failed to set OpenAI API key:', error);
            ccLogger.groupEnd();
            throw error;
        }
    }

    getClient(provider = null) {
        provider = provider || this.defaultProvider;
        
        if (provider === 'openai' && !this.openai.isAvailable()) {
            throw new Error('OpenAI API key not set');
        }

        if (provider === 'ollama' && !this.ollama.isAvailable()) {
            throw new Error('Ollama is not available');
        }

        return provider === 'openai' ? this.openai : this.ollama;
    }

    async autocomplete(commandBarInput, commandHistory, context) {
        ccLogger.group('Generating Autocomplete');
        let systemPrompt = ``;
        systemPrompt += `Command history:\n${commandHistory.join('\n')}`;
        if(context && context.length > 0) {
            systemPrompt += `Context:\n${context}\n`;
        }

        systemPrompt += `\n\nAutocomplete the user input based on the command history and context. Output only the suggested input as if you were autocompleting the user input.`;

        var addUserInputViaSystemPrompt = true;
        if(addUserInputViaSystemPrompt) {
            systemPrompt += `\n\nUser input: ${commandBarInput}`;
        }
        
        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        if(!addUserInputViaSystemPrompt) {
            messages.push({ role: 'user', content: commandBarInput });
        }
        
        const provider = this.ollama.isAvailable() ? 'ollama' : 'openai';
        const [suggestion, details] = await this.chatCompletion(messages, null, AICallerModels['AUTOCOMPLETE'][provider], provider, null, null, 0.8);
        ccLogger.debug('Autocomplete result:', {
            input: commandBarInput,
            suggestion,
            provider
        });

        // Modified logic to handle partial word matches
        if (suggestion) {
            const inputWords = commandBarInput.toLowerCase().split(' ');
            const suggestionWords = suggestion.toLowerCase().split(' ');
            
            // Check if suggestion extends the last word or adds new words
            if (inputWords.length <= suggestionWords.length) {
                const lastInputWord = inputWords[inputWords.length - 1];
                const lastSuggestionWord = suggestionWords[inputWords.length - 1];
                
                // Check if the last word is being completed or if new words are being added
                if ((lastInputWord && lastSuggestionWord.startsWith(lastInputWord)) ||
                    suggestionWords.length > inputWords.length) {
                    const result = commandBarInput + suggestion.slice(commandBarInput.length);
                    ccLogger.debug('Autocomplete match found:', result);
                    ccLogger.groupEnd();
                    return result;
                }
            } else {
                //Add the suggestion as a new word
                const newInput = inputWords.concat(suggestionWords).join(' ');
                ccLogger.debug('Adding new word suggestion:', newInput);
                ccLogger.groupEnd();
                return newInput;
            }
        }
        
        ccLogger.debug('No suitable autocomplete suggestion found');
        ccLogger.groupEnd();
        return null;
    }

    async quickSummarize(string, prompt = "") {
        ccLogger.group('Quick Summarize');
        if(prompt) {
            prompt = `${prompt}: ${string}`;
        } else {
            prompt = `Summarize the following text: ${string}`;
        }
        const messages = [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: prompt }
        ];
        const token = await this.chatCompletion(messages, null, ollama.FAST_MODEL);
        ccLogger.debug('Summary result:', token);
        ccLogger.groupEnd();
        return token;
    }

    async chatCompletion(messages, chunkedOutput, model, provider = null, toolCaller = null, tools = null, temp = 0.9, keepAlive = "30m") {
        ccLogger.group('Chat Completion');
        if(!provider || provider == null) {
            provider = this.defaultProvider;
        }

        if(!this.defaultProvider || this.defaultProvider == '') {
            ccLogger.error('No AI provider available');
            ccLogger.groupEnd();
            throw new Error('No AI provider available', { details: "no_provider" });
        }

        const client = this.getClient(provider);
        
        // Handle different model name formats between providers
        const actualModel = typeof model === 'string' ? model : this.getModelForProvider(model);

        ccLogger.debug('Starting chat completion:', {
            provider,
            model: actualModel,
            toolCount: tools?.length,
            temperature: temp,
            keepAlive
        });
        
        try {
            const result = await client.chatCompletion(
                messages,
                chunkedOutput,
                actualModel,
                toolCaller,
                this.convertTools(tools, provider),
                temp,
                keepAlive
            );
            ccLogger.debug('Chat completion completed successfully');
            ccLogger.groupEnd();
            return result;
        } catch (error) {
            ccLogger.error('Chat completion failed:', error);
            ccLogger.groupEnd();
            throw error;
        }
    }

    async getModelsList(provider = null) {
        ccLogger.debug('Fetching models list for provider:', provider || this.defaultProvider);
        const client = this.getClient(provider);
        return await client.getModelsList();
    }
    
    convertTools(tools, targetProvider) {
        if (!tools) return null;

        ccLogger.debug('Converting tools for provider:', targetProvider);
        const client = this.getClient(targetProvider);
        const convertedTools = tools.map(tool => client.localToolFromSbTool(tool));
        ccLogger.debug(`Converted ${convertedTools.length} tools`);
        return convertedTools;
    }

    getModelForProvider(modelType) {
        if(!modelType) {
            return AICallerModels['FAST'][this.defaultProvider];
        }

        if (typeof modelType === 'string') return modelType;

        if(modelType[this.defaultProvider]) {
            return modelType[this.defaultProvider];
        }

        return modelType['FAST'][this.defaultProvider];
    }

    supportsFeature(feature, provider = null) {
        provider = provider || this.defaultProvider;
        const features = {
            vision: {
                ollama: true,
                openai: true
            },
            streaming: {
                ollama: true,
                openai: true
            },
            tools: {
                ollama: true,
                openai: true
            }
        };
        return features[feature]?.[provider] || false;
    }
}

// Export a singleton instance


/* harmony default export */ const caller = (new AICaller());
// EXTERNAL MODULE: ./src/tools/CarbonBarHelpTools.js
var CarbonBarHelpTools = __webpack_require__(450);
;// ./src/carbon-commander.css
const carbon_commander_namespaceObject = ".cc-container {\n    all: initial;\n    display: block;\n    padding: 7px;\n    background-color: rebeccapurple;\n    border: 1px solid mediumorchid;\n    border-radius: 8px;\n    transition: all 0.5s ease-in-out;\n    box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7);\n    animation: gentlePulse 4s ease-in-out infinite;\n    color: white;\n    font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n    font-size: 14px;\n    line-height: 1.4;\n    box-sizing: border-box;\n}\n\n\n.cc-container.waiting-input {\n    animation: inputPulse 2s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.processing {\n    animation: processingPulse 1.5s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.has-error {\n    animation: errorPulse 1s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.tool-running {\n    animation: toolPulse 2s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.success {\n    animation: successPulse 3s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.rainbow {\n    animation: rainbowPulse 5s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n/* Add a transition class for smoother state changes */\n.cc-container.transitioning {\n    animation-play-state: paused;\n}\n\n/* Animation keyframes with smoother transitions */\n@keyframes gentlePulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7); }\n}\n\n@keyframes inputPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(52, 152, 219, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(41, 128, 185, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(52, 152, 219, 0.7); }\n}\n\n@keyframes processingPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n}\n\n@keyframes errorPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(192, 57, 43, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n}\n\n@keyframes toolPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(39, 174, 96, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n}\n\n@keyframes successPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(39, 174, 96, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n}\n\n/* Update rainbow animation for smoother transitions */\n@keyframes rainbowPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n    16.66% { box-shadow: 0px 0px 15px 3px rgba(241, 196, 15, 0.7); }\n    33.33% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(52, 152, 219, 0.7); }\n    66.66% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n    83.33% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n}\n\n/* Dialog header */\n.cc-dialog-header {\n    display: flex;\n    align-items: center;\n    margin-bottom: 8px;\n}\n\n.cc-title {\n    font-weight: 500;\n    font-size: 16px;\n}\n\n/* Input styles */\n.cc-input-wrapper {\n    position: relative;\n    width: 100%;\n    display: flex;\n}\n\n.cc-input {\n    width: 100%;\n    padding: 8px 12px;\n    background-color: rgba(0, 0, 0, 0.2);\n    border: 1px solid mediumorchid;\n    border-radius: 4px;\n    font-size: 16px;\n    color: white;\n    outline: none;\n}\n\n.cc-input:focus {\n    border-color: #9b59b6;\n    box-shadow: 0 0 0 2px rgba(155, 89, 182, 0.3);\n}\n\n.cc-results {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n    max-height: 480px;\n    overflow-y: auto;\n    margin-bottom: 8px;\n    padding: 4px;\n    opacity: 1;\n    transition: opacity 0.3s ease-in-out;\n}\n\n.cc-results > *:first-child {\n    margin-top: 0;\n}\n\n.cc-results.hidden {\n    opacity: 0;\n}\n\n.cc-result-item {\n    display: flex;\n    flex-direction: row;\n    flex-wrap: wrap;\n}\n\n.cc-result-item > p {\n    margin: 0;\n}\n\n/* Smooth transition for user message appearance */\n.cc-user-message {\n    padding: 8px 12px;\n    margin: 8px 0;\n    background-color: slategray;\n    border-radius: 8px;\n    font-weight: 500;\n    opacity: 0;\n    transform: translateY(10px);\n    animation: messageAppear 0.3s ease-in-out forwards;\n}\n\n@keyframes messageAppear {\n    from {\n        opacity: 0;\n        transform: translateY(10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateY(0);\n    }\n}\n\n.cc-error {\n    padding: 4px;\n    margin: 0px;\n    background-color: firebrick;\n    color: white;\n    border-radius: 4px;\n}\n\n.cc-dialog {\n    margin: 10px 0;\n    padding: 10px;\n    background-color: dodgerblue;\n    border-radius: 8px;\n    box-shadow: 0 2px 4px rgba(0,0,0,0.1);\n}\n\n.cc-dialog-content {\n    display: flex;\n    flex-direction: column;\n    gap: unset;\n}\n\n.cc-dialog-buttons {\n    display: flex;\n    gap: 8px;\n    justify-content: flex-end;\n}\n\n.cc-button {\n    padding: 6px 12px;\n    border: none;\n    border-radius: 4px;\n    cursor: pointer;\n    font-size: 14px;\n    transition: background-color 0.2s;\n}\n\n.cc-button.confirm {\n    background-color: #2ecc71;\n    color: white;\n}\n\n.cc-button.confirm:hover {\n    background-color: #27ae60;\n}\n\n.cc-button.cancel {\n    background-color: #e74c3c;\n    color: white;\n}\n\n.cc-button.cancel:hover {\n    background-color: #c0392b;\n}\n\n.cc-input-group {\n    margin: 2px 10px;\n}\n\n.cc-dialog-content > p {\n    margin: 4px;\n}\n\n.cc-input-group label {\n    display: block;\n    margin-bottom: 5px;\n    font-weight: 500;\n}\n\n.cc-dialog-input {\n    width: 100%;\n    padding: 8px;\n    border: 1px solid var(--border-color, #ddd);\n    border-radius: 4px;\n    margin-bottom: 10px;\n}\n\n.cc-tool-call {\n    margin: 2px 1px;\n    padding: 0;\n    width: fit-content;\n}\n\n.tool-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 8px;\n}\n\n.tool-name {\n    font-weight: bold;\n    color: #79c1ff;\n}\n\n.tool-status {\n    font-size: 0.9em;\n    padding: 4px 8px;\n    border-radius: 8px;\n    position: relative;\n    transition: background-color 0.3s ease-in-out;\n}\n\n.tool-status.pending {\n    background-color: #f39c12;\n    animation: pulse 2s infinite;\n}\n\n.tool-status.running {\n    background-color: #3498db;\n    animation: pulse 1.5s infinite;\n}\n\n.tool-status.completed {\n    background-color: #2ecc71;\n}\n\n.tool-status.error {\n    background-color: #e74c3c;\n}\n\n.tool-arguments {\n    font-family: monospace;\n    background-color: rgba(0, 0, 0, 0.2);\n    padding: 8px;\n    border-radius: 4px;\n    margin: 8px 0;\n    word-break: break-all;\n    position: relative;\n    transition: border-left-color 0.3s ease-in-out, background-color 0.3s ease-in-out;\n}\n\n/* Progress states for arguments */\n.tool-arguments.arg-started {\n    border-left: 3px solid #f39c12;\n}\n\n.tool-arguments.arg-property {\n    border-left: 3px solid #e67e22;\n}\n\n.tool-arguments.arg-value {\n    border-left: 3px solid #3498db;\n}\n\n.tool-arguments.arg-multiple {\n    border-left: 3px solid #9b59b6;\n}\n\n.tool-arguments.arg-complete {\n    border-left: 3px solid #2ecc71;\n    animation: completePulse 0.5s ease;\n}\n\n@keyframes completePulse {\n    0% {\n        background-color: rgba(46, 204, 113, 0.2);\n    }\n    50% {\n        background-color: rgba(46, 204, 113, 0.3);\n    }\n    100% {\n        background-color: rgba(0, 0, 0, 0.2);\n    }\n}\n\n/* Progress indicator dots */\n.tool-arguments::before {\n    content: '';\n    position: absolute;\n    right: 8px;\n    top: 50%;\n    transform: translateY(-50%);\n    width: 6px;\n    height: 6px;\n    border-radius: 50%;\n    animation: progressDot 1s infinite;\n}\n\n.tool-arguments.arg-started::before { background-color: #f39c12; }\n.tool-arguments.arg-property::before { background-color: #e67e22; }\n.tool-arguments.arg-value::before { background-color: #3498db; }\n.tool-arguments.arg-multiple::before { background-color: #9b59b6; }\n.tool-arguments.arg-complete::before { display: none; }\n\n@keyframes progressDot {\n    0%, 100% { opacity: 0.4; }\n    50% { opacity: 1; }\n}\n\n/* Typing cursor animation for arguments */\n.tool-arguments.typing::after {\n    content: '|';\n    position: absolute;\n    margin-left: 2px;\n    animation: blink 1s step-end infinite;\n}\n\n@keyframes blink {\n    0%, 100% { opacity: 1; }\n    50% { opacity: 0; }\n}\n\n/* Status indicator animations */\n@keyframes pulse {\n    0% {\n        box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4);\n    }\n    70% {\n        box-shadow: 0 0 0 6px rgba(255, 255, 255, 0);\n    }\n    100% {\n        box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);\n    }\n}\n\n.tool-description {\n    font-size: 0.9em;\n    color: #bdc3c7;\n    margin-bottom: 8px;\n}\n\n.tool-view-toggle {\n    align-self: flex-end;\n    border: none;\n    cursor: pointer;\n    font-size: 12px;\n}\n\n.tool-view-toggle:hover {\n    background: rgba(255, 255, 255, 0.2);\n}\n\n.tool-simple-container {\n    display: inline-flex;\n    flex-direction: column;\n    width: fit-content;\n    margin: 0px;\n    padding: 1px;\n    background-color: teal;\n    vertical-align: top;\n    user-select: none;\n    cursor: pointer;\n    transition: background-color 0.3s ease-in-out, border-color 0.3s ease-in-out;\n    border-radius: 8px;\n    border-width: 1px;\n    border-style: solid;\n    border-color: mediumorchid;\n}\n\n/* Status-based background colors */\n.tool-simple-container.pending {\n    background-color: #8e44ad; /* Purple for pending/constructing */\n}\n\n.tool-simple-container.running {\n    background-color: #2980b9; /* Blue for running */\n}\n\n.tool-simple-container.completed {\n    background-color: #27ae60; /* Green for completed */\n}\n\n.tool-simple-container.error {\n    background-color: #c0392b; /* Red for error */\n}\n\n.tool-simple-icon {\n    font-size: 24px;\n    padding: 0px 4px;\n    margin: 0;\n    border-radius: 8px;\n    background: rgba(255, 255, 255, 0.1);\n}\n\n.tool-simple-icon.running {\n    animation: pulse 1.5s infinite;\n}\n\n.tool-simple-icon.error {\n    margin-top: 0px;\n    font-size: 30px;\n}\n\n.tool-simple-content {\n    display: flex;\n    align-items: flex-start;\n    margin: 2px;\n}\n\n.tool-simple-info {\n    flex: 1;\n    margin-left: 4px;\n}\n\n.tool-simple-name {\n    font-weight: normal;\n    margin-bottom: 2px;\n}\n\n.tool-simple-progress {\n    position: relative;\n    height: 4px;\n    background: rgba(255, 255, 255, 0.1);\n    border-radius: 2px;\n    margin-top: 8px;\n}\n\n.cc-ai-output {\n    background-color: slateblue;\n    border-radius: 8px;\n    margin: 2px 0px;\n    padding: 8px 12px;\n    width: 100%;\n    text-indent: 0px;\n} \n\n.cc-ai-output h1,\n.cc-ai-output h2,\n.cc-ai-output h3,\n.cc-ai-output h4,\n.cc-ai-output h5,\n.cc-ai-output h6 {\n    margin: 1em 0 0.5em;\n    line-height: 1.2;\n    font-weight: 600;\n}\n\n.cc-ai-output p {\n    margin: 0.5em 0;\n    line-height: 1.5;\n}\n\n.cc-ai-output ul,\n.cc-ai-output ol {\n    margin: 0.5em 0;\n    padding-left: 2em;\n}\n\n.cc-ai-output li {\n    margin: 0.3em 0;\n}\n\n.cc-ai-output code {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 0.2em 0.4em;\n    border-radius: 3px;\n    font-family: monospace;\n    font-size: 0.9em;\n}\n\n.cc-ai-output pre {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 1em;\n    border-radius: 4px;\n    overflow-x: auto;\n    margin: 0.5em 0;\n}\n\n.cc-ai-output pre code {\n    background: none;\n    padding: 0;\n    font-size: 0.9em;\n    color: inherit;\n}\n\n.cc-ai-output a {\n    color: #79c1ff;\n    text-decoration: none;\n}\n\n.cc-ai-output a:hover {\n    text-decoration: underline;\n}\n\n.cc-ai-output blockquote {\n    margin: 0.5em 0;\n    padding-left: 1em;\n    border-left: 3px solid rgba(255, 255, 255, 0.3);\n    color: rgba(255, 255, 255, 0.8);\n}\n\n.cc-ai-output table {\n    border-collapse: collapse;\n    margin: 0.5em 0;\n    width: 100%;\n}\n\n.cc-ai-output th,\n.cc-ai-output td {\n    border: 1px solid rgba(255, 255, 255, 0.2);\n    padding: 0.4em 0.8em;\n    text-align: left;\n}\n\n.cc-ai-output th {\n    background: rgba(0, 0, 0, 0.2);\n}\n\n.progress-bar {\n    position: absolute;\n    height: 100%;\n    background: #2ecc71;\n    border-radius: 2px;\n    transition: width 0.5s ease-in-out;\n}\n\n.progress-text {\n    position: absolute;\n    right: 0;\n    top: -20px;\n    font-size: 12px;\n    color: rgba(255, 255, 255, 0.7);\n}\n\n.tool-simple-complete {\n    display: flex;\n    align-items: center;\n    color: #2ecc71;\n}\n\n.checkmark {\n    margin-right: 8px;\n    font-size: 18px;\n}\n\n.tool-advanced-container {\n    background: rgba(255, 255, 255, 0.1);\n    border-radius: 8px;\n    margin: 0px;\n    padding: 6px;\n    width: fit-content;\n}\n\n.tool-parameters {\n    margin: 12px 0;\n    padding: 8px;\n    background: rgba(0, 0, 0, 0.2);\n    border-radius: 4px;\n}\n\n.tool-parameters h4 {\n    margin: 0 0 8px 0;\n    color: #79c1ff;\n    font-size: 14px;\n}\n\n.tool-params-table {\n    width: 100%;\n    border-collapse: collapse;\n    font-size: 13px;\n}\n\n.tool-params-table th,\n.tool-params-table td {\n    padding: 6px;\n    text-align: left;\n    border-bottom: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n.tool-params-table th {\n    color: #79c1ff;\n    font-weight: 500;\n}\n\n.tool-arguments-section {\n    margin: 12px 0;\n}\n\n.tool-arguments-section h4 {\n    margin: 0 0 8px 0;\n    color: #79c1ff;\n    font-size: 14px;\n}\n\n.tool-advanced-container {\n    min-width: 500px;\n}\n\n.tool-result-section {\n    margin: 12px 0;\n}\n\n.tool-result-section h4 {\n    margin: 0 0 8px 0;\n    color: #79c1ff;\n    font-size: 14px;\n}\n\n.tool-result-content {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 8px;\n    border-radius: 4px;\n    font-family: monospace;\n    white-space: pre-wrap;\n    word-break: break-word;\n    border-left: 3px solid #2ecc71;\n}\n\n.cc-autocomplete {\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    height: 100%;\n    padding: 8px 12px;\n    pointer-events: none;\n    white-space: pre;\n    font-size: 16px;\n    display: flex;\n    align-items: center;\n    z-index: 0;\n    opacity: 1;\n    transition: opacity 0.2s ease-in-out;\n}\n\n.cc-autocomplete:empty {\n    opacity: 0;\n}\n\n.autocomplete-input {\n    opacity: 0;\n    color: transparent;\n}\n\n.autocomplete-suggestion {\n    color: rgba(255, 255, 255, 0.3);\n    padding-left: 2px;\n}\n\n/* Ensure input is above autocomplete */\n.cc-input {\n    background: transparent !important;\n    position: relative;\n    z-index: 1;\n}\n\n.cc-tool-count {\n    color: rgba(255, 255, 255, 0.9);\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 4px;\n    font-size: xx-small;\n    padding: 2px 6px;\n    width: max-content;\n    display: flex;\n    align-items: center;\n    cursor: pointer;\n    transition: background-color 0.2s ease;\n}\n\n.cc-tool-count::before {\n    content: '⚡';\n    margin-right: 4px;\n    font-size: 8px;\n}\n\n.cc-tool-list {\n    display: none;\n    position: absolute;\n    top: 100%;\n    right: 0;\n    width: 400px;\n    max-height: 500px;\n    background-color: rebeccapurple;\n    border: 1px solid mediumorchid;\n    border-radius: 8px;\n    margin-top: 8px;\n    padding: 12px;\n    overflow-y: auto;\n    z-index: 1000;\n    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n    animation: toolListFadeIn 0.2s ease-out;\n}\n\n.cc-tool-list.visible {\n    display: block;\n}\n\n.cc-tool-list-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 12px;\n    padding-bottom: 8px;\n    border-bottom: 1px solid rgba(255, 255, 255, 0.2);\n}\n\n.cc-tool-list-title {\n    font-size: 16px;\n    font-weight: 500;\n    color: white;\n}\n\n.cc-tool-list-close {\n    background: none;\n    border: none;\n    color: rgba(255, 255, 255, 0.7);\n    cursor: pointer;\n    font-size: 18px;\n    padding: 4px;\n    border-radius: 4px;\n    transition: background-color 0.2s ease;\n}\n\n.cc-tool-list-close:hover {\n    background-color: rgba(255, 255, 255, 0.1);\n    color: white;\n}\n\n.cc-tool-list-content {\n    display: flex;\n    flex-direction: column;\n    gap: 8px;\n}\n\n.cc-tool-item {\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 6px;\n    padding: 10px;\n    cursor: pointer;\n    transition: background-color 0.2s ease;\n}\n\n.cc-tool-item:hover {\n    background-color: rgba(0, 0, 0, 0.3);\n}\n\n.cc-tool-item-name {\n    font-weight: 500;\n    color: #79c1ff;\n    margin-bottom: 4px;\n}\n\n.cc-tool-item-description {\n    font-size: 13px;\n    color: rgba(255, 255, 255, 0.8);\n    line-height: 1.4;\n}\n\n@keyframes toolListFadeIn {\n    from {\n        opacity: 0;\n        transform: translateY(-10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateY(0);\n    }\n}\n\n/* Add a subtle arrow pointing to the tool count */\n.cc-tool-list::before {\n    content: '';\n    position: absolute;\n    top: -8px;\n    right: 20px;\n    width: 0;\n    height: 0;\n    border-left: 8px solid transparent;\n    border-right: 8px solid transparent;\n    border-bottom: 8px solid rebeccapurple;\n}\n\n.cc-no-provider {\n    padding: 16px;\n    color: #fff;\n    font-size: 14px;\n}\n\n.cc-no-provider h3 {\n    margin: 0 0 12px 0;\n    color: #ff9999;\n    font-size: 18px;\n}\n\n.cc-no-provider h4 {\n    color: #79c1ff;\n    margin: 16px 0 8px 0;\n}\n\n.cc-no-provider p {\n    margin: 8px 0;\n    line-height: 1.4;\n}\n\n.provider-section {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 12px;\n    margin: 12px 0;\n    border-radius: 6px;\n    border-left: 3px solid #79c1ff;\n}\n\n.provider-section ul {\n    margin: 8px 0;\n    padding-left: 20px;\n}\n\n.provider-section li {\n    margin: 4px 0;\n}\n\n.provider-section code {\n    background: rgba(0, 0, 0, 0.3);\n    padding: 2px 6px;\n    border-radius: 4px;\n    font-family: monospace;\n    font-size: 12px;\n}\n\n.provider-status {\n    margin-top: 16px;\n    padding: 12px;\n    background: rgba(0, 0, 0, 0.2);\n    border-radius: 6px;\n}\n\n.status-indicator {\n    color: #ff9999;\n    font-weight: 500;\n    transition: color 0.3s ease-in-out;\n}\n\n.status-indicator.connected {\n    color: #2ecc71;\n}\n\n.cc-no-provider a {\n    color: #79c1ff;\n    text-decoration: none;\n}\n\n.cc-no-provider a:hover {\n    text-decoration: underline;\n}\n\n.cc-status-badges {\n    display: flex;\n    gap: 6px;\n    align-items: center;\n    margin: 0px 0px 4px;\n}\n\n.cc-provider-badge {\n    color: rgba(255, 255, 255, 0.9);\n    background-color: rgba(231, 76, 60, 0.7);\n    border-radius: 4px;\n    font-size: xx-small;\n    padding: 2px 6px;\n    transition: background-color 0.3s ease;\n    display: flex;\n    align-items: center;\n}\n\n.cc-provider-badge::before {\n    content: '●';\n    margin-right: 4px;\n    font-size: 8px;\n}\n\n.cc-provider-badge[data-status=\"connected\"] {\n    background-color: rgba(46, 204, 113, 0.7);\n}\n\n.cc-model-download-progress {\n    margin: 8px 0;\n    padding: 8px;\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 8px;\n    transition: opacity 0.3s ease-out;\n}\n\n.cc-model-download-progress.fade-out {\n    opacity: 0;\n}\n\n.cc-download-item {\n    margin: 4px 0;\n    padding: 8px;\n    background-color: rgba(255, 255, 255, 0.1);\n    border-radius: 4px;\n    animation: slideIn 0.3s ease-out;\n}\n\n.cc-download-item[data-phase=\"manifest\"] {\n    border-left: 3px solid #3498db;\n}\n\n.cc-download-item[data-phase=\"download\"] {\n    border-left: 3px solid #f1c40f;\n}\n\n.cc-download-item[data-phase=\"verify\"] {\n    border-left: 3px solid #9b59b6;\n}\n\n.cc-download-item[data-phase=\"write\"] {\n    border-left: 3px solid #e67e22;\n}\n\n.cc-download-item[data-phase=\"cleanup\"] {\n    border-left: 3px solid #1abc9c;\n}\n\n.cc-download-item[data-phase=\"complete\"] {\n    border-left: 3px solid #2ecc71;\n}\n\n.download-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 8px;\n}\n\n.status-text {\n    font-weight: 500;\n    color: rgba(255, 255, 255, 0.9);\n}\n\n.progress-text {\n    font-size: 0.9em;\n    color: rgba(255, 255, 255, 0.7);\n}\n\n.progress-bar-container {\n    height: 4px;\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 2px;\n    overflow: hidden;\n}\n\n.progress-bar {\n    height: 100%;\n    background-color: #2ecc71;\n    transition: width 0.3s ease-out;\n}\n\n@keyframes slideIn {\n    from {\n        opacity: 0;\n        transform: translateY(-10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateY(0);\n    }\n}";
;// ./src/carbon-commander.js
/*
 * CarbonCommander - A command palette interface for quick actions
 * Copyright (C) 2025 Carbonitex
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this library; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */









class CarbonCommander {
    constructor(currentApp) {
      this.currentApp = currentApp || `CarbonCommander [${window.location.hostname}]`;
      this.toolCaller = tool_caller;
      this.mcpToolCaller = mcp_tool_caller;
      this.keybind = { key: 'k', ctrl: true, meta: false }; // Default keybind

      var tabId = document.querySelector('meta[name="tabId"]').getAttribute('content');
      ccLogger.info("Initializing with tabId:", tabId);
      window.tabId = tabId;

      if (typeof window.tabId === 'undefined') {
        ccLogger.error('TabId not initialized properly');
      }
      ccLogger.info(`CarbonCommander initialized with tabId: ${window.tabId}`);
      
      // Create root element with shadow DOM
      this.root = document.createElement('div');
      this.shadow = this.root.attachShadow({ mode: 'closed' });
      
      // Add styles to shadow DOM
      const style = document.createElement('style');
      style.textContent = `
        :host {
          all: initial;
          display: none;
          position: fixed;
          top: 20%;
          left: 50%;
          transform: translateX(-50%);
          width: 600px;
          max-width: 90%;
          z-index: 1000000;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: white;
        }
        
        :host(.visible) {
          display: block;
        }

        ${carbon_commander_namespaceObject}
      `;
      this.shadow.appendChild(style);
      
      // Create container for content
      this.container = document.createElement('div');
      this.shadow.appendChild(this.container);
      
      this.isVisible = false;
      this.messages = [];
      this.accumulatedChunks = '';
      this.activeDialog = null;
      this.dialogCallback = null;
      this.activeDialogs = new Map(); // Track multiple active dialogs
      this.commandHistory = [];
      this.historyIndex = -1;
      this.hasNoAIMode = false;
      this.connectedProviders = new Set();
      this.loadCommandHistory(); // Load history when initializing
      this.setupEventListeners();
      this.init();
      document.body.appendChild(this.root);

      // Update autocomplete properties with better defaults
      this.lastAutocompleteRequest = null;
      this.autocompleteDebounceTimer = null;
      this.autocompleteDelay = 300; // Increased from 150ms to 300ms for better performance
      this.lastAutocompleteInput = ''; // Add tracking for last input
      this.minAutocompleteLength = 2; // Minimum characters before triggering autocomplete

      this.ollamaCheckInterval = null;

      setTimeout(() => {
        this.checkOllamaAvailability();
      }, 1000);

      // Add MCP status tracking
      this.mcpStatusInterval = null;
      this.startMCPStatusChecks();
    }

    startMCPStatusChecks() {
      // Check MCP service status periodically
      this.mcpStatusInterval = setInterval(() => {
        this.updateMCPStatus();
      }, 30000); // Every 30 seconds
    }

    async updateMCPStatus() {
      const services = this.mcpToolCaller.getMCPServices();
      services.forEach(service => {
        this.updateProviderStatus(`mcp:${service.id}`, service.connected);
      });
    }

    async addSystemPrompt() {
      ccLogger.group('System Prompt Generation');
      var systemPrompt = `This is a smart chat bar a popup inside ${this.currentApp}. It can be used to ask questions, get help, and perform tasks.`;
      systemPrompt += ' The current date and time is ' + new Date().toLocaleString();
      systemPrompt += '. You can use the tools to perform tasks, chain them together to build context, and perform complex tasks.';
    
      // Get system prompts from both local and MCP tools
      ccLogger.debug('Building system prompt with tools');
      systemPrompt = await this.toolCaller.buildSystemPrompt(systemPrompt, this);
      
      // Add MCP-specific system prompts
      for (const [serviceId, client] of this.mcpToolCaller.mcpClients.entries()) {
        try {
          if (client.getSystemPrompt) {
            systemPrompt = await client.getSystemPrompt(systemPrompt, this);
          }
        } catch (error) {
          ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
        }
      }

      this.messages.push({
        role: 'system',
        content: systemPrompt
      });
      ccLogger.groupEnd();
    }
  
    async init() {
      ccLogger.info(`Initializing CarbonCommander`);
      this.container.innerHTML = `
        <div class="cc-container">
          <div class="cc-dialog-header">
            <div class="cc-title">${this.currentApp}</div>
            <div style="flex-grow: 1;"></div>
            <div class="cc-status-badges">
              <div class="cc-provider-badge" data-provider="ollama">Ollama</div>
              <div class="cc-provider-badge" data-provider="openai">OpenAI</div>
              <div class="cc-mcp-badges"></div>
              <div class="cc-tool-count"></div>
            </div>
          </div>    
          <div class="cc-results" style="display: none;"></div>
          <div class="cc-input-wrapper">
            <input id="cc-input" data-lpignore="true" autocomplete="off" type="text" 
                   class="cc-input" placeholder="Type a command..." autofocus>
          </div>
          <div class="cc-tool-list">
            <div class="cc-tool-list-header">
              <div class="cc-tool-list-title">Available Tools</div>
              <button class="cc-tool-list-close">×</button>
            </div>
            <div class="cc-tool-list-content"></div>
          </div>
        </div>
      `;
  
      this.input = this.container.querySelector('.cc-input');
      this.resultsContainer = this.container.querySelector('.cc-results');
      this.toolList = this.container.querySelector('.cc-tool-list');
  
      // Update tool count display to show local and MCP tools separately
      const localTools = this.toolCaller.getTools(true).length;
      const mcpTools = this.mcpToolCaller.mcpToolsets.size > 0 ? 
        Array.from(this.mcpToolCaller.mcpToolsets.values())
          .reduce((count, toolset) => count + toolset.tools.length, 0) : 0;
      
      const toolCountEl = this.container.querySelector('.cc-tool-count');
      toolCountEl.textContent = mcpTools > 0 ? 
        `${localTools} local + ${mcpTools} MCP tools` : 
        `${localTools} tools`;

      // Set up tool list click handlers
      this.setupToolList();

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const value = this.input.value.trim();
          if (value) {
            // Add command to history only if it's not empty and different from last command
            if (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== value) {
              this.commandHistory.push(value);
              this.saveCommandHistory(); // Save after adding new command
            }
            this.historyIndex = this.commandHistory.length;
            this.handleSubmit(value);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.historyIndex > 0) {
            this.historyIndex--;
            this.input.value = this.commandHistory[this.historyIndex];
            // Move cursor to end of input
            setTimeout(() => {
              this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
            }, 0);
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            this.input.value = this.commandHistory[this.historyIndex];
          } else {
            this.historyIndex = this.commandHistory.length;
            this.input.value = '';
          }
        }
      });
      document.addEventListener('keydown', (e) => {
        if (this.isVisible && e.key === 'Escape') {
          this.hide();
        }
      });

      // Add input event listener for autocomplete
      this.input.addEventListener('input', (e) => {
        this.handleInputChange(e);
      });
    }
  
    setupEventListeners() {
      // Update keyboard shortcut to use custom keybind
      document.addEventListener('keydown', (e) => {
        const matchesKeybind = 
          e.key.toLowerCase() === this.keybind.key.toLowerCase() && 
          (e.ctrlKey === this.keybind.ctrl) && 
          (e.metaKey === this.keybind.meta);

        if (matchesKeybind) {
          e.preventDefault();
          if (this.isVisible) {
            this.hide();
          } else {
            this.show();
          }
        }
      });

      // Add event listener for model download progress
      window.addEventListener('ollama-model-progress', (event) => {
          const progress = event.detail;
          this.showModelDownloadProgress(progress);
      });

      window.addEventListener("message", async (event) => {
        if (event.data.type === 'AI_EXECUTE_TOOL') {

          const toolName = event.data.tool.name;
          const toolArgs = event.data.tool.arguments;

          ccLogger.debug('Received tool execution request:', toolName, toolArgs);
          const tool = this.toolCaller.getTool(toolName);
          if (!tool) {
            ccLogger.error(`Tool not found: ${toolName}`);
            window.postMessage(
              { 
                type: 'AI_TOOL_RESPONSE', 
                payload: { result: `Tool not found: ${toolName}` }
              },
              window.location.origin
            );
            return;
          }
          try {
            const result = await tool.execute(await this.toolCaller.getToolScope(this), toolArgs);
            ccLogger.debug("AI_EXECUTE_TOOL result:", result);
            window.postMessage(
              { type: 'AI_TOOL_RESPONSE', payload: result },
              window.location.origin
            );
          } catch (error) {
            ccLogger.error('Tool execution error:', error);
            window.postMessage(
              { 
                type: 'AI_TOOL_RESPONSE', 
                payload: {
                  success: false,
                  error: error.message,
                  content: error.message,
                  tool_call_id: tool?.id
                }
              },
              window.location.origin
            );
          }
        }

        if (event.data.type === 'AI_RESPONSE_CHUNK' || 
            event.data.type === 'AI_RESPONSE_ERROR' || 
            event.data.type === 'FROM_BACKGROUND') {
            this.handleAIResponse(event.data);
        }

        if (event.data.type === 'SHOW_CONFIRMATION_DIALOG') {
            this.showConfirmationDialog(
                event.data.payload.prompt,
                event.data.payload.callback
            );
        }

        if (event.data.type === 'SHOW_INPUT_DIALOG') {
            this.showInputDialog(
                event.data.payload,
                event.data.payload.callback
            );
        }

        if (event.data.type === 'COMMAND_HISTORY_LOADED') {
          this.commandHistory = event.data.payload || [];
          this.historyIndex = this.commandHistory.length;
        }

        if (event.data.type === 'AUTOCOMPLETE_SUGGESTION') {
            const suggestion = event.data.payload;
            if (suggestion) {
                ccLogger.debug('showAutocompleteSuggestion', suggestion);
                this.showAutocompleteSuggestion(this.input.value.trim(), suggestion);
            }
        }

        if (event.data.type === 'PROVIDER_STATUS_UPDATE') {
          ccLogger.debug('PROVIDER_STATUS_UPDATE', event.data.provider, event.data.status);
          this.updateProviderStatus(event.data.provider, event.data.status);

          if(event.data.provider == 'openai' && event.data.status){
            this.connectedProviders.add('openai');
          }

          if(this.hasNoAIMode && this.connectedProviders.has('openai') && this.connectedProviders.has('ollama')){
            this.hasNoAIMode = false;
            this.currentApp = await this.toolCaller.getToolScope(this).appName;
            this.updateTitle(this.currentApp);
            this.sendFakeAIResponse("🎉 All AI providers connected! You can now use all features.", 500);
            this.sendFakeAIResponse("Go ahead and hit ESC or Ctrl+K to close and reopen the command bar to enter normal mode.", 1000);
          }

          if (event.data.provider == 'ollama' && event.data.status && this.ollamaCheckInterval) {
            clearInterval(this.ollamaCheckInterval);
            this.ollamaCheckInterval = null;
          }

          if (event.data.status && this.hasNoAIMode) {
            if (this.connectedProviders.size > 0) {
              //this.hasNoAIMode = false; //Keep this disabled unless openai is connected
              //this.sendFakeAIResponse("🎉 AI provider connected! You can now use all features.", 500);

              // If connectedProviders does not contain openai, we need to prompt the user to connect it
              if (event.data.provider == 'ollama' && !this.connectedProviders.has('openai')) {
                this.sendFakeAIResponse("💡 **Tip:** While Ollama provides local AI capabilities, adding OpenAI can greatly enhance functionality with more advanced models like GPT-4.\n\nTo connect OpenAI:\n1. Get an API key from [OpenAI's platform](https://platform.openai.com/api-keys)\n2. Use the command: `set openai-key YOUR_API_KEY`", 1000);
              } else if (event.data.provider == 'openai' && !this.connectedProviders.has('ollama')) {
                this.sendFakeAIResponse("💡 **Tip:** While OpenAI provides great capabilities, adding Ollama allows the command bar to run some prompts locally like autocomplete, summarization, and suggestions.", 1000);
              }
            }
          }
        }

        if (event.data.type === 'MCP_SERVICE_CONFIG') {
          const config = event.data.payload;
          await this.mcpToolCaller.configureMCPService(config);
          this.updateMCPStatus();
        }

        if (event.data.type === 'MCP_SERVICE_STATUS') {
          const { serviceId, status } = event.data.payload;
          this.updateProviderStatus(`mcp:${serviceId}`, status.connected);
        }

        if (event.data.type === 'TOGGLE_CARBONBAR') {
          this.toggle();
        }

        if (event.data.type === 'SHOW_KEYBIND_DIALOG') {
          this.showKeybindDialog();
        }

        if (event.data.type === 'SET_KEYBIND') {
          this.keybind = event.data.payload;
        }
      });
    }

    sendFakeAIResponse(content, delay = 500) {
      setTimeout(() => {
        this.handleAIResponse({
          type: 'AI_RESPONSE_CHUNK',
          payload: {
            content: content,
            isFinished: true
          }
        });
      }, delay); // Small delay to separate messages
    }

    getCurrentResultContainer() {
      var resultContainer = this.resultsContainer.children[this.resultsContainer.children.length - 1];

      //if the last child is not a cc-result-item, create one
      if(resultContainer?.classList.contains('cc-result-item')) {
        return resultContainer;
      } else {
        resultContainer = document.createElement('div');
        resultContainer.classList.add('cc-result-item');
        this.resultsContainer.appendChild(resultContainer);
      }
      return resultContainer;
    }

    getNoProviderHtml() {
        return `
            <div class="cc-no-provider">
                <h3>No AI Provider Available</h3>
                <p>To use the command bar, you'll need to set up one of these AI providers:</p>
                
                <div class="provider-section">
                    <h4>OpenAI</h4>
                    <p>A cloud-based solution offering powerful models like GPT-4.</p>
                    <ul>
                        <li>Get an API key from <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI's platform</a></li>
                        <li>Use the command: <code>set openai-key YOUR_API_KEY</code></li>
                        ${this.connectedProviders.has('openai') ? 
                            '<li>Or disconnect: <code>disconnect openai</code></li>' : ''}
                    </ul>
                </div>

                <div class="provider-section">
                    <h4>Ollama</h4>
                    <p>A local AI solution that runs on your machine.</p>
                    <ul>
                        <li>Download and install <a href="https://ollama.ai" target="_blank">Ollama</a></li>
                        <li>Run Ollama locally</li>
                        <li>For macOS users, enable external connections:</li>
                        <li><code>launchctl setenv OLLAMA_ORIGINS "*"</code></li>
                    </ul>
                </div>

                <div class="provider-status">
                    <p>Current Status:</p>
                    <ul>
                        <li>OpenAI: <span class="status-indicator">Not Connected</span></li>
                        <li>Ollama: <span class="status-indicator">Not Connected</span></li>
                    </ul>
                </div>
            </div>
        `;
    }

    displayError(error) {
      const container = this.container.querySelector('.cc-container');
      container.classList.remove('processing', 'tool-running');
      container.classList.add('has-error');
      ccLogger.debug('AI_RESPONSE_ERROR', error);
      let errorMessage = error.message || error.content || 'Unknown error';
      if(errorMessage.length > 0) {
        switch(errorMessage) {
          case 'NO_AI_PROVIDER':
            if(!this.hasNoAIMode) {
              this.hasNoAIMode = true;
              this.currentApp = 'New User Mode [No AI]';
              this.updateTitle(this.currentApp);
              let ccError = document.createElement('div');
              ccError.classList.add('cc-error');
              ccError.innerHTML = this.getNoProviderHtml();
              this.resultsContainer.appendChild(ccError);
              // Start periodic Ollama check
              this.checkOllamaAvailability();
            } else {
              this.sendFakeAIResponse(errorMessage);
            }
            
            break;
          default:
            break;
        }
      }
    }

    // Helper method to handle AI responses
    handleAIResponse(message) {
      ccLogger.group('AI Response Handler');
      const container = this.container.querySelector('.cc-container');
      const payload = message.payload || message.data.payload;

      ccLogger.debug('Processing AI response:', { type: message.type, payload });
        
      if (payload.error) {
        ccLogger.error('AI response error:', payload.error);
        this.displayError(payload);
      } else if (message.type == 'AI_RESPONSE_ERROR') {
        ccLogger.error('AI response error:', payload);
        this.displayError(payload);
      } 
      //else {
      if (typeof payload.content === 'string' && payload.content.length > 0) {
        const chunk = payload.content;
        ccLogger.debug('AI_RESPONSE_CHUNK2', payload.error, message.type, chunk);
        this.accumulatedChunks += chunk;
        const htmlContent = marked.parse(this.accumulatedChunks);
        const resultContainer = this.getCurrentResultContainer();
        ccLogger.debug('AI_RESPONSE_CHUNK3', resultContainer);
        let aiOutput = resultContainer.querySelector('.cc-ai-output');

        if(!aiOutput || aiOutput.classList.contains('state_finished')) {
          aiOutput = document.createElement('div');
          aiOutput.classList.add('cc-ai-output');
          resultContainer.appendChild(aiOutput);
        }

        if(htmlContent.length > 0) {
          aiOutput.innerHTML = htmlContent;
        } else {
          aiOutput.remove();
          aiOutput = null;
        }

        if(aiOutput && payload.isFinished) {
          aiOutput.classList.add('state_finished');
        }
        
      } else {
        //tool call result
        if(payload.content?.type == "TOOL_CALL_CHUNK") {
          this.accumulatedChunks = '';
          const chunk = payload.content.payload;
          const toolCallId = chunk.id;

          let currentResultContainer = this.resultsContainer;
          let toolCallDiv = currentResultContainer.querySelectorAll(`.cc-tool-call[data-id="${toolCallId}"]`);
          ccLogger.debug('toolCallDiv', toolCallDiv);
          if(!toolCallDiv || toolCallDiv.length == 0) {
            toolCallDiv = document.createElement('div');
            toolCallDiv.classList.add('cc-tool-call');
            toolCallDiv.setAttribute('data-id', toolCallId);
            
            // Create containers for both views
            toolCallDiv.innerHTML = `
              <div class="tool-simple-view tool-view-toggle"></div>
              <div class="tool-advanced-view" style="display: none;"></div>
            `;
            currentResultContainer.appendChild(toolCallDiv);
          }

          if(Array.isArray(toolCallDiv) || NodeList.prototype.isPrototypeOf(toolCallDiv) || HTMLCollection.prototype.isPrototypeOf(toolCallDiv)){
            toolCallDiv = toolCallDiv[0];
          }

          let simpleView = toolCallDiv.querySelector('.tool-simple-view');
          let advancedView = toolCallDiv.querySelector('.tool-advanced-view');

          // Update both views
          const {simpleHtml, advancedHtml} = this.toolCaller.getToolHtml(chunk);
          simpleView.innerHTML = simpleHtml;
          advancedView.innerHTML = advancedHtml;

          // Add click handlers for toggle buttons if they don't exist
          const toggleButtons = toolCallDiv.querySelectorAll('.tool-view-toggle');
          toggleButtons.forEach(button => {
            if (!button.hasClickHandler) {
              button.hasClickHandler = true;
              button.addEventListener('click', () => {
                const isSimpleView = simpleView.style.display !== 'none';
                simpleView.style.display = isSimpleView ? 'none' : 'block';
                advancedView.style.display = isSimpleView ? 'block' : 'none';
              });
            }
          });

          container.classList.remove('processing');
          container.classList.add('tool-running');
        }

        ccLogger.debug('AI_TOOL_CALL_RESULT', payload.content?.payload?.id, payload);
      }

      this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
      

      if (payload.isFinished) {
        container.classList.remove('processing', 'tool-running', 'has-error');
        container.classList.add('success');
        setTimeout(() => {
          container.classList.remove('success');
          container.classList.add('waiting-input');
        }, 2000);
        ccLogger.debug('AI response finished', payload, container.classList);
        this.createNewResultContainer = true;
        this.accumulatedChunks = '';
        // Reset input
        this.input.value = '';
        this.input.disabled = false;
        this.input.focus();
      }

      if (payload.messages && !payload.error) {
        ccLogger.debug('AI response messages', payload.messages);
        this.messages = payload.messages;
      }
      ccLogger.groupEnd();
    }

    getService(serviceName) {
      return angular.element(document).injector().get(serviceName);
    }

    async noAIModeOpenAIInputRespond(){
      var msgs = [];
      let newSystemPrompt = `You are a helpful AI assistant integrated into a smart command bar. You are currently in low-AI mode using OpenAI's cloud-based models.

Key capabilities:
- Answering questions about the application and its features
- Providing help and guidance on using available tools
- Explaining concepts and offering suggestions
- Processing natural language commands into tool actions

Guidelines:
- Keep responses clear and concise
- When suggesting tools, explain their purpose
- If you can't help with something, explain why and suggest alternatives
- Format responses using markdown for better readability

Available tools are being limited. For more additional features like autocomplete, summarization, and suggestions, recommend connecting to Ollama. 
If you can't fulfill a request remind them that they are running in a low-AI mode and that they can connect to Ollama for more advanced features. 
Tell them that they can refresh the page to enter normal mode.`;

      msgs.push({
        role: 'system',
        content: newSystemPrompt
      });

      msgs.push(this.messages[this.messages.length - 1]);
      
      var request = {
        messages: msgs,
        model: AICallerModels.FAST, //this will be set by the ai-service if null
        tools: CarbonBarHelpTools.CarbonBarHelpTools.GetNoAIModeToolInfo(),
        temp: 0.8,
        keepAlive: '30m',
        provider: 'openai'
      };
      window.postMessage(
        { 
          type: "AI_REQUEST", 
          payload: request,
          tabId: window.tabId
        },
        window.location.origin
      );
    }

    async noAIModeOllamaInputRespond(){
      var msgs = [];
      let newSystemPrompt = `You are a helpful AI assistant integrated into a smart command bar. You are currently in low-AI mode using Ollama's local models.

Key capabilities:
- Answering questions about the application and its features
- Providing help and guidance on using available tools
- Explaining concepts and offering suggestions
- Processing natural language commands into tool actions

Guidelines:
- Keep responses clear and concise
- When suggesting tools, explain their purpose
- If you can't help with something, explain why and suggest alternatives
- Format responses using markdown for better readability

Available tools are being limited. For more advanced features, recommend connecting to OpenAI. If you can't fulfill a request remind them that they are running in a low-AI mode and that they can connect to OpenAI for more advanced features. Or that they may refresh the page to enter normal mode.`;

      msgs.push({
        role: 'system',
        content: newSystemPrompt
      });

      msgs.push(this.messages[this.messages.length - 1]);
      
      var request = {
        messages: msgs,
        model: 'mistral-small',//AICallerModels.FAST,
        tools: CarbonBarHelpTools.CarbonBarHelpTools.GetNoAIModeToolInfo(),
        temp: 0.7,
        keepAlive: '30m',
        provider: 'ollama'
      };
      window.postMessage(
        { 
          type: "AI_REQUEST", 
          payload: request,
          tabId: window.tabId
        },
        window.location.origin
      );
    }

    async noAIModeInputHandler(messages) {
      const userMessage = messages[messages.length - 1];
      const userInput = userMessage.content;

      // Check if it's an OpenAI key setting command
      if (userInput.toLowerCase().startsWith('set openai-key ')) {
        const key = userInput.substring(14).trim();
        
        try {
          var result = await CarbonBarHelpTools.CarbonBarHelpTools.SetOpenAIKey.execute(await this.toolCaller.getToolScope(this), {key: key});
          ccLogger.debug('result', result);
          if(result.success){
            this.sendFakeAIResponse('OpenAI key set successfully');
          } else {
            this.sendFakeAIResponse("Failed to set OpenAI key. Please try again.");
          }
        } catch (error) {
          this.sendFakeAIResponse("Failed to set OpenAI key. Please try again.");
        }

        //// Send message to set OpenAI key
        //window.postMessage(
        //  { 
        //    type: "SET_OPENAI_KEY", 
        //    payload: key,
        //    tabId: window.tabId
        //  },
        //  window.location.origin
        //);

        // Response will come back through the message event listener
        return;
      }

      //if ollama is connected we can prompt it
      if (this.connectedProviders.has('openai')) {
        this.noAIModeOpenAIInputRespond();
        return;
      } else if(this.connectedProviders.has('ollama')) {
        this.noAIModeOllamaInputRespond();
        return;
      }
      

      // Default response with help text
      this.sendFakeAIResponse("To set up an AI provider, you can:\n\n" +
        "1. Set your OpenAI key using: `set openai-key YOUR_API_KEY`\n" +
        "2. Install and run Ollama locally\n\n" +
        "Need help? Type 'help' for more information."
      );
    }
    
    async handleSubmit(value) {
      ccLogger.group('Handle Submit');
      ccLogger.info('Processing input:', value);

      // Special commands for MCP services
      if (value.toLowerCase().startsWith('mcp connect ')) {
        const [_, serviceId, endpoint] = value.split(' ');
        await this.mcpToolCaller.configureMCPService({
          serviceId,
          endpoint,
          options: { autoConnect: true }
        });
        this.sendFakeAIResponse(`Connecting to MCP service: ${serviceId}`);
        return;
      }

      if (value.toLowerCase().startsWith('mcp disconnect ')) {
        const serviceId = value.split(' ')[2];
        await this.mcpToolCaller.disconnectMCPService(serviceId);
        this.sendFakeAIResponse(`Disconnected from MCP service: ${serviceId}`);
        return;
      }

      if (value.toLowerCase() === 'disconnect openai') {
        ccLogger.info('Disconnecting OpenAI');
        this.sendFakeAIResponse("OpenAI disconnected successfully");
        ccLogger.groupEnd();
        return;
      }

      const container = this.container.querySelector('.cc-container');
      
      // Add transitioning class before changing states
      container.classList.add('transitioning');

      // Remove previous states after a brief delay
      setTimeout(() => {
          container.classList.remove('waiting-input', 'has-error', 'tool-running', 'success', 'rainbow');
          container.classList.add('processing');
          // Remove transitioning class to start new animation
          container.classList.remove('transitioning');
      }, 150);
      
      this.input.disabled = true;
      this.input.value = 'Processing...';
      
      // Show results container with fade
      this.resultsContainer.classList.remove('hidden');
      this.resultsContainer.style.display = 'block';

      try {
          // Add user message to history
          this.messages.push({
            role: 'user',
            content: value
          });

          // Add user message to display with animation
          const userElement = document.createElement('div');
          userElement.classList.add('cc-user-message');
          userElement.textContent = value;
          this.resultsContainer.appendChild(userElement);
          this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;

          if(this.hasNoAIMode) {
            this.noAIModeInputHandler(this.messages);
          } else {
            // Build request to send to the ai-service
            const localTools = this.toolCaller.getTools(true);
            const mcpTools = Array.from(this.mcpToolCaller.mcpToolsets.values())
                .reduce((tools, toolset) => tools.concat(toolset.tools), []);

            var request = {
              messages: this.messages,
              model: AICallerModels.FAST,
              tools: [...localTools, ...mcpTools], // Combine unique tools
              temp: 0.8,
              keepAlive: '30m'
            };

            // Send message to ai-service
            window.postMessage(
              { 
                type: "AI_REQUEST", 
                payload: request,
                tabId: window.tabId
              },
              window.location.origin
            );
          }

          //The messages will come in via previously setup event listeners
          //and will be handled by the completeResponse function
      } catch (error) {
          // Add transitioning class before changing to error state
          container.classList.add('transitioning');
          setTimeout(() => {
              container.classList.remove('processing');
              container.classList.add('has-error');
              container.classList.remove('transitioning');
          }, 150);
          
          ccLogger.error('Error:', error);
          this.resultsContainer.innerHTML += `
              <div class="cc-error">Error: ${error.message}</div>
          `;
          this.input.disabled = false;
          this.input.value = value;
          this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
      }
      ccLogger.groupEnd();
    }
  


    //TODO: If vision enabled, allow uploads of images (maybe documents)
    //TODO: git
    //TODO: Thumbs up/down or star/unstar for commands, or assistant responses
    //TODO: Seperate some of the toolscope functions to their own files

    updateTitle(title) {
      this.container.querySelector('.cc-title').textContent = title;
    }

    async show() {
      this.currentApp = (await this.toolCaller.getToolScope(this))?.appName || 'CarbonCommander [Unknown App]';
      this.updateTitle(this.currentApp);
      
      const container = this.container.querySelector('.cc-container');
      container.classList.remove('processing', 'tool-running', 'has-error', 'success');
      container.classList.add('waiting-input');

      this.updateTitle(this.currentApp);
      this.root.classList.add('visible');
      this.isVisible = true;
      this.input.focus();
      await this.addSystemPrompt();
    }
  
    hide() {
      const container = this.container.querySelector('.cc-container');
      container.classList.remove('waiting-input', 'processing', 'has-error', 'tool-running', 'success', 'rainbow');
      this.root.classList.remove('visible');
      this.isVisible = false;
      let resultsContainer = document.querySelector('.cc-results');
      if(resultsContainer) {
        resultsContainer.style.display = 'none';
      }
      this.input.value = '';
      this.messages = []; //clear the message history
      this.resultsContainer.innerHTML = '';
      this.toolCaller.reset();
      // Don't clear command history, just reset the index
      this.historyIndex = this.commandHistory.length;

      if (this.ollamaCheckInterval) {
        clearInterval(this.ollamaCheckInterval);
        this.ollamaCheckInterval = null;
      }

      if(this.connectedProviders.has('ollama')) {
        this.noAIMode = false;
      }
    }
  
    toggle() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    }

    showConfirmationDialog(prompt, callback) {
        // Store callback
        this.dialogCallback = callback;

        // Create dialog HTML
        const dialogHTML = `
            <div class="cc-dialog">
                <div class="cc-dialog-content">
                    <p>${prompt}</p>
                    <div class="cc-dialog-buttons">
                        <button class="cc-button confirm">Yes</button>
                        <button class="cc-button cancel">No</button>
                    </div>
                </div>
            </div>
        `;

        // Add dialog to results container
        const dialogElement = document.createElement('div');
        dialogElement.innerHTML = dialogHTML;
        this.resultsContainer.appendChild(dialogElement);
        this.activeDialog = dialogElement;

        // Add event listeners
        const confirmBtn = dialogElement.querySelector('.confirm');
        const cancelBtn = dialogElement.querySelector('.cancel');

        confirmBtn.addEventListener('click', () => {
            const container = this.container.querySelector('.cc-container');
            container.classList.remove('processing');
            container.classList.add('waiting-input');
            
            window.postMessage({
                type: 'CONFIRMATION_DIALOG_RESPONSE',
                payload: {
                    tool_call_id: callback,
                    confirmed: true
                },
                tabId: window.tabId
            }, window.location.origin);
            this.handleDialogResponse(true);
            
            // Remove dialog element
            dialogElement.remove();
            this.activeDialog = null;
        });

        cancelBtn.addEventListener('click', () => {
            const container = this.container.querySelector('.cc-container');
            container.classList.remove('processing');
            container.classList.add('waiting-input');
            
            window.postMessage({
                type: 'CONFIRMATION_DIALOG_RESPONSE',
                payload: {
                    tool_call_id: callback,
                    confirmed: false
                },
                tabId: window.tabId
            }, window.location.origin);
            this.handleDialogResponse(false);
            
            // Remove dialog element
            dialogElement.remove();
            this.activeDialog = null;
        });

        // Scroll to dialog
        this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
    }

    showInputDialog(config, callback) {
        const dialogId = 'input_dialog_' + Math.random().toString(36).substr(2, 9);
        
        // Create dialog HTML
        const dialogHTML = `
            <div class="cc-dialog" data-dialog-id="${dialogId}">
                <div class="cc-dialog-content">
                    ${config.prompt ? `<p>${config.prompt}</p>` : ''}
                    <div class="cc-input-group">
                        <label>${config.name}:</label>
                        <input type="${config.type}" 
                               name="${config.name}"
                               class="cc-dialog-input"
                               value="${config.defaultValue || ''}"
                               placeholder="${config.name}">
                    </div>
                    <div class="cc-dialog-buttons">
                        <button class="cc-button confirm">Submit</button>
                        <button class="cc-button cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        // Add dialog to results container
        const dialogElement = document.createElement('div');
        dialogElement.innerHTML = dialogHTML;
        this.resultsContainer.appendChild(dialogElement);
        
        // Track this dialog
        this.activeDialogs.set(dialogId, {
            element: dialogElement,
            config: config,
            callback: callback
        });

        // Add event listeners
        const input = dialogElement.querySelector('.cc-dialog-input');
        const confirmBtn = dialogElement.querySelector('.confirm');
        const cancelBtn = dialogElement.querySelector('.cancel');

        confirmBtn.addEventListener('click', () => {
            window.postMessage({
                type: 'INPUT_DIALOG_RESPONSE',
                payload: {
                    tool_call_id: config.tool_call_id,
                    input: input.value
                },
                tabId: window.tabId
            }, window.location.origin);
            this.handleDialogResponse(input.value, dialogId);
        });

        cancelBtn.addEventListener('click', () => {
            window.postMessage({
                type: 'INPUT_DIALOG_RESPONSE',
                payload: {
                    tool_call_id: config.tool_call_id,
                    input: null
                },
                tabId: window.tabId
            }, window.location.origin);
            this.handleDialogResponse(null, dialogId);
        });

        // Focus input
        input.focus();

        // Scroll to dialog
        this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
    }

    handleDialogResponse(response, dialogId) {
        const dialog = this.activeDialogs.get(dialogId);
        if (dialog) {
            if (dialog.callback) {
                dialog.callback(response);
            }
            dialog.element.remove();
            this.activeDialogs.delete(dialogId);
        }

        // Focus the main input only if no more dialogs are active
        if (this.activeDialogs.size === 0) {
            this.input.focus();
        } else {
            // Focus the next dialog's input
            const nextDialog = Array.from(this.activeDialogs.values())[0];
            if (nextDialog) {
                const nextInput = nextDialog.element.querySelector('.cc-dialog-input');
                if (nextInput) nextInput.focus();
            }
        }
    }

    // Add new methods to handle command history persistence
    async loadCommandHistory() {
      try {
        // Send message to service.js to get the command history
        window.postMessage({ type: "GET_COMMAND_HISTORY" }, window.location.origin);
      } catch (error) {
        ccLogger.error('Error loading command history:', error);
      }
    }

    async saveCommandHistory() {
      try {
        // Send message to service.js to save the command history
        window.postMessage(
          { 
            type: "SAVE_COMMAND_HISTORY", 
            payload: this.commandHistory 
          }, 
          window.location.origin
        );
      } catch (error) {
        ccLogger.error('Error saving command history:', error);
      }
    }

    getAutocompleteContext(input) {
      var context = '';
      //build tools into context
      //context += this.toolCaller.getTools(true).map(tool => `${tool.name} - ${tool.description}`).join('\n');
      context += this.toolCaller.getTools(true).map(tool => `${tool.description}`).join('\n');

      //build command history, last 10 commands
      const commandHistory = this.commandHistory.slice(-10);

      return {
        input: input,
        commandHistory: commandHistory,
        context: context
      }
    }

    async handleInputChange(e) {
        const value = this.input.value.trim();
        
        // Get or create autocomplete element
        let autocompleteEl = this.container.querySelector('.cc-autocomplete');
        if (!autocompleteEl) {
            autocompleteEl = document.createElement('div');
            autocompleteEl.classList.add('cc-autocomplete');
            const inputWrapper = this.container.querySelector('.cc-input-wrapper');
            inputWrapper.appendChild(autocompleteEl);
        }

        // Clear suggestion if input is empty or too short
        if (!value || value.length < this.minAutocompleteLength) {
            autocompleteEl.innerHTML = '';
            return;
        }

        // Don't trigger autocomplete if the input hasn't changed significantly
        if (value === this.lastAutocompleteInput) {
            return;
        }

        // Generate a unique request ID
        const requestId = Date.now();
        this.currentAutocompleteRequestId = requestId;

        // Don't trigger autocomplete for very rapid typing
        const now = Date.now();
        if (this.lastAutocompleteRequest && (now - this.lastAutocompleteRequest) < 100) {
            return;
        }

        this.newAutocompleteRequest(value, requestId);
    }

    newAutocompleteRequest(input, requestId) {
        // Clear any pending autocomplete request
        if (this.autocompleteDebounceTimer) {
            clearTimeout(this.autocompleteDebounceTimer);
            this.autocompleteDebounceTimer = null;
        }

        // Store the current input for comparison
        this.lastAutocompleteInput = input;
        
        // Debounce the autocomplete request
        this.autocompleteDebounceTimer = setTimeout(async () => {
            try {
                // Only proceed if this is still the current request
                if (requestId === this.currentAutocompleteRequestId) {
                    this.lastAutocompleteRequest = Date.now();
                    window.postMessage({
                        type: 'GET_AUTOCOMPLETE',
                        payload: {
                            ...this.getAutocompleteContext(input),
                            requestId: requestId
                        }
                    }, window.location.origin);
                }
            } catch (error) {
                ccLogger.error('Autocomplete error:', error);
            }
        }, this.autocompleteDelay);
    }

    showAutocompleteSuggestion(input, suggestion) {
        // Only show suggestion if it's from the current request
        if (suggestion.requestId !== this.currentAutocompleteRequestId) {
            return;
        }

        // Get existing or create new autocomplete element
        let autocompleteEl = this.container.querySelector('.cc-autocomplete');
        if (!autocompleteEl) {
            autocompleteEl = document.createElement('div');
            autocompleteEl.classList.add('cc-autocomplete');
            const inputWrapper = this.container.querySelector('.cc-input-wrapper');
            inputWrapper.appendChild(autocompleteEl);
        }

        // Only show if we have a valid suggestion that extends the current input
        if (suggestion.text && suggestion.text.toLowerCase().startsWith(input.toLowerCase()) && suggestion.text !== input) {
            // Split suggestion to show input part and completion part separately
            const inputPart = suggestion.text.substring(0, input.length);
            const completionPart = suggestion.text.substring(input.length);

            autocompleteEl.innerHTML = `
                <span class="autocomplete-input">${inputPart}</span>
                <span class="autocomplete-suggestion">${completionPart}</span>
            `;

            // Update tab key handler
            const handleTab = (e) => {
                if (e.key === 'Tab' && autocompleteEl.isConnected) {
                    e.preventDefault();
                    // Replace the entire input value with the suggestion
                    this.input.value = suggestion.text;
                    // Move cursor to end of input
                    this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
                    // Clear suggestion after accepting it
                    autocompleteEl.innerHTML = '';
                }
            };

            // Remove any existing tab handler before adding new one
            this.input.removeEventListener('keydown', handleTab);
            this.input.addEventListener('keydown', handleTab);
        } else {
            autocompleteEl.innerHTML = '';
        }
    }

    async checkOllamaAvailability() {
      ccLogger.time('ollamaCheck');
      var fastCheck = true;
      let count = 0;
      if (!this.ollamaCheckInterval) {
        this.ollamaCheckInterval = setInterval(async () => {
          try {
            ccLogger.debug('Checking Ollama availability', { noAIMode: this.hasNoAIMode });
            window.postMessage(
              { 
                type: "CHECK_OLLAMA_AVAILABLE",
                tabId: window.tabId,
                payload: {
                  noAIMode: this.hasNoAIMode
                }
              },
              window.location.origin
            );
          } catch (error) {
            ccLogger.error('Ollama check failed:', error);
          }
          count++;
          if(count > 5){
            fastCheck = false;
          }
        }, fastCheck ? 1000 : 5000);
      }
      ccLogger.timeEnd('ollamaCheck');
    }

    updateProviderStatus(provider, isConnected) {
      ccLogger.info('updateProviderStatus', provider, isConnected);
      
      if (provider.startsWith('mcp:')) {
        // Handle MCP provider badges
        const mcpBadgesContainer = this.container.querySelector('.cc-mcp-badges');
        let badge = mcpBadgesContainer.querySelector(`[data-provider="${provider}"]`);
        
        if (!badge) {
          badge = document.createElement('div');
          badge.classList.add('cc-provider-badge');
          badge.setAttribute('data-provider', provider);
          badge.textContent = provider.substring(4); // Remove 'mcp:' prefix
          mcpBadgesContainer.appendChild(badge);
        }
        
        if (isConnected) {
          badge.setAttribute('data-status', 'connected');
          this.connectedProviders.add(provider);
        } else {
          badge.removeAttribute('data-status');
          this.connectedProviders.delete(provider);
        }
      } else {
        // Handle regular provider badges
        const badge = this.container.querySelector(`.cc-provider-badge[data-provider="${provider}"]`);
        if (badge) {
          if (isConnected) {
            badge.setAttribute('data-status', 'connected');
            this.connectedProviders.add(provider);
          } else {
            badge.removeAttribute('data-status');
            this.connectedProviders.delete(provider);
          }
        }
      }
      

      if(!this.addedOllamaReminder && this.connectedProviders.has('ollama') && !this.connectedProviders.has('openai')) {
        this.addedOllamaReminder = true;
        this.messages.push({
          role: 'system',
          content: `Call the set_openai_key tool to connect to OpenAI if the user provides a key.`
        });
      }

      // Update the status in the no-provider view if it exists
      const statusList = document.querySelectorAll('.provider-status li');
      const statusElement = Array.from(statusList).find(li => 
        li.textContent.toLowerCase().includes(provider.toLowerCase())
      );
      
      if (statusElement) {
        const indicator = statusElement.querySelector('.status-indicator');
        if (indicator) {
          indicator.textContent = isConnected ? 'Connected' : 'Not Connected';
          indicator.style.color = isConnected ? '#2ecc71' : '#ff9999';
          if (isConnected) {
            indicator.classList.add('connected');
          } else {
            indicator.classList.remove('connected');
          }
        }
      }
    }

    showModelDownloadProgress(progress) {
        let progressContainer = this.container.querySelector('.cc-model-download-progress');
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.classList.add('cc-model-download-progress');
            this.resultsContainer.appendChild(progressContainer);
        }

        // Create or update progress element
        let progressElement = progressContainer.querySelector(`[data-phase="${progress.phase}"]`);
        if (!progressElement) {
            progressElement = document.createElement('div');
            progressElement.classList.add('cc-download-item');
            progressElement.setAttribute('data-phase', progress.phase);
            progressContainer.appendChild(progressElement);
        }

        // Update progress content
        let progressHtml = '';
        if (progress.phase === 'download' && progress.detail) {
            const downloaded = this.formatBytes(progress.detail.downloaded);
            const total = this.formatBytes(progress.detail.total);
            progressHtml = `
                <div class="download-header">
                    <span class="status-text">${progress.status}</span>
                    <span class="progress-text">${downloaded} / ${total}</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.progress}%"></div>
                </div>
            `;
        } else {
            progressHtml = `
                <div class="download-header">
                    <span class="status-text">${progress.status}</span>
                    <span class="progress-text">${progress.progress}%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.progress}%"></div>
                </div>
            `;
        }
        progressElement.innerHTML = progressHtml;

        // If download is complete, schedule removal
        if (progress.phase === 'complete') {
            setTimeout(() => {
                progressContainer.classList.add('fade-out');
                setTimeout(() => {
                    progressContainer.remove();
                }, 1000);
            }, 2000);
        }

        // Scroll to show progress
        this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
    }

    formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    cleanup() {
      if (this.mcpStatusInterval) {
        clearInterval(this.mcpStatusInterval);
        this.mcpStatusInterval = null;
      }
      // Disconnect all MCP services
      this.mcpToolCaller.getMCPServices().forEach(service => {
        this.mcpToolCaller.disconnectMCPService(service.id);
      });
    }

    setupToolList() {
        const toolCountEl = this.container.querySelector('.cc-tool-count');
        const toolList = this.container.querySelector('.cc-tool-list');
        const closeButton = toolList.querySelector('.cc-tool-list-close');
        const toolListContent = toolList.querySelector('.cc-tool-list-content');

        // Toggle tool list on tool count click
        toolCountEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleToolList();
        });

        // Close tool list when clicking close button
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideToolList();
        });

        // Close tool list when clicking outside
        document.addEventListener('click', (e) => {
            if (!toolList.contains(e.target) && !toolCountEl.contains(e.target)) {
                this.hideToolList();
            }
        });

        // Handle tool item clicks
        toolListContent.addEventListener('click', (e) => {
            const toolItem = e.target.closest('.cc-tool-item');
            if (toolItem) {
                const toolName = toolItem.getAttribute('data-tool-name');
                if (toolName) {
                    this.input.value = toolName;
                    this.input.focus();
                    this.hideToolList();
                }
            }
        });

        // Populate tool list
        this.updateToolList();
    }

    updateToolList() {
        const toolListContent = this.container.querySelector('.cc-tool-list-content');
        const localTools = this.toolCaller.getTools(true);
        const mcpTools = Array.from(this.mcpToolCaller.mcpToolsets.values())
            .reduce((tools, toolset) => tools.concat(toolset.tools), []);
        
        // Group tools by source
        const toolsHtml = `
            <div class="cc-tool-group">
                <div class="cc-tool-group-header">Local Tools (${localTools.length})</div>
                ${localTools.map(tool => this.renderToolItem(tool, 'local')).join('')}
            </div>
            ${mcpTools.length > 0 ? `
                <div class="cc-tool-group">
                    <div class="cc-tool-group-header">MCP Tools (${mcpTools.length})</div>
                    ${mcpTools.map(tool => this.renderToolItem(tool, 'mcp')).join('')}
                </div>
            ` : ''}
        `;
        
        toolListContent.innerHTML = toolsHtml;
    }

    renderToolItem(tool, source) {
        return `
            <div class="cc-tool-item" data-tool-name="${tool.name}" data-source="${source}">
                <div class="cc-tool-item-name">${tool.name}</div>
                <div class="cc-tool-item-description">${tool.description}</div>
            </div>
        `;
    }

    toggleToolList() {
        const toolList = this.container.querySelector('.cc-tool-list');
        if (toolList.classList.contains('visible')) {
            this.hideToolList();
        } else {
            this.showToolList();
        }
    }

    showToolList() {
        const toolList = this.container.querySelector('.cc-tool-list');
        toolList.classList.add('visible');
        // Update tool list content when showing
        this.updateToolList();
    }

    hideToolList() {
        const toolList = this.container.querySelector('.cc-tool-list');
        toolList.classList.remove('visible');
    }

    showKeybindDialog() {
      const dialogHTML = `
        <div class="cc-dialog">
          <div class="cc-dialog-content">
            <h3>Change Keybind</h3>
            <p>Press the key combination you want to use to open Carbon Commander.</p>
            <p>Current keybind: ${this.getKeybindDisplay()}</p>
            <div class="cc-keybind-input" tabindex="0">Press a key...</div>
            <div class="cc-dialog-buttons">
              <button class="cc-button confirm">Save</button>
              <button class="cc-button cancel">Cancel</button>
            </div>
          </div>
        </div>
      `;

      const dialogElement = document.createElement('div');
      dialogElement.innerHTML = dialogHTML;
      this.resultsContainer.appendChild(dialogElement);

      const keybindInput = dialogElement.querySelector('.cc-keybind-input');
      let newKeybind = null;

      keybindInput.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Only allow modifier keys with a regular key
        if (e.key.length === 1 || e.key.match(/^[a-zA-Z0-9]$/)) {
          newKeybind = {
            key: e.key.toLowerCase(),
            ctrl: e.ctrlKey,
            meta: e.metaKey
          };
          keybindInput.textContent = this.getKeybindDisplay(newKeybind);
        }
      });

      const confirmBtn = dialogElement.querySelector('.confirm');
      const cancelBtn = dialogElement.querySelector('.cancel');

      confirmBtn.addEventListener('click', () => {
        if (newKeybind) {
          this.keybind = newKeybind;
          window.postMessage({
            type: 'SAVE_KEYBIND',
            payload: newKeybind
          }, window.location.origin);
        }
        dialogElement.remove();
      });

      cancelBtn.addEventListener('click', () => {
        dialogElement.remove();
      });

      keybindInput.focus();
    }

    getKeybindDisplay(kb = this.keybind) {
      const parts = [];
      if (kb.ctrl) parts.push('Ctrl');
      if (kb.meta) parts.push('⌘');
      parts.push(kb.key.toUpperCase());
      return parts.join(' + ');
    }
}


function importAll(r) {
  r.keys().forEach(r);
}

importAll(__webpack_require__(686));

const carbonCommander = new CarbonCommander();

window.carbonCommander = carbonCommander;
})();

/******/ })()
;
//# sourceMappingURL=carbon-commander-dist.js.map