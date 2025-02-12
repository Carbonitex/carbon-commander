import OllamaClient from './ollama.js';
import OpenAIClient from './openai.js';
import CCLocalStorage from '../local-storage.js';
import { ccLogger } from '../global.js';

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
        this.openai = OpenAIClient;
        this.ollama = OllamaClient;
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
            await CCLocalStorage.setEncrypted('openai_api_key', key);
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
        const token = await this.chatCompletion(messages, null, OllamaClient.FAST_MODEL);
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
export { AICallerModels };

export default new AICaller();