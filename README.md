# Carbon Commander

A powerful command palette interface for Chrome with AI-powered tools and extensible architecture. 

## Features

- AI-powered command palette with support for multiple LLM providers (OpenAI, Ollama)
- Extensive external service integrations (Hacker News, Bitbucket, RocketChat, and more)
- Manual tool execution through chat interface
- Customizable keyboard shortcuts with UI configuration
- Drag-and-drop tool list and command palette positioning
- Settings menu for system customization
- API key and configuration management
- Extensible tool system for adding custom functionality
- Local AI capabilities through Ollama integration
- Real-time streaming responses and tool execution
- Command history and autocomplete powered by Ollama
- Comprehensive help system and guides
- Smart context-aware suggestions
- Tool discovery and management
- MCP (Model Context Protocol) integration

## Installation

1. Clone this repository
2. Run `npm install`
3. Build the extension: `npm run build`
4. Load the unpacked extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select the `dist` directory

## Usage

### Opening Carbon Commander

There are three ways to open Carbon Commander:

1. **Keyboard Shortcut**: By default, press `Ctrl + K` (Windows/Linux) or `⌘ + K` (Mac)
2. **Extension Icon**: Click the Carbon Commander icon in your Chrome toolbar
3. **Context Menu**: Right-click anywhere on a page and select "Carbon Commander"

### Customizing the Keyboard Shortcut

You can change the default keyboard shortcut in three ways:

1. **Through the Extension UI**:
   - Click the Carbon Commander icon in your toolbar
   - Select "Change Keybind" from the menu
   - Press your desired key combination
   - Click "Save" to apply the new shortcut

2. **Using Commands**:
   - Open Carbon Commander
   - Type `change-keybind`
   - Press your desired key combination
   - Click "Save" to apply

3. **Through Chrome Settings**:
   - Navigate to `chrome://extensions/shortcuts`
   - Find "Carbon Commander"
   - Click the pencil icon next to the current shortcut
   - Press your desired key combination
   - Click "OK" to save

### Basic Commands

- Type your query or command in the input field
- Use arrow keys (↑/↓) to navigate command history
- Press Tab to accept autocomplete suggestions
- Press Esc to close the command palette

### Help and Documentation

Carbon Commander includes a comprehensive help system. Try these commands:

1. **General Help**:
   - Type `get_usage_guide general` for quick start guide
   - Shows key features and basic usage

2. **Keyboard Shortcuts**:
   - Type `get_usage_guide keybinds` for keyboard shortcuts
   - Learn about customizing shortcuts and navigation

3. **Available Commands**:
   - Type `get_usage_guide commands` for command list
   - See all available commands and their usage

4. **Tools Guide**:
   - Type `get_usage_guide tools` for tools documentation
   - Learn about tool categories and usage

### Tool System

Carbon Commander features a powerful tool system:

1. **Local Tools**:
   - Built-in functionality
   - No external dependencies
   - Fast execution
   - Click the ⚡ icon to view all tools

2. **MCP Tools**:
   - External service integration
   - Additional capabilities
   - Network-dependent
   - Automatic discovery

### Smart Features

1. **Autocomplete**:
   - Context-aware suggestions
   - Tab completion
   - Smart command matching
   - History-based suggestions

2. **Command History**:
   - Persistent across sessions
   - Quick navigation with arrow keys
   - Smart filtering and search

3. **AI Integration**:
   - OpenAI for advanced processing
   - Ollama for local operations
   - Real-time responses
   - Automatic provider selection

## Configuration

