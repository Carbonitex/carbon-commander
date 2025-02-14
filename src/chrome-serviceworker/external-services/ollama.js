import { ccLogger } from '../../global.js';

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
            const response = await fetch(`${this.hostEndpoint}/api/version`, {
                headers: {
                    'Origin': chrome.runtime.getURL(''),
                }
            });
            
            if (response.status === 403) {
                ccLogger.error('Ollama CORS error - Origin not allowed. Please add chrome-extension://* to OLLAMA_ORIGINS');
                ccLogger.error('Current origin:', chrome.runtime.getURL(''));
                this.available = false;
                return false;
            }
            
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
        //Note: OLLAMA_ORIGINS is configured in the environment
        //export OLLAMA_ORIGINS="chrome-extension://*"
        //launchctl setenv OLLAMA_ORIGINS "chrome-extension://*" should be done on MACOS
        return 'http://127.0.0.1:11434'
    }

    async getHttpClient() {
        return {
            timeout: 5 * 60 * 1000 // 5 minutes
        };
    }

    async getModelsList() {
        ccLogger.debug('Fetching Ollama models list');
        try {
            const response = await fetch(`${this.hostEndpoint}/api/tags`, {
                headers: {
                    'Origin': chrome.runtime.getURL('')
                }
            });
            
            if (response.status === 403) {
                ccLogger.error('Ollama CORS error - Origin not allowed. Please add chrome-extension://* to OLLAMA_ORIGINS');
                ccLogger.error('Current origin:', chrome.runtime.getURL(''));
                return [];
            }
            
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
            const response = await fetch(`${this.hostEndpoint}/api/pull`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': chrome.runtime.getURL('')
                },
                body: JSON.stringify({ name: modelName })
            });

            if (response.status === 403) {
                ccLogger.error('Ollama CORS error - Origin not allowed. Please add chrome-extension://* to OLLAMA_ORIGINS');
                ccLogger.error('Current origin:', chrome.runtime.getURL(''));
                throw new Error('CORS error - Origin not allowed. Please add chrome-extension://* to OLLAMA_ORIGINS');
            }

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
        let modelExists = models.some(m => m.name === modelName);
        if(!modelExists) {
            //contains the model name
            modelExists = models.some(m => m.name.includes(modelName));
        }

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
            const response = await fetch(`${this.hostEndpoint}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'Accept-Encoding': 'gzip',
                    'Accept-Charset': 'utf-8',
                    'Accept-Language': 'en-US',
                    'Origin': chrome.runtime.getURL('')
                },
                body: JSON.stringify(request)
            });

            if (response.status === 403) {
                ccLogger.error('Ollama CORS error - Origin not allowed. Please add chrome-extension://* to OLLAMA_ORIGINS');
                ccLogger.error('Current origin:', chrome.runtime.getURL(''));
                throw new Error('CORS error - Origin not allowed. Please add chrome-extension://* to OLLAMA_ORIGINS');
            }

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

export default new OllamaClient(); 