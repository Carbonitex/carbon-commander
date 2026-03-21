import { ccLogger, AICallerModels } from '../global.js';
import { CarbonBarHelpTools } from '../tools/CarbonBarHelpTools.js';

class ProviderManager {
    constructor() {
        this.connectedProviders = new Set();
        this.hasNoAIMode = false;
        this.ollamaCheckInterval = null;
        this.addedOllamaReminder = false;
        this.disabledProviders = null;
    }

    setBar(bar) {
        this.bar = bar;
    }

    getNoProviderHtml() {
        return `
            <div class="cc-no-provider">
                <h3>No AI Provider Available</h3>
                <p>To use the command bar, you'll need to set up one of these AI providers:</p>

                <div class="provider-section">
                    <h4>OpenRouter</h4>
                    <p>Access many AI models (GPT-4, Claude, Gemini, etc.) through a single API key.</p>
                    <ul>
                        <li>Get an API key from <a href="https://openrouter.ai" target="_blank">OpenRouter</a></li>
                        <li>Use the command: <code>set openrouter-key YOUR_API_KEY</code></li>
                        ${this.connectedProviders.has('openrouter') ?
                            '<li>Or disconnect: <code>disconnect openrouter</code></li>' : ''}
                    </ul>
                </div>

                <div class="provider-section">
                    <h4>Ollama</h4>
                    <p>A local AI solution that runs on your machine.</p>
                    <ul>
                        <li>Download and install <a href="https://ollama.ai" target="_blank">Ollama</a></li>
                        <li>Run Ollama locally</li>
                        <li>For macOS users, enable external connections:</li>
                        <li><code>launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"</code></li>
                    </ul>
                </div>

                <div class="provider-status">
                    <p>Current Status:</p>
                    <ul>
                        <li>OpenRouter: <span class="status-indicator">Not Connected</span></li>
                        <li>Ollama: <span class="status-indicator">Not Connected</span></li>
                    </ul>
                </div>
            </div>
        `;
    }

    async checkOllamaAvailability(interval = 1000, maxCount = -1) {
        ccLogger.time('ollamaCheck');
        let count = 0;
        if (!this.ollamaCheckInterval) {
            this.ollamaCheckInterval = setInterval(async () => {
                count++;
                if (maxCount > 0 && count > maxCount && !this.hasNoAIMode) {
                    ccLogger.debug('Ollama check complete', { count: count - 1 });
                    clearInterval(this.ollamaCheckInterval);
                    this.ollamaCheckInterval = null;
                    return;
                }
                try {
                    ccLogger.debug('Checking Ollama availability', { noAIMode: this.hasNoAIMode });
                    this.bar.postMessage({
                        type: "CHECK_OLLAMA_AVAILABLE",
                        payload: {
                            noAIMode: this.hasNoAIMode
                        }
                    });
                } catch (error) {
                    ccLogger.error('Ollama check failed:', error);
                }
            }, interval);
        }
        ccLogger.timeEnd('ollamaCheck');
    }

    stopOllamaCheck() {
        if (this.ollamaCheckInterval) {
            clearInterval(this.ollamaCheckInterval);
            this.ollamaCheckInterval = null;
        }
    }

    updateProviderStatus(provider, isConnected) {
        ccLogger.debug('PROVIDER_STATUS_UPDATE', provider, isConnected);

        if (provider.startsWith('mcp:')) {
            const mcpBadgesContainer = this.bar.container.querySelector('.cc-mcp-badges');
            let badge = mcpBadgesContainer.querySelector(`[data-provider="${provider}"]`);

            if (!badge) {
                badge = document.createElement('div');
                badge.classList.add('cc-provider-badge');
                badge.setAttribute('data-provider', provider);
                badge.textContent = provider.substring(4);
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
            const badge = this.bar.container.querySelector(`.cc-provider-badge[data-provider="${provider}"]`);
            if (badge) {
                if (isConnected) {
                    if (this.disabledProviders && this.disabledProviders.has(provider)) {
                        badge.setAttribute('data-status', 'disabled');
                    } else {
                        badge.setAttribute('data-status', 'connected');
                    }
                    this.connectedProviders.add(provider);
                } else {
                    badge.removeAttribute('data-status');
                    this.connectedProviders.delete(provider);
                }
            }
        }

        if (!this.addedOllamaReminder && this.connectedProviders.has('ollama') && !this.connectedProviders.has('openrouter')) {
            this.addedOllamaReminder = true;
            this.bar.messages.push({
                role: 'system',
                content: `Call the set_openrouter_key tool to connect to OpenRouter if the user provides a key.`
            });
        }

        const statusList = this.bar.container.querySelectorAll('.provider-status li');
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

    async noAIModeOpenRouterInputRespond() {
        var msgs = [];
        let newSystemPrompt = `You are a helpful AI assistant integrated into a smart command bar. You are currently in low-AI mode using OpenRouter's cloud-based models.

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

        msgs.push(this.bar.messages[this.bar.messages.length - 1]);

        var request = {
            messages: msgs,
            model: AICallerModels.FAST,
            tools: CarbonBarHelpTools.GetNoAIModeToolInfo(),
            temp: 0.6,
            keepAlive: '30m',
            provider: 'openrouter'
        };
        this.bar.postMessage({
            type: "AI_REQUEST",
            payload: request
        });
    }

    async noAIModeOllamaInputRespond() {
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

Available tools are being limited. For more advanced features, recommend connecting to OpenRouter. If you can't fulfill a request remind them that they are running in a low-AI mode and that they can connect to OpenRouter for more advanced features. Or that they may refresh the page to enter normal mode.`;

        msgs.push({
            role: 'system',
            content: newSystemPrompt
        });

        msgs.push(this.bar.messages[this.bar.messages.length - 1]);

        var request = {
            messages: msgs,
            model: 'mistral-small',
            tools: CarbonBarHelpTools.GetNoAIModeToolInfo(),
            temp: 0.5,
            keepAlive: '30m',
            provider: 'ollama'
        };
        this.bar.postMessage({
            type: "AI_REQUEST",
            payload: request
        });
    }

    async noAIModeInputHandler(messages) {
        const userMessage = messages[messages.length - 1];
        const userInput = userMessage.content;

        if (userInput.toLowerCase().startsWith('set openrouter-key ')) {
            const key = userInput.substring(19).trim();

            try {
                var result = await CarbonBarHelpTools.SetOpenRouterKey.execute(await this.bar.toolCaller.getToolScope(this.bar), { key: key });
                ccLogger.debug('result', result);
                if (result.success) {
                    this.bar.chatManager.sendFakeAIResponse('OpenRouter key set successfully');
                } else {
                    this.bar.chatManager.sendFakeAIResponse("Failed to set OpenRouter key. Please try again.");
                }
            } catch (error) {
                this.bar.chatManager.sendFakeAIResponse("Failed to set OpenRouter key. Please try again.");
            }

            return;
        }

        if (this.connectedProviders.has('openrouter')) {
            this.noAIModeOpenRouterInputRespond();
            return;
        } else if (this.connectedProviders.has('ollama')) {
            this.noAIModeOllamaInputRespond();
            return;
        }

        this.bar.chatManager.sendFakeAIResponse("To set up an AI provider, you can:\n\n" +
            "1. Set your OpenRouter key using: `set openrouter-key YOUR_API_KEY`\n" +
            "2. Install and run Ollama locally\n\n" +
            "Need help? Type 'help' for more information."
        );
    }
}

const providerManager = new ProviderManager();
export default providerManager;
