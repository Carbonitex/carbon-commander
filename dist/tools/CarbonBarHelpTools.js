class CarbonBarHelpTools {
    static name = "CarbonBarHelpTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return true; //manually get injected as needed
    }

    static GetNoAIModeToolInfo() {
        return [
            CarbonBarHelpTools.SetOpenAIKey.function,
            CarbonBarHelpTools.CheckOllamaStatus.function,
            CarbonBarHelpTools.GetSetupGuide.function
        ];
    }

    static GetSetupGuide = {
        function: {
            name: 'get_setup_guide',
            description: 'Get detailed setup instructions for OpenAI and Ollama',
            parameters: {
                properties: {
                    topic: {
                        type: 'string',
                        description: 'The specific setup topic (openai, ollama, or general)'
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

Note: Keep your API key secure and never share it publicly.`;
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

The command bar will automatically detect Ollama when it's running.`;
                    break;

                case 'general':
                    guide = `# Getting Started with Carbon Commander

Carbon Commander works best with both OpenAI and Ollama:

- OpenAI provides advanced AI capabilities
- Ollama offers local processing for faster responses

## Quick Setup Steps:
1. Set up OpenAI first (use \`get_setup_guide openai\`)
2. Install Ollama (use \`get_setup_guide ollama\`)
3. The command bar will automatically detect when both are ready

Need more help? Use \`get_setup_guide\` with 'openai' or 'ollama' for detailed instructions.`;
                    break;

                default:
                    return { success: false, error: 'Invalid topic. Use "openai", "ollama", or "general".' };
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
}

(window.sbaiTools ??= {}).CarbonBarHelpTools = CarbonBarHelpTools;

export { CarbonBarHelpTools };