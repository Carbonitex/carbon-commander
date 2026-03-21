import OllamaClient from './ollama.js';
import OpenRouterClient from './openrouter.js';
import CCLocalStorage from '../local-storage.js';
import { ccLogger, AICallerModels } from '../../global.js';


class AICaller {
    constructor() {
        this.openrouter = OpenRouterClient;
        this.ollama = OllamaClient;
        this.defaultProvider = '';
        this.disabledProviders = new Set();
        this.init();
    }

    async init() {
        ccLogger.group('Initializing AI Caller');
        try {
            const providers = await Promise.all([
                this.openrouter.isAvailable(),
                this.ollama.isAvailable()
            ]);

            // Prioritize OpenRouter over Ollama
            if(providers[0]) {
                ccLogger.info('OpenRouter is available, setting as default provider');
                this.setDefaultProvider('openrouter');
            } else if(providers[1]) {
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
        if(provider !== 'ollama' && provider !== 'openrouter' && provider !== 'local') {
            throw new Error('Invalid provider. Must be "ollama", "openrouter", or "local"');
        }
        if(provider == 'local')
            throw new Error('No local AI provider available, yet...', { details: "no_provider" });

        ccLogger.info(`Setting default provider to: ${provider}`);
        this.defaultProvider = provider;
    }

    async setOpenRouterKey(key, testOnly = false, save = false) {
        ccLogger.group('Setting OpenRouter API Key');
        try {
            await this.openrouter.testKey(key);

            if(!testOnly) {
                this.openrouter.setApiKey(key, save);
                this.setDefaultProvider('openrouter');
                ccLogger.info('OpenRouter API key set successfully');
                if(save) {
                    ccLogger.info('OpenRouter API key saved to storage');
                }
            }
            ccLogger.groupEnd();
            return true;
        } catch (error) {
            ccLogger.error('Failed to set OpenRouter API key:', error);
            ccLogger.groupEnd();
            throw error;
        }
    }

    getClient(provider = null) {
        provider = provider || this.defaultProvider;

        if (this.disabledProviders.has(provider)) {
            throw new Error(`Provider ${provider} is temporarily disabled`);
        }

        if (provider === 'openrouter' && !this.openrouter.isAvailable()) {
            throw new Error('OpenRouter API key not set');
        }

        if (provider === 'ollama' && !this.ollama.isAvailable()) {
            throw new Error('Ollama is not available');
        }

        if(provider === 'openrouter') {
            return this.openrouter;
        } else if(provider === 'ollama') {
            return this.ollama;
        }
    }

    async autocompleteSuggestions(commandBarInput, commandHistory, context) {
        ccLogger.group('Generating Autocomplete');
        let systemPrompt = `You are an AI that autocompletes commands in a command bar built to complete tasks for the user.`;
        systemPrompt += `\nCommand history:\n${commandHistory.join('\n')}`;
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

        let provider = 'ollama';

        const [suggestion, details] = await this.chatCompletion(messages, null, AICallerModels['AUTOCOMPLETE'][provider], provider, null, null, 0.4);
        ccLogger.debug('Autocomplete result:', {
            input: commandBarInput,
            suggestion,
            provider
        });

        try {
            if (!suggestion || typeof suggestion !== 'string') {
                ccLogger.error('Invalid suggestion received from AI');
                ccLogger.groupEnd();
                return [];
            }

            try {
                const directJson = JSON.parse(suggestion);
                if (Array.isArray(directJson) && this.validateSuggestions(directJson)) {
                    ccLogger.debug('Parsed direct JSON response');
                    ccLogger.groupEnd();
                    return directJson;
                }
            } catch (e) {
                ccLogger.debug('Not direct JSON, trying backticks format');
            }

            const backtickMatch = suggestion.match(/\`\`\`([\S\s\W\w]*)\`\`\`/m);
            if (!backtickMatch || !backtickMatch[1]) {
                ccLogger.warn('No content found between backticks, attempting to format raw response');
                return this.formatFallbackSuggestion(suggestion);
            }

            let jsonString = backtickMatch[1];

            if (jsonString.startsWith('json')) {
                jsonString = jsonString.substring(4);
            }

            let json = JSON.parse(jsonString.trim());

            if (!Array.isArray(json)) {
                ccLogger.warn('Response is not an array, converting to array format');
                return this.formatFallbackSuggestion(JSON.stringify(json));
            }

            if (this.validateSuggestions(json)) {
                ccLogger.debug('Successfully parsed and validated JSON response');

                if (json.length > 0 && typeof json[0] === 'string') {
                    json = json.map(item => ({ text: item }));
                }

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

        if (suggestions.length > 0 && typeof suggestions[0] === 'string') {
            return suggestions.every(item => typeof item === 'string' && item.trim().length > 0);
        }

        return suggestions.every(item =>
            item &&
            typeof item === 'object' &&
            typeof item.text === 'string' &&
            item.text.trim().length > 0
        );
    }

    formatFallbackSuggestion(rawText) {
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

        if (typeof modelType === 'string') {
            return modelType;
        }

        if(modelType[this.defaultProvider]) {
            return modelType[this.defaultProvider];
        }

        ccLogger.warn(`Model type not found for provider ${this.defaultProvider}, defaulting to FAST model.`);
        return AICallerModels['FAST'][this.defaultProvider];
    }

    supportsFeature(feature, provider = null) {
        provider = provider || this.defaultProvider;
        const features = {
            vision: {
                ollama: true,
                openrouter: true
            },
            streaming: {
                ollama: true,
                openrouter: true
            },
            tools: {
                ollama: true,
                openrouter: true
            },
            imageGeneration: {
                ollama: false,
                openrouter: true
            }
        };

        const supported = features[feature]?.[provider] || false;
        ccLogger.debug(`Feature check: ${feature} for ${provider} = ${supported}`);
        return supported;
    }

    async generateImage(prompt, size = '1024x1024', n = 1, model = null, provider = null) {
        ccLogger.group('Generate Image');
        provider = provider || this.defaultProvider;

        if (!this.supportsFeature('imageGeneration', provider)) {
            const errorMsg = `Image generation is not supported by the current provider: ${provider}`;
            ccLogger.error(errorMsg);
            ccLogger.groupEnd();
            throw new Error(errorMsg);
        }

        const client = this.getClient(provider);
        const actualModel = model || this.getModelForProvider(AICallerModels['IMAGE'] || null);

        ccLogger.debug('Starting image generation:', {
            provider,
            model: actualModel,
            prompt: prompt.substring(0, 50) + '...',
            size,
            n
        });

        try {
            const result = await client.generateImage(
                prompt,
                size,
                n,
                actualModel
            );
            ccLogger.info('Image generation completed successfully');
            ccLogger.groupEnd();
            return result;
        } catch (error) {
            ccLogger.error('Image generation failed:', error);
            ccLogger.groupEnd();
            throw error;
        }
    }

    disableProvider(provider) {
        ccLogger.info(`Disabling provider: ${provider}`);
        this.disabledProviders.add(provider);

        if (provider === this.defaultProvider) {
            if (provider === 'openrouter' && !this.disabledProviders.has('ollama') && this.ollama.isAvailable()) {
                this.setDefaultProvider('ollama');
            } else if (provider === 'ollama' && !this.disabledProviders.has('openrouter') && this.openrouter.isAvailable()) {
                this.setDefaultProvider('openrouter');
            }
        }
    }

    enableProvider(provider) {
        ccLogger.info(`Enabling provider: ${provider}`);
        this.disabledProviders.delete(provider);

        if (provider === 'openrouter' && this.defaultProvider === 'ollama') {
            this.setDefaultProvider('openrouter');
        }
    }
}

// Export a singleton instance
export { AICallerModels };

export default new AICaller();
