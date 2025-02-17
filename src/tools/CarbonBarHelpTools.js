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
            CarbonBarHelpTools.ListGuides.function,
            CarbonBarHelpTools.ListSiteTools.function
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
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
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
                    type: 'CARBON_SET_OPENAI_KEY',
                    payload: {
                        key: key,
                        save: true
                    }
                }, window.location.origin);

                const listener = (event) => {   
                    if (event.data.type === 'CARBON_SET_OPENAI_KEY_RESPONSE') {
                        const payload = event.data.payload?.payload || event.data.payload;
                        scope.logMessage('CARBON_SET_OPENAI_KEY_RESPONSE', event.data, payload);
                        if(payload.success === true){
                            window.postMessage({
                                type: 'PROVIDER_STATUS_UPDATE',
                                provider: 'openai',
                                status: true
                            }, window.location.origin);
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

    static ListSiteTools = {
        function: {
            name: 'list_site_tools',
            description: 'List all available site-specific tools and their descriptions',
            parameters: {
                properties: {
                    site: {
                        type: 'string',
                        description: 'Optional site name to filter tools (e.g., amazon, linkedin, bitbucket, stackoverflow, etc.)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { site } = args;
            const siteToolsMap = {
                'amazon': { class: 'AmazonTools', description: 'Tools for Amazon.com shopping and product research' },
                'linkedin': { class: 'LinkedInTools', description: 'Tools for LinkedIn profile and job search' },
                'bitbucket': { class: 'BitbucketTools', description: 'Tools for Bitbucket repository management' },
                'hackernews': { class: 'HackerNewsTools', description: 'Tools for browsing and interacting with Hacker News' },
                'smartertrack': { class: 'SmarterTrackPortalTools', description: 'Tools for SmarterTrack customer portal' },
                'stackoverflow': { class: 'StackOverflowTools', description: 'Tools for Stack Overflow Q&A interaction' },
                'twitch': { class: 'TwitchTools', description: 'Tools for Twitch streaming platform' },
                'smartermail': { class: 'SmarterMailTools', description: 'Tools for SmarterMail email system' }
            };

            // Helper function to get tools for a specific toolset
            const getToolsForClass = (className) => {
                if (!window.sbaiTools || !window.sbaiTools[className]) {
                    return [];
                }
                const toolSet = window.sbaiTools[className];
                return Object.getOwnPropertyNames(toolSet)
                    .filter(prop => typeof toolSet[prop] === 'object' && toolSet[prop]?.function)
                    .map(prop => ({
                        name: toolSet[prop].function.name,
                        description: toolSet[prop].function.description
                    }));
            };

            if (site) {
                const siteKey = site.toLowerCase();
                const siteInfo = siteToolsMap[siteKey];
                if (siteInfo) {
                    const tools = getToolsForClass(siteInfo.class);
                    let result = `# ${site} Tools\n\n${siteInfo.description}\n\n`;
                    
                    if (tools.length > 0) {
                        result += '## Available Tools\n\n';
                        tools.forEach(tool => {
                            result += `### \`${tool.name}\`\n${tool.description || 'No description available.'}\n\n`;
                        });
                    } else {
                        result += '> Note: Tools will be available when visiting the corresponding website.\n';
                    }
                    
                    result += '\nTo use these tools, visit the corresponding website and use Carbon Commander (Ctrl/⌘ + K).';
                    return { success: true, result };
                }
                return {
                    success: false,
                    result: `No tools found for '${site}'. Available sites: ${Object.keys(siteToolsMap).join(', ')}`
                };
            }

            let result = '# Available Site-Specific Tools\n\n';
            for (const [site, info] of Object.entries(siteToolsMap)) {
                result += `## ${site.charAt(0).toUpperCase() + site.slice(1)}\n${info.description}\n\n`;
                const tools = getToolsForClass(info.class);
                if (tools.length > 0) {
                    result += '### Available Tools\n';
                    tools.forEach(tool => {
                        result += `- \`${tool.name}\`: ${tool.description || 'No description available.'}\n`;
                    });
                    result += '\n';
                } else {
                    result += '> Note: Tools will be available when visiting the corresponding website.\n\n';
                }
            }
            
            result += '\nTo use site-specific tools:\n';
            result += '1. Visit the corresponding website\n';
            result += '2. Open Carbon Commander (Ctrl/⌘ + K)\n';
            result += '3. Click the ⚡ icon or type your command\n\n';
            result += 'For specific site tools, use: `list_site_tools [site]`';

            return { success: true, result };
        }
    };
}

(window.sbaiTools ??= {}).CarbonBarHelpTools = CarbonBarHelpTools;

export { CarbonBarHelpTools };