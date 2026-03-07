import CCLocalStorage from '../local-storage.js';
import { ccLogger } from '../../global.js';

class GeminiClient {
    static FAST_MODEL = "gemini-2.0-flash";
    static REASON_MODEL = "gemini-2.5-pro-preview-03-25";
    static VISION_MODEL = "gemini-pro-vision";
    static IMAGE_MODEL = "imagen-3.0-generate-002";
    static isAvailable = null;

    constructor() {
        this.apiKey = '';
        this.defaultModel = GeminiClient.FAST_MODEL;
    }

    setApiKey(key, save = false) {
        ccLogger.debug('Setting Gemini API key', save);
        this.apiKey = key;
        GeminiClient.isAvailable = (key && key.length > 0);
        if(save) {
            CCLocalStorage.setEncrypted('gemini-key', key);
        }
    }

    async isAvailable() {
        if(GeminiClient.isAvailable == null) {
            try {
                // Get the key from the new encrypted storage location
                const key = await CCLocalStorage.getEncrypted('gemini-key');
                
                GeminiClient.isAvailable = (key && key.length > 0);
                if(GeminiClient.isAvailable) {
                    this.apiKey = key;
                    ccLogger.info('Gemini is available and configured');
                } else {
                    ccLogger.warn('Gemini is not available - no API key found');
                }
            } catch (error) {
                ccLogger.error('Error checking Gemini availability:', error);
                GeminiClient.isAvailable = false;
                this.apiKey = '';
            }
        }
        return GeminiClient.isAvailable;
    }

    async testKey(key) {
        ccLogger.group('Testing Gemini API Key');
        try {
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
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
            ccLogger.error('Gemini key test failed:', error);
            ccLogger.groupEnd();
            throw new Error(`Invalid Gemini key: ${error.message}`);
        }
    }

    async getHttpClient() {
        return {
            timeout: 5 * 60 * 1000 // 5 minutes
        };
    }

    async getModelsList() {
        ccLogger.debug('Fetching Gemini models list');
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
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
        ccLogger.group('Gemini Chat Completion');
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
                            index: toolCall.index || 0,
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
            ccLogger.debug('Last message type:', lastMessage.role, lastMessage.tool_calls);
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
        ccLogger.group('Gemini Chat Completion Unwrapped');
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
                const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
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
                throw new Error(`Gemini API Error: ${error.error?.message || 'Unknown error'}`);
            }

            if (!stream) {
                const data = await response.json();
                if (!data.choices?.[0]?.message) {
                    throw new Error('Invalid response format from Gemini API');
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
                                        id: `toolCall_${toolCall.id}`,
                                        index: toolCall.index || 0,
                                        function: {
                                            name: '',
                                            arguments: ''
                                        }
                                    };
                                }
                                currentToolCall = toolCalls[toolCall.index];
                            }

                            if (toolCall.function) {
                                if(!currentToolCall) {
                                    currentToolCall = {
                                        id: `toolCall_${toolCall.id}`,
                                        index: toolCall.index || 0,
                                        function: {
                                            name: '',
                                            arguments: ''
                                        }
                                    };
                                    toolCalls.push(currentToolCall);
                                }

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
                                        index: toolCall.index || 0,
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
            ccLogger.error('Gemini API Error:', error);
            ccLogger.groupEnd();
            throw error;
        }
        ccLogger.groupEnd();
        return null;
    }

    async generateImage(prompt, size = '1024x1024', n = 1, model = null) {
        ccLogger.group('Gemini Image Generation (Imagen 3)');
        model = GeminiClient.IMAGE_MODEL;


        n = Math.max(1, Math.min(n, 4));
        
        // Convert pixel dimensions to aspect ratios
        // Default values for common resolutions:
        // - 1024x1024 → "1:1"
        // - 1024x1792 → "9:16"
        // - 1792x1024 → "16:9"
        // - 768x1024 → "3:4"
        // - 1024x768 → "4:3"
        const supportedAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
        let aspectRatio = "1:1"; // Default to 1:1 if conversion fails
        
        if (typeof size === 'string' && size.includes('x')) {
            const [width, height] = size.split('x').map(Number);
            if (width && height) {
                if (width === height) {
                    aspectRatio = "1:1";
                } else if (width > height) {
                    // Landscape orientation
                    if (Math.abs(width/height - 4/3) < 0.1) aspectRatio = "4:3";
                    else if (Math.abs(width/height - 16/9) < 0.1) aspectRatio = "16:9";
                } else {
                    // Portrait orientation
                    if (Math.abs(height/width - 4/3) < 0.1) aspectRatio = "3:4";
                    else if (Math.abs(height/width - 16/9) < 0.1) aspectRatio = "9:16";
                }
            }
        } else if (supportedAspectRatios.includes(size)) {
            // If user directly specified a valid aspect ratio, use it
            aspectRatio = size;
        }
        
        ccLogger.debug(`Converting size ${size} to aspect ratio ${aspectRatio}`);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${this.apiKey}`;

        const request = {
            instances: [
                { prompt: prompt }
            ],
            parameters: {
                sampleCount: n,
                aspectRatio: aspectRatio
            }
        };

        

        ccLogger.debug('Imagen 3 generation request:', {
            endpoint,
            model: model,
            prompt: request.instances[0].prompt.substring(0, 50) + '...',
            n: request.parameters.sampleCount,
            aspectRatio: request.parameters.aspectRatio
        });

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                const errorData = await response.json();
                ccLogger.error('Gemini Imagen API Error Response:', errorData);
                throw new Error(`Gemini Imagen API Error: ${errorData.error?.message || response.statusText}`);
            }

            const result = await response.json();
            
            if (!result.predictions || !Array.isArray(result.predictions)) {
                ccLogger.error('Unexpected response format from Imagen API:', result);
                throw new Error('Invalid response format from Imagen API.');
            }

            const formattedResult = result.predictions.map(pred => ({ b64_json: pred.bytesBase64Encoded }));
            ccLogger.info(`Imagen 3 generation successful. Received ${formattedResult.length} images.`, formattedResult);
            ccLogger.groupEnd();
            return formattedResult; 

        } catch (error) {
            ccLogger.error('Gemini Imagen Generation Failed:', error);
            ccLogger.groupEnd();
            throw error;
        }
    }
}

export default new GeminiClient(); 