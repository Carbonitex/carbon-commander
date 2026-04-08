import { marked } from 'marked';
import { ccLogger, AICallerModels } from '../global.js';

class ChatManager {
    constructor() {
        this.messages = [];
        this.accumulatedChunks = '';
        this.createNewResultContainer = false;
    }

    setBar(bar) {
        this.bar = bar;
    }

    sendFakeAIResponse(content, delay = 500) {
        setTimeout(() => {
            this.handleAIResponse({
                type: 'AI_CHUNK_RESPONSE',
                payload: {
                    content: content,
                    isFinished: true
                }
            });
        }, delay);
    }

    handleAIResponse(message) {
        ccLogger.group('AI Response Handler');
        const container = this.bar.container.querySelector('.cc-container');
        const payload = message.payload || message.data.payload;

        ccLogger.debug('Processing AI response:', { type: message.type, payload });

        if (payload.error) {
            ccLogger.error('AI response error:', payload.error);
            this.bar.displayError(payload);
        } else if (message.type == 'AI_ERROR_RESPONSE') {
            ccLogger.error('AI response error:', payload);
            this.bar.displayError(payload);
        }

        if (typeof payload.content === 'string' && payload.content.length > 0) {
            const chunk = payload.content;
            ccLogger.debug('AI_CHUNK_RESPONSE2', payload.error, message.type, chunk);
            this.accumulatedChunks += chunk;
            let htmlContent = marked.parse(this.accumulatedChunks);
            const resultContainer = this.bar.getCurrentResultContainer();
            ccLogger.debug('AI_CHUNK_RESPONSE3', resultContainer);
            let aiOutput = resultContainer.querySelector('.cc-ai-output');

            if (!aiOutput || aiOutput.classList.contains('state_finished')) {
                aiOutput = document.createElement('div');
                aiOutput.classList.add('cc-ai-output');
                resultContainer.appendChild(aiOutput);
            }

            if (htmlContent.length > 0) {
                aiOutput.innerHTML = htmlContent;
            } else {
                aiOutput.remove();
                aiOutput = null;
            }

            if (aiOutput && payload.isFinished) {
                aiOutput.classList.add('state_finished');
            }

        } else {
            if (payload.content?.type == "TOOL_CALL_CHUNK") {
                this.accumulatedChunks = '';
                const chunk = payload.content.payload;
                const toolCallId = chunk.id;

                let currentResultContainer = this.bar.resultsContainer;
                let toolCallDiv = currentResultContainer.querySelectorAll(`.cc-tool-call[data-id="${toolCallId}"]`);
                ccLogger.debug('toolCallDiv', toolCallDiv);
                if (!toolCallDiv || toolCallDiv.length == 0) {
                    toolCallDiv = document.createElement('div');
                    toolCallDiv.classList.add('cc-tool-call');
                    toolCallDiv.setAttribute('data-id', toolCallId);

                    toolCallDiv.innerHTML = `
                      <div class="tool-simple-view tool-view-toggle"></div>
                      <div class="tool-advanced-view" style="display: none;"></div>
                    `;
                    currentResultContainer.appendChild(toolCallDiv);
                }

                if (Array.isArray(toolCallDiv) || NodeList.prototype.isPrototypeOf(toolCallDiv) || HTMLCollection.prototype.isPrototypeOf(toolCallDiv)) {
                    toolCallDiv = toolCallDiv[0];
                }

                let simpleView = toolCallDiv.querySelector('.tool-simple-view');
                let advancedView = toolCallDiv.querySelector('.tool-advanced-view');

                const { simpleHtml, advancedHtml } = this.bar.toolCaller.getToolHtml(chunk);
                simpleView.innerHTML = simpleHtml;
                advancedView.innerHTML = advancedHtml;

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

        this.bar.resultsContainer.scrollTop = this.bar.resultsContainer.scrollHeight;

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
            this.bar.input.value = '';
            this.bar.input.disabled = false;
            this.bar.input.focus();

            const resultContainer = this.bar.getCurrentResultContainer();
            ccLogger.debug('imageUrls1', resultContainer);
            let aiOutput = resultContainer.querySelector('.cc-ai-output');

            if (aiOutput) {
                let htmlContent = aiOutput.innerHTML;
                const imageUrls = htmlContent.match(/"(.*)image_(.*)\.png"/g);
                if (imageUrls && imageUrls.length > 0) {
                    imageUrls.forEach(imageUrl => {
                        const requestId = imageUrl.match(/"(.*)image_(.*)\.png"/)[2];
                        window.cbImages.forEach(image => {
                            if (image.requestId == requestId) {
                                htmlContent = htmlContent.replace(imageUrl, `"${image.data}"`);
                            }
                        });
                    });
                }
                aiOutput.innerHTML = htmlContent;
            }
        }

        if (payload.messages && !payload.error) {
            ccLogger.debug('AI response messages', payload.messages);
            this.messages = payload.messages;
        }
        ccLogger.groupEnd();
    }

    async handleSubmit(value) {
        ccLogger.group('Handle Submit');
        ccLogger.info('Processing input:', value);

        // Special commands for MCP services
        if (value.toLowerCase().startsWith('mcp connect ')) {
            const [_, serviceId, endpoint] = value.split(' ');
            await this.bar.mcpToolCaller.configureMCPService({
                serviceId,
                endpoint,
                options: { autoConnect: true }
            });
            this.sendFakeAIResponse(`Connecting to MCP service: ${serviceId}`);
            return;
        }

        if (value.toLowerCase().startsWith('mcp disconnect ')) {
            const serviceId = value.split(' ')[2];
            await this.bar.mcpToolCaller.disconnectMCPService(serviceId, true);
            this.sendFakeAIResponse(`Disconnected from MCP service: ${serviceId}`);
            return;
        }

        if (value.toLowerCase() === 'disconnect openrouter') {
            ccLogger.info('Disconnecting OpenRouter');
            this.sendFakeAIResponse("OpenRouter disconnected successfully");
            ccLogger.groupEnd();
            return;
        }

        if (value.toLowerCase() === 'disconnect gemini') {
            ccLogger.info('Ignoring legacy disconnect gemini command');
            this.sendFakeAIResponse("Gemini is no longer supported. Use OpenRouter instead.");
            ccLogger.groupEnd();
            return;
        }

        const container = this.bar.container.querySelector('.cc-container');

        container.classList.add('transitioning');

        setTimeout(() => {
            container.classList.remove('waiting-input', 'has-error', 'tool-running', 'success', 'rainbow');
            container.classList.add('processing');
            container.classList.remove('transitioning');
        }, 150);

        this.bar.input.disabled = true;
        this.bar.input.value = 'Processing...';

        this.bar.resultsContainer.classList.remove('hidden');
        this.bar.resultsContainer.style.display = 'block';

        try {
            this.messages.push({
                role: 'user',
                content: value
            });

            const userElement = document.createElement('div');
            userElement.classList.add('cc-user-message');
            userElement.textContent = value;
            this.bar.resultsContainer.appendChild(userElement);
            this.bar.resultsContainer.scrollTop = this.bar.resultsContainer.scrollHeight;

            if (this.bar.providerManager.hasNoAIMode) {
                this.bar.providerManager.noAIModeInputHandler(this.messages);
            } else {
                // Internal tools are now discovered by the service worker from the tool registry.
                // Only external MCP tools need to be sent from the page.
                const mcpTools = Array.from(this.bar.mcpToolCaller.mcpToolsets.values())
                    .reduce((tools, toolset) => tools.concat(toolset.tools), []);

                var request = {
                    messages: this.messages,
                    model: AICallerModels.FAST,
                    tools: mcpTools.length > 0 ? mcpTools : [],
                    temp: 0.7,
                    keepAlive: '30m'
                };

                this.bar.postMessage({
                    type: "AI_REQUEST",
                    payload: request
                });
            }
        } catch (error) {
            container.classList.add('transitioning');
            setTimeout(() => {
                container.classList.remove('processing');
                container.classList.add('has-error');
                container.classList.remove('transitioning');
            }, 150);

            ccLogger.error('Error:', error);
            this.bar.resultsContainer.innerHTML += `
                <div class="cc-error">Error: ${error.message}</div>
            `;
            this.bar.input.disabled = false;
            this.bar.input.value = value;
            this.bar.resultsContainer.scrollTop = this.bar.resultsContainer.scrollHeight;
        }
        ccLogger.groupEnd();
    }

    async addSystemPrompt() {
        ccLogger.group('System Prompt Generation');

        let systemPrompt = `This is a smart chat bar a popup inside ${this.bar.currentApp}. It can be used to ask questions, get help, and perform tasks.`;
        systemPrompt += ' The current date and time is ' + new Date().toLocaleString();
        systemPrompt += '. You can use the tools to perform tasks, chain them together to build context, and perform complex tasks.';

        if (this.bar.settings.systemPrompt) {
            systemPrompt += '\n\Custom User Instructions:\n' + this.bar.settings.systemPrompt;
        }

        const currentHostname = window.location.hostname;
        if (this.bar.settings.hostnamePrompts && this.bar.settings.hostnamePrompts.has(currentHostname)) {
            systemPrompt += `\n\nHost-Specific Instructions: ${currentHostname} - ${this.bar.settings.hostnamePrompts.get(currentHostname)}`;
        }

        ccLogger.debug('Building system prompt with tools');

        const scope = await this.bar.toolCaller.getToolScope(this.bar);

        systemPrompt = await this.bar.toolCaller.buildSystemPrompt(systemPrompt, scope);

        for (const [serviceId, client] of this.bar.mcpToolCaller.mcpClients.entries()) {
            try {
                if (client.getSystemPrompt) {
                    systemPrompt = await client.getSystemPrompt(systemPrompt);
                }
            } catch (error) {
                ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
            }
        }

        this.messages.push({
            role: 'system',
            content: systemPrompt
        });

        ccLogger.debug('Final system prompt:', systemPrompt);
        ccLogger.groupEnd();
    }
}

const chatManager = new ChatManager();
export default chatManager;
