import CCLocalStorage from '../local-storage.js';
import { ccLogger } from '../../global.js';

class OpenAIClient {
    static FAST_MODEL = "gpt-4o-mini";
    static REASON_MODEL = "o3-mini";
    static VISION_MODEL = "gpt-4-vision-preview";
    static isAvailable = null;

    constructor() {
        this.apiKey = '';
        this.defaultModel = OpenAIClient.FAST_MODEL;
    }

    setApiKey(key, save = false) {
        ccLogger.debug('Setting OpenAI API key', save);
        this.apiKey = key;
        OpenAIClient.isAvailable = (key && key.length > 0);
        if(save) {
            CCLocalStorage.setEncrypted('openai-key', key);
        }
    }

    async isAvailable() {
        if(OpenAIClient.isAvailable == null) {
            try {
                // Get the key from the new encrypted storage location
                const key = await CCLocalStorage.getEncrypted('openai-key');
                
                OpenAIClient.isAvailable = (key && key.length > 0);
                if(OpenAIClient.isAvailable) {
                    this.apiKey = key;
                    ccLogger.info('OpenAI is available and configured');
                } else {
                    ccLogger.warn('OpenAI is not available - no API key found');
                }
            } catch (error) {
                ccLogger.error('Error checking OpenAI availability:', error);
                OpenAIClient.isAvailable = false;
                this.apiKey = '';
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
                    const toolCallerResult = await toolCaller({ id: toolCall.id, name: toolCall.function.name, arguments: parsedArgs });

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
                        success: toolCallerResult.result.success,
                        hasError: !!toolCallerResult.result.error
                    });

                    if(toolCallerResult?.result && toolCallerResult.result.success) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: typeof toolCallerResult.result === 'string' ? toolCallerResult.result : JSON.stringify(toolCallerResult.result)
                        });
                    } else {
                        console.log('Tool call failed:', toolCallerResult);

                        let content = null;
                        if(toolCallerResult.content) {
                            content = toolCallerResult.content;
                        } else if(toolCallerResult.result) {
                            content = toolCallerResult.result;
                        } else if(toolCallerResult.error) {
                            content = toolCallerResult.error;
                        } else {
                            content = 'An unknown error occurred.';
                        }


                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: typeof content === 'string' ? content : JSON.stringify(content)
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

        for(var message of messages) {
            if(message.tool_calls) {
                for(var toolCall of message.tool_calls) {
                    if(toolCall.function?.arguments && typeof toolCall.function.arguments !== 'string') {
                        toolCall.function.arguments = JSON.stringify(toolCall.function.arguments);
                    }
                }
            }
            if(message.content && typeof message.content !== 'string') {
                message.content = JSON.stringify(message.content);
            }
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
                                    ccLogger.debug('Tool call:', toolCall.function.name, toolCall.function.arguments);
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

export default new OpenAIClient(); 