import OllamaClient from './ollama.js';
import OpenAIClient from './openai.js';
import GeminiClient from './gemini.js';
import CCLocalStorage from '../local-storage.js';
import { ccLogger, AICallerModels } from '../../global.js';


class AICaller {
    constructor() {
        this.openai = OpenAIClient;
        this.ollama = OllamaClient;
        this.gemini = GeminiClient;
        this.defaultProvider = '';
        this.disabledProviders = new Set();
        this.init();
    }

    async init() {
        ccLogger.group('Initializing AI Caller');
        try {            


            //check all providers at once with promises
            const providers = await Promise.all([
                this.openai.isAvailable(),
                this.gemini.isAvailable(),
                this.ollama.isAvailable()
            ]);
            
            const result = await providers;

            // Prioritize OpenAI over Ollama if both are available
            if(result[0]) {
                ccLogger.info('OpenAI is available, setting as default provider');
                this.setDefaultProvider('openai');
            } else if(result[1]) {
                ccLogger.info('Gemini is available, setting as default provider');
                this.setDefaultProvider('gemini');
            } else if(result[2]) {
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
        if(provider !== 'ollama' && provider !== 'openai' && provider !== 'local' && provider !== 'gemini') {
            throw new Error('Invalid provider. Must be either "ollama" or "openai" or "local" or "gemini"');
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

    async setGeminiKey(key, testOnly = false, save = false) {
        ccLogger.group('Setting Gemini API Key');
        try {
            // Test the key before setting it
            await this.gemini.testKey(key);
            
            if(!testOnly) {
                // If test passes, set it in the Gemini client
                this.gemini.setApiKey(key, save);
                this.setDefaultProvider('gemini');
                ccLogger.info('Gemini API key set successfully');
                if(save) {
                    ccLogger.info('Gemini API key saved to storage');
                }
            }
            ccLogger.groupEnd();
            return true;
        } catch (error) {
            ccLogger.error('Failed to set Gemini API key:', error);
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

        if (provider === 'gemini' && !this.gemini.isAvailable()) {
            throw new Error('Gemini API key not set');
        }

        if (provider === 'ollama' && !this.ollama.isAvailable()) {
            throw new Error('Ollama is not available');
        }

        if(provider === 'openai') {
            return this.openai;
        } else if(provider === 'gemini') {
            return this.gemini;
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
        
        
        let provider = 'ollama';//this.defaultProvider;

        if(provider == 'openai') {
            //disabled for now
            ccLogger.debug('Autocomplete disabled for OpenAI');
            ccLogger.groupEnd();
            return null;
        }

        if(provider == 'gemini') {
            //disabled for now
            ccLogger.debug('Autocomplete disabled for Gemini');
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
            let json = JSON.parse(jsonString.trim());
            
            // Validate the structure
            if (!Array.isArray(json)) {
                ccLogger.warn('Response is not an array, converting to array format');
                return this.formatFallbackSuggestion(JSON.stringify(json));
            }

            if (this.validateSuggestions(json)) {
                ccLogger.debug('Successfully parsed and validated JSON response');
                
                // Convert array of strings to array of objects with text property if needed
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
        
        // Check if we need to convert string array to object array
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
            // Default to FAST model if no type specified
            return AICallerModels['FAST'][this.defaultProvider]; 
        }

        if (typeof modelType === 'string') {
            // If a string is passed, assume it's a specific model name
            return modelType; 
        }

        // If an object map is passed (like AICallerModels.REASON), find the appropriate one
        if(modelType[this.defaultProvider]) {
            return modelType[this.defaultProvider];
        }

        // Fallback to the FAST model for the current provider if the specified type isn't found
        ccLogger.warn(`Model type ${Object.keys(modelType).find(k => modelType[k] === modelType)} not found for provider ${this.defaultProvider}, defaulting to FAST model.`);
        return AICallerModels['FAST'][this.defaultProvider];
    }

    supportsFeature(feature, provider = null) {
        provider = provider || this.defaultProvider;
        // Add 'imageGeneration' feature support check
        const features = {
            vision: {
                ollama: true, // Assuming multimodal models can handle this
                openai: true,
                gemini: true // Assuming multimodal models can handle this
            },
            streaming: {
                ollama: true,
                openai: true,
                gemini: true
            },
            tools: {
                ollama: true,
                openai: true,
                gemini: true
            },
            imageGeneration: {
                ollama: false, // Ollama core API doesn't support image generation directly
                openai: true, // OpenAI supports via DALL-E
                gemini: true // Gemini API supports image generation via Imagen
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
        // Use a dedicated image model if available, otherwise let the client handle defaults
        const actualModel = model || this.getModelForProvider(AICallerModels['IMAGE'] || null);

        ccLogger.debug('Starting image generation:', {
            provider,
            model: actualModel,
            prompt: prompt.substring(0, 50) + '...', // Log truncated prompt
            size,
            n
        });

        try {
            // Size parameter handling:
            // - OpenAI: Uses pixel dimensions (1024x1024, 1792x1024, 1024x1792)
            // - Gemini: Converts pixel dimensions to aspect ratios internally (1:1, 16:9, 9:16, 4:3, 3:4)
            // - Ollama: Not supported in standard API
            const result = await client.generateImage(
                prompt,
                size,
                n,
                actualModel
            );
            ccLogger.info('Image generation completed successfully');
            ccLogger.groupEnd();
            // Expected result format: [{ url: '...' } or { b64_json: '...' }, ...]
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
        
        // If this was the default provider, try to switch to another one, make this better
        if (provider === this.defaultProvider) {
            if (provider === 'openai' && !this.disabledProviders.has('gemini') && this.gemini.isAvailable()) {
                this.setDefaultProvider('gemini');
            } else if (provider === 'gemini' && !this.disabledProviders.has('openai') && this.openai.isAvailable()) {
                this.setDefaultProvider('openai');
            } else {
                this.setDefaultProvider('ollama');
            }
        }
    }

    enableProvider(provider) {
        ccLogger.info(`Enabling provider: ${provider}`);
        this.disabledProviders.delete(provider);
        
        // If OpenAI is being enabled and we're currently using Ollama, switch back to OpenAI
        if (provider === 'openai' && this.defaultProvider === 'ollama') {
            this.setDefaultProvider('openai');
        } else if (provider === 'gemini' && this.defaultProvider === 'ollama') {
            this.setDefaultProvider('gemini');
        }
    }
}

// Export a singleton instance
export { AICallerModels };

export default new AICaller();