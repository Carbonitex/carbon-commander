# Carbon Commander

A powerful command palette interface for Chrome with AI-powered tools and extensible architecture. 

## Features

- AI-powered command palette with support for multiple LLM providers (OpenAI, Ollama)
- Extensible tool system for adding custom functionality
- Local AI capabilities through Ollama integration
- Real-time streaming responses and tool execution
- Command history and autocomplete powered by Ollama

## Installation

1. Clone this repository
2. Run `npm install`
3. Build the extension: `npm run build`
4. Load the unpacked extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select the `dist` directory

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