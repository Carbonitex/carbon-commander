import OllamaClient from './ollama.js';
import OpenAIClient from './openai.js';
import CCLocalStorage from '../local-storage.js';
import { ccLogger, AICallerModels } from '../../global.js';


class AICaller {
    constructor() {
        this.openai = OpenAIClient;
        this.ollama = OllamaClient;
        this.defaultProvider = '';
        this.disabledProviders = new Set();
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

    async setOpenAIKey(key, testOnly = false, save = false) {
        ccLogger.group('Setting OpenAI API Key');
        try {
            // Test the key before setting it
            await this.openai.testKey(key);
            
            if(!testOnly) {
                // If test passes, set it in the OpenAI client
                this.openai.setApiKey(key, save);
                this.setDefaultProvider('openai');
                ccLogger.info('OpenAI API key set successfully');
                if(save) {
                    ccLogger.info('OpenAI API key saved to storage');

                }
            }
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
        
        if (this.disabledProviders.has(provider)) {
            throw new Error(`Provider ${provider} is temporarily disabled`);
        }

        if (provider === 'openai' && !this.openai.isAvailable()) {
            throw new Error('OpenAI API key not set');
        }

        if (provider === 'ollama' && !this.ollama.isAvailable()) {
            throw new Error('Ollama is not available');
        }

        return provider === 'openai' ? this.openai : this.ollama;
    }

    async autocompleteSuggestions(commandBarInput, commandHistory, context) {
        ccLogger.group('Generating Autocomplete');
        let systemPrompt = `You are an AI that autocompletes commands in a command bar built to complete tasks for the user.`;
        systemPrompt += `Command history:\n${commandHistory.join('\n')}`;
        if(context && context.length > 0) {
            systemPrompt += `Context:\n${context}\n`;
        }

        systemPrompt += `\n\n

Respond with a JSON array of 3 possible responses to the
query, each containing a string parameter called "text" that
is about 5 words long
`

        var addUserInputViaSystemPrompt = false;
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

        if(provider == 'openai') {
            //disabled for now
            ccLogger.debug('Autocomplete disabled for OpenAI');
            ccLogger.groupEnd();
            return null;
        }

        

        const [suggestion, details] = await this.chatCompletion(messages, null, AICallerModels['AUTOCOMPLETE'][provider], provider, null, null, 0.4);
        ccLogger.debug('Autocomplete result:', {
            input: commandBarInput,
            suggestion,
            provider
        });

        try {
            // Check if we have a valid suggestion
            if (!suggestion || typeof suggestion !== 'string') {
                ccLogger.error('Invalid suggestion received from AI');
                ccLogger.groupEnd();
                return [];
            }

            // First try to parse as direct JSON (in case AI didn't use backticks)
            try {
                const directJson = JSON.parse(suggestion);
                if (Array.isArray(directJson) && this.validateSuggestions(directJson)) {
                    ccLogger.debug('Parsed direct JSON response');
                    ccLogger.groupEnd();
                    return directJson;
                }
            } catch (e) {
                // Not direct JSON, continue to try backticks format
                ccLogger.debug('Not direct JSON, trying backticks format');
            }

            // Look for content between backticks
            const backtickMatch = suggestion.match(/\`\`\`([\S\s\W\w]*)\`\`\`/m);
            if (!backtickMatch || !backtickMatch[1]) {
                ccLogger.warn('No content found between backticks, attempting to format raw response');
                // Try to salvage by converting the raw response into a suggestion
                return this.formatFallbackSuggestion(suggestion);
            }

            let jsonString = backtickMatch[1];
            
            // Remove 'json' prefix if present
            if (jsonString.startsWith('json')) {
                jsonString = jsonString.substring(4);
            }

            // Try to parse the JSON
            const json = JSON.parse(jsonString.trim());
            
            // Validate the structure
            if (!Array.isArray(json)) {
                ccLogger.warn('Response is not an array, converting to array format');
                return this.formatFallbackSuggestion(JSON.stringify(json));
            }

            if (this.validateSuggestions(json)) {
                ccLogger.debug('Successfully parsed and validated JSON response');
                ccLogger.groupEnd();
                return json;
            } else {
                ccLogger.warn('Invalid suggestion format, using fallback');
                return this.formatFallbackSuggestion(jsonString);
            }

        } catch (error) {
            ccLogger.error('Error processing autocomplete response:', error);
            ccLogger.groupEnd();
            return [];
        }
    }

    validateSuggestions(suggestions) {
        if (!Array.isArray(suggestions)) return false;
        return suggestions.every(item => 
            item && 
            typeof item === 'object' && 
            typeof item.text === 'string' &&
            item.text.trim().length > 0
        );
    }

    formatFallbackSuggestion(rawText) {
        // Try to salvage the response by converting it to the expected format
        const cleanText = rawText.replace(/["`]/g, '').trim();
        return [{
            text: cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText
        }];
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

    disableProvider(provider) {
        ccLogger.info(`Disabling provider: ${provider}`);
        this.disabledProviders.add(provider);
        
        // If this was the default provider, try to switch to another one
        if (provider === this.defaultProvider) {
            if (provider === 'openai' && !this.disabledProviders.has('ollama')) {
                this.setDefaultProvider('ollama');
            } else if (provider === 'ollama' && !this.disabledProviders.has('openai')) {
                this.setDefaultProvider('openai');
            }
        }
    }

    enableProvider(provider) {
        ccLogger.info(`Enabling provider: ${provider}`);
        this.disabledProviders.delete(provider);
        
        // If OpenAI is being enabled and we're currently using Ollama, switch back to OpenAI
        if (provider === 'openai' && this.defaultProvider === 'ollama') {
            this.setDefaultProvider('openai');
        }
    }
}

// Export a singleton instance
export { AICallerModels };

export default new AICaller();