### OpenAI Setup
1. Get an API key from [OpenAI's platform](https://platform.openai.com/api-keys)
2. Use the command: `set openai-key YOUR_API_KEY` in Carbon Commander

### Ollama Setup (Optional)
1. Install [Ollama](https://ollama.ai)
2. For macOS users, enable external connections:
   ```bash
   launchctl setenv OLLAMA_ORIGINS "*"
   ```

## MCP (Model Context Protocol) Integration

Carbon Commander supports integration with external MCP services, allowing you to extend its capabilities with remote AI tools and services.

### Connecting to MCP Services

1. **Basic Connection**:
   ```
   mcp connect my-service https://my-mcp-service.example.com
   ```

2. **With Authentication** (if required):
   ```javascript
   // Through the API
   window.carbonCommander.mcpToolCaller.configureMCPService({
     serviceId: 'my-service',
     endpoint: 'https://my-mcp-service.example.com',
     apiKey: 'your-api-key',
     options: {
       autoConnect: true,
       autoReconnect: true
     }
   });
   ```

### Features

- **Automatic Tool Discovery**: MCP services automatically expose their tools to Carbon Commander
- **Real-time Status**: Connection status is displayed in the command bar UI
- **Seamless Integration**: MCP tools work alongside local tools transparently
- **System Prompt Enhancement**: MCP services can customize system prompts
- **Scope Building**: Support for custom scope building per MCP service

### Managing MCP Services

- **View Services**: The command bar shows connected MCP services with their status
- **Disconnect Service**: `mcp disconnect my-service`
- **Service Status**: Connection status is shown in the UI badges
- **Auto-reconnect**: Services can be configured to automatically reconnect if disconnected

### Creating an MCP Service

To create a compatible MCP service, implement these endpoints:

```javascript
// Required endpoints
GET /discover-tools         // Returns available tools
POST /execute              // Executes a tool function
GET /status               // Returns service status

// Optional endpoints
POST /build-scope         // Customizes tool scope
POST /system-prompt       // Enhances system prompt
```

Example tool definition in an MCP service:
```javascript
{
  name: "email-tools",
  tools: [{
    name: "send-email",
    description: "Send an email through the MCP service",
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
```

### Security Considerations

- Use HTTPS for all MCP service connections
- Implement proper authentication (API keys, tokens, etc.)
- Validate all incoming requests on the MCP service
- Consider rate limiting and access controls
- Monitor service usage and implement logging

## Adding Custom Tools

Carbon Commander uses a modular tool system. Tools are defined as JavaScript classes with specific methods:

```javascript
class CustomToolset {
    static _CarbonBarPageLoadFilter(window) {
        return window.location.href.includes('example.com'); 
    }

    // See more examples in the SMTools.js and GeneralTools.js files.
    // Such as _CarbonBarPageLoadFilter, _CarbonBarBuildScope, _CarbonBarSystemPrompt, etc.

    static MyTool = {
        name: 'my-tool',
        description: 'Description of what the tool does',
        function: {
            parameters: {
                type: 'object',
                properties: {
                    param1: {
                        type: 'string',
                        description: 'Parameter description'
                    }
                },
                required: ['param1']
            }
        },
        execute: async (scope, args) => {
            await new Promise(resolve => setTimeout(resolve, 500));
            return { success: true, result: 'Tool result given to AI after 500ms' };
        }
    };
}

(window.sbaiTools ??= {}).CustomToolsetName = CustomToolsetName;
```

## Future Plans

### MCP (Model Context Protocol) Support
One key learning from this project was the importance of MCP (Model Context Protocol). Future versions will deeply integrate MCP support, enabling seamless interaction with a wide variety of AI services and models. This integration will allow for more flexible and powerful AI capabilities across different providers and platforms.

## Support / Contact

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/carbonitex)

## Disclaimer

**USE AT YOUR OWN RISK**: Carbon Commander and its authors, contributors, and integrated software providers assume no liability for any actions taken by the extension on behalf of the user. The extension executes commands and interacts with your browser based on user inputs and AI recommendations. Users are responsible for reviewing and approving any actions before they are executed. While I strive for safety and security, I cannot guarantee the extension will always behave as intended or that it won't cause unintended consequences.

## License

This project is licensed under the GNU Lesser General Public License v3.0 - see the [LICENSE](LICENSE) file for details. 