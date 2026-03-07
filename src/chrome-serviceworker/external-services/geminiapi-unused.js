import CCLocalStorage from '../local-storage.js';
import { ccLogger } from '../../global.js';
// Imports might need adjustment based on actual Gemini SDK usage if available in this environment
// For now, we'll simulate the API calls with fetch

class GeminiClient {
    static FAST_MODEL = "gemini-1.5-flash-latest"; // Example model
    static REASON_MODEL = "gemini-1.5-pro-latest"; // Example model
    static VISION_MODEL = "gemini-pro-vision"; // Example model (adjust if needed)
    static isAvailable = null;

    constructor() {
        this.apiKey = '';
        this.defaultModel = GeminiClient.FAST_MODEL;
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    }

    async setApiKey(key, save = false) {
        ccLogger.debug('Setting Gemini API key', save);
        this.apiKey = key;
        GeminiClient.isAvailable = (key && key.length > 0);
        if (save) {
            await CCLocalStorage.setEncrypted('gemini-key', key);
        }
    }

    async isAvailable() {
        if (GeminiClient.isAvailable == null) {
            try {
                const key = await CCLocalStorage.getEncrypted('gemini-key');
                GeminiClient.isAvailable = (key && key.length > 0);
                if (GeminiClient.isAvailable) {
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
            // Test by listing models, a common endpoint
            const response = await fetch(`${this.baseUrl}?key=${key}`);

            if (!response.ok) {
                let errorMsg = 'Invalid API key or API error';
                try {
                    const errorJson = await response.json();
                    errorMsg = errorJson.error?.message || errorMsg;
                } catch (e) { /* Ignore parsing error */ }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            const isValid = data.models && data.models.length > 0;
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
        // Configuration for fetch or a dedicated HTTP client if used
        return {
            timeout: 5 * 60 * 1000 // 5 minutes
        };
    }

    async getModelsList() {
        ccLogger.debug('Fetching Gemini models list');
        if (!this.apiKey) {
             ccLogger.error('Gemini API key not set');
             return [];
        }
        try {
            const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`);
             if (!response.ok) {
                let errorMsg = 'Failed to fetch models';
                try {
                    const errorJson = await response.json();
                    errorMsg = errorJson.error?.message || errorMsg;
                } catch (e) { /* Ignore parsing error */ }
                 ccLogger.error(errorMsg);
                return [];
            }
            const data = await response.json();
            ccLogger.debug(`Found ${data.models?.length || 0} models`);
            // Filter for generative models if needed, or return all
            return data.models?.filter(m => m.supportedGenerationMethods?.includes('generateContent')) || [];
        } catch (error) {
            ccLogger.error('Error fetching Gemini models list:', error);
            return [];
        }
    }

    // Converts Sandbox tool format to Gemini API format
    localToolFromSbTool(tool) {
        ccLogger.debug('Converting tool format for Gemini:', tool.name);

        // Basic validation
        if (!tool || !tool.name || !tool.description) {
            ccLogger.warn('Invalid tool object passed for conversion:', tool);
            return null;
        }

        const properties = {};
        const required = tool.parameters?.required || [];

        if (tool.parameters?.properties) {
            for (const [paramKey, param] of Object.entries(tool.parameters.properties)) {
                if (!param) {
                    ccLogger.warn(`Skipping invalid parameter definition for key ${paramKey} in tool ${tool.name}`);
                    continue;
                }
                // Gemini uses specific types like STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT
                // Mapping common types
                let geminiType = 'STRING'; // Default to STRING
                 if (param.type === 'string') geminiType = 'STRING';
                 else if (param.type === 'number') geminiType = 'NUMBER';
                 else if (param.type === 'integer') geminiType = 'INTEGER';
                 else if (param.type === 'boolean') geminiType = 'BOOLEAN';
                 else if (param.type === 'array') geminiType = 'ARRAY'; // Needs items definition
                 else if (param.type === 'object') geminiType = 'OBJECT'; // Needs properties definition

                properties[paramKey] = {
                    type: geminiType,
                    description: param.description || '',
                    // Include items for arrays or properties for objects if needed
                    ...(geminiType === 'ARRAY' && param.items ? { items: { type: param.items.type?.toUpperCase() || 'STRING' } } : {}),
                    ...(geminiType === 'OBJECT' && param.properties ? { properties: param.properties } : {}) // Recursion might be needed for complex objects
                };
            }
        }

        return {
             name: tool.name.replace(/[^a-zA-Z0-9_]/g, '_'), // Ensure valid naming convention
            description: tool.description,
            parameters: {
                type: 'OBJECT', // Standard for Gemini function parameters
                properties: properties,
                ...(required.length > 0 && { required: required })
            }
        };
    }


     // Main method for chat completions, including function calling
    async chatCompletion(messages, chunkedOutput, model, toolCaller = null, tools = null, temp = 0.9, keepAlive = "30m") { // keepAlive might not be directly applicable to Gemini API
        ccLogger.group('Gemini Chat Completion');
        const startTime = Date.now();
        let output = '';
        let selectedModel = model || this.defaultModel;

        ccLogger.debug('Starting chat completion:', {
            model: selectedModel,
            toolCount: tools?.length,
            temperature: temp
        });

         if (!await this.isAvailable()) {
             ccLogger.error('Gemini API key not set or client unavailable.');
             ccLogger.groupEnd();
             throw new Error('Gemini client is not available. Please set API key.');
         }

        // Convert messages to Gemini format (user, model roles)
        let geminiMessages = messages.map(msg => {
            let role = msg.role === 'assistant' ? 'model' : msg.role; // Map assistant to model
             if (role === 'system') {
                 // Gemini prefers system instructions at the start or via specific parameters,
                 // Here we'll prepend it to the first user message or handle it separately.
                 // For simplicity, we'll combine with the first user message if possible,
                 // or just send it as a 'user' message initially.
                 // A better approach might involve a dedicated system_instruction parameter if the API supports it.
                 role = 'user'; // Treat system as user for now
             }

            // Handle tool calls and results if present
            if (msg.role === 'tool') {
                return {
                     role: 'function', // Gemini uses 'function' role for tool results
                     parts: [{
                         functionResponse: {
                             name: msg.tool_call_id, // Assuming tool_call_id corresponds to the function name called
                             response: {
                                // The content should ideally be structured according to the tool's output schema
                                // For now, we'll assume the content is the result.
                                name: msg.tool_call_id, // Repeat name here as per Gemini structure
                                 content: msg.content // Content contains the result from the tool
                             }
                         }
                     }]
                 };
             } else if (msg.role === 'assistant' && msg.tool_calls) {
                 // Convert assistant message with tool calls to Gemini format
                 return {
                     role: 'model',
                     parts: msg.tool_calls.map(tc => ({
                         functionCall: {
                             name: tc.function.name,
                             args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
                         }
                     }))
                 };
             } else {
                 // Standard user or model message
                 return {
                     role: role,
                     parts: [{ text: msg.content }]
                 };
             }
        }).filter(Boolean); // Remove any null entries


        // Filter out consecutive messages with the same role if necessary (Gemini requires alternating roles generally)
         geminiMessages = this.ensureAlternatingRoles(geminiMessages);


        let completionResult = null;
        let allToolCalls = []; // Store all tool calls made during the conversation turn

        do {
            completionResult = null; // Reset for potential multi-turn tool calls
            const requestBody = {
                contents: geminiMessages,
                generationConfig: {
                    temperature: temp,
                    // maxOutputTokens, topP, topK could be added here
                },
                ...(tools && tools.length > 0 && { tools: [{ functionDeclarations: tools }] }) // Add tools if provided
            };

            ccLogger.debug('Sending request to Gemini:', JSON.stringify(requestBody, null, 2));

            const stream = true; // Use streaming by default
            const response = await fetch(`${this.baseUrl}/${selectedModel}:streamGenerateContent?key=${this.apiKey}&alt=sse`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                 let errorMsg = `Gemini API Error (${response.status})`;
                 try {
                     const errorJson = await response.json();
                     errorMsg += `: ${errorJson.error?.message || 'Unknown error'}`;
                 } catch (e) { /* Ignore parsing error */ }
                 ccLogger.error(errorMsg);
                 ccLogger.groupEnd();
                 throw new Error(errorMsg);
            }


             if (!stream) { // Non-streaming logic (simplified, usually streaming is preferred)
                 const data = await response.json();
                 ccLogger.debug('Received non-streamed response:', data);
                 // Process data.candidates[0].content.parts
                 // ... implementation for non-streaming ...
                 ccLogger.groupEnd();
                 return ["Non-streaming not fully implemented", data]; // Placeholder
             }


            // Streaming logic
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let currentOutput = '';
            let currentToolCalls = [];
            let done = false;


             while (!done) {
                 const { value, done: readerDone } = await reader.read();
                 done = readerDone;
                 if (done) break;

                 const chunk = decoder.decode(value);
                 // SSE format needs careful parsing - multiple events might be in one chunk
                 const lines = chunk.split('\n');
                 for (const line of lines) {
                     if (line.startsWith('data: ')) {
                         try {
                             const jsonData = JSON.parse(line.substring(6));
                            // ccLogger.debug('Received stream chunk:', jsonData); // Can be very verbose

                             if (jsonData.candidates && jsonData.candidates.length > 0) {
                                 const content = jsonData.candidates[0].content;
                                 if (content && content.parts) {
                                     for (const part of content.parts) {
                                         if (part.text) {
                                             currentOutput += part.text;
                                             chunkedOutput?.(part.text); // Stream text chunks
                                         } else if (part.functionCall) {
                                             // Accumulate function calls from the stream
                                             ccLogger.debug('Received function call chunk:', part.functionCall);
                                             // Note: Gemini streams the *entire* function call object in chunks,
                                             // unlike OpenAI which streams arguments piece by piece.
                                             // We need to collect these calls. Let's assume one call per part for now.
                                             currentToolCalls.push({
                                                 id: `gemini_call_${Date.now()}_${Math.random().toString(16).slice(2)}`, // Generate a unique ID
                                                 name: part.functionCall.name,
                                                 arguments: part.functionCall.args || {} // Gemini uses 'args'
                                             });
                                             // Emit a placeholder chunk? Gemini might not chunk tool calls this way.
                                             // The official SDK might abstract this. Simulating based on structure.
                                              chunkedOutput?.({ type: 'TOOL_CALL_START', payload: { name: part.functionCall.name } });
                                         }
                                     }
                                 }
                             }
                            // Check for finish reason if available in the chunk structure
                            const finishReason = jsonData.candidates?.[0]?.finishReason;
                            if (finishReason && finishReason !== 'STOP') {
                                ccLogger.debug(`Stream finished with reason: ${finishReason}`);
                                // Could be MAX_TOKENS, SAFETY, RECITATION, OTHER
                            }

                         } catch (e) {
                             ccLogger.error('Error parsing stream JSON:', e, line);
                         }
                     }
                 }
             }

             output += currentOutput; // Add final text output from this turn

             // Process accumulated function calls after stream ends for this turn
            if (currentToolCalls.length > 0 && toolCaller) {
                 ccLogger.info(`Executing ${currentToolCalls.length} tool calls.`);
                 // Add the model's turn (containing the tool calls) to messages
                 geminiMessages.push({
                     role: 'model',
                     parts: currentToolCalls.map(tc => ({
                         functionCall: { name: tc.name, args: tc.arguments }
                     }))
                 });


                 const toolResults = [];
                 for (const toolCall of currentToolCalls) {
                    allToolCalls.push(toolCall); // Track all calls
                    ccLogger.debug(`Calling tool: ${toolCall.name} with args:`, toolCall.arguments);
                    chunkedOutput?.({
                        type: 'TOOL_CALL_CHUNK',
                        payload: {
                             id: toolCall.id, // Use generated ID
                             name: toolCall.name,
                             arguments: JSON.stringify(toolCall.arguments),
                             callStarted: true,
                             callFinished: false
                         }
                    });

                    let toolResultContent = null;
                    try {
                         // IMPORTANT: The toolCaller interface needs standardization across clients.
                         // Assuming toolCaller expects { name, arguments } and returns { result } or throws error.
                         const result = await toolCaller({ name: toolCall.name, arguments: toolCall.arguments });
                         toolResultContent = result.result; // Assuming the result structure
                         ccLogger.debug(`Tool ${toolCall.name} returned:`, toolResultContent);

                         chunkedOutput?.({
                             type: 'TOOL_CALL_CHUNK',
                             payload: {
                                 id: toolCall.id,
                                 name: toolCall.name,
                                 arguments: JSON.stringify(toolCall.arguments), // Keep args for context
                                 result: JSON.stringify(toolResultContent), // Send result back
                                 callStarted: false, // Or keep true if needed?
                                 callFinished: true
                             }
                         });

                    } catch (error) {
                        ccLogger.error(`Error executing tool ${toolCall.name}:`, error);
                        toolResultContent = { error: `Tool execution failed: ${error.message}` };

                         chunkedOutput?.({
                             type: 'TOOL_CALL_CHUNK',
                             payload: {
                                 id: toolCall.id,
                                 name: toolCall.name,
                                 arguments: JSON.stringify(toolCall.arguments),
                                 result: JSON.stringify(toolResultContent), // Send error back
                                 callStarted: false,
                                 callFinished: true,
                                 isError: true
                             }
                         });
                    }


                     // Add the tool result message for the next API call
                     toolResults.push({
                         role: 'function', // Gemini uses 'function' role for tool results
                         parts: [{
                             functionResponse: {
                                 name: toolCall.name, // Match the call name
                                 response: {
                                     // The response structure should ideally match the tool's schema.
                                     // Sending the raw result content for now.
                                     name: toolCall.name, // Gemini FunctionResponse needs name repeated
                                     content: toolResultContent // Send back the result (or error object)
                                 }
                             }
                         }]
                     });
                 }
                 // Add all tool results to messages for the next iteration
                 geminiMessages.push(...toolResults);
                 // Ensure roles alternate before the next loop iteration
                 geminiMessages = this.ensureAlternatingRoles(geminiMessages);

            } else {
                // No tool calls, break the loop
                completionResult = { message: { content: output }, tool_calls: [] }; // Mimic OpenAI structure for return
                break;
             }


         } while (toolCaller && currentToolCalls.length > 0); // Continue if tools were called and a caller exists


         // Final processing after loop (if it breaks naturally)
         if (!completionResult) {
            // If the loop finished because no more tool calls were made in the last turn
            completionResult = { message: { content: output }, tool_calls: allToolCalls };
             // Add the final model response to messages history if needed
            if (output) {
                geminiMessages.push({ role: 'model', parts: [{ text: output }]});
            }
        }

        const elapsed = Date.now() - startTime;
        ccLogger.info(`Gemini chat completion finished in ${elapsed}ms`);
        ccLogger.debug('Final Gemini messages:', JSON.stringify(geminiMessages, null, 2));
        ccLogger.debug('Final output text:', output);
        ccLogger.debug('Total tool calls made:', allToolCalls);
        ccLogger.groupEnd();

        // Return structure similar to other clients: [final_text_output, final_api_response_token, updated_messages_array]
        // Note: The 'token' part is less defined for Gemini stream, returning the last completion result structure.
        return [output, completionResult, geminiMessages];
    }

    // Helper to ensure messages alternate between 'user' and 'model'/'function' roles
    ensureAlternatingRoles(messages) {
        if (messages.length < 2) return messages;

        const correctedMessages = [messages[0]];
        for (let i = 1; i < messages.length; i++) {
            const prevMsg = correctedMessages[correctedMessages.length - 1];
            const currMsg = messages[i];

            // Check if previous and current roles are the same non-'function' role
            // Gemini allows consecutive 'function' (tool result) roles after a 'model' (tool call) role.
             if (currMsg.role !== 'function' && prevMsg.role === currMsg.role) {
                 ccLogger.warn(`Correcting consecutive ${currMsg.role} roles. Merging or adjusting.`);
                 // Simple strategy: Combine text content if possible, otherwise might need more complex logic
                 if (prevMsg.parts?.[0]?.text && currMsg.parts?.[0]?.text) {
                     prevMsg.parts[0].text += `
${currMsg.parts[0].text}`;
                 } else {
                    // Cannot easily merge (e.g., tool calls involved), log and keep separate
                    // This might still violate API rules, proper handling depends on context
                    ccLogger.warn(`Could not merge consecutive ${currMsg.role} roles. Keeping separate.`);
                    correctedMessages.push(currMsg);
                 }
            } else {
                correctedMessages.push(currMsg);
            }
        }
        return correctedMessages;
    }

}

export default new GeminiClient(); 