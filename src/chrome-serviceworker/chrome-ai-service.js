import AICaller from './external-services/caller.js';


let currentToolResolvePromise = null;
let setOpenAIKeyIndex = 0;

const ccLogMessage = (...args) => {
    console.log('[CarbonCommander]', ...args);
}

const ccLogError = (...args) => {
    console.error('[CarbonCommander]', ...args);
}


function toggleCarbonBar() {
    window.postMessage({ type: "TOGGLE_CARBONBAR" }, "*");
}
  
// Optional: Handle extension installation/updates
chrome.runtime.onInstalled.addListener(() => {
    ccLogMessage('CarbonCommander installed/updated');
    // You could initialize any extension settings here
});
  
chrome.action.onClicked.addListener((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: toggleCarbonBar
    })
})





const toolCaller = async (tool) => {
  try {
    ccLogMessage('toolCaller', tool);
    
    // Send message to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        throw new Error('No active tab found');
    }

    const currentToolPromise = new Promise((resolve) => {
        currentToolResolvePromise = resolve;
        chrome.tabs.sendMessage(tab.id, {
            type: 'AI_EXECUTE_TOOL',
            payload: {
                tool: tool
            }
        });
    });

    const result = await currentToolPromise;
    if(!result.success) {
      ccLogMessage('toolCallerResult', result, tool);
      //throw new Error(JSON.stringify(result));
    }

    ccLogMessage('toolCallerResult', result, tool);
    // Add tool ID to the response
    return {
        ...result,
        tool_call_id: tool.id
    };
  } catch (error) {
    ccLogError('Error in toolCaller:', error);
    throw error;
  }
};

async function handleAIRequest(tabId, request) {
    try {
        // Check if tab exists before proceeding
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            throw new Error('Tab no longer exists');
        }

        if(AICaller.defaultProvider == '' || AICaller.defaultProvider == null) {
            throw new Error('NO_AI_PROVIDER');
        }

        const [response, token, messages] = await AICaller.chatCompletion(
            request.messages,
            (chunk) => {

              ccLogMessage('[handleAIRequest] CHUNK:', chunk);
              const formattedChunk = {
                type: 'AI_RESPONSE_CHUNK',
                payload: {
                    content: chunk,
                    isFinished: typeof chunk === 'object' ? chunk.finish_reason == 'tool_calls' : false
                }
              };
              chrome.tabs.sendMessage(tabId, formattedChunk);
            },
            request.model,
            request.provider,
            toolCaller,
            request.tools,
            request.temp,
            request.keepAlive
        );

        // Send final chunk to indicate completion
        await chrome.tabs.sendMessage(tabId, {
            type: 'AI_RESPONSE_CHUNK',
            payload: {
                content: '',
                isFinished: true,
                messages: messages
            }
        });

        return [response, token, messages];
    } catch (error) {
        ccLogError('Error in AI request:', error.message, error.details);
        var messages = [...request.messages];
        messages.push({ role: 'assistant', content: error.message });
        // Send error message to tab
        await chrome.tabs.sendMessage(tabId, {
            type: 'AI_RESPONSE_ERROR',
            payload: {
                content: error.message,
                isFinished: true,
                error: true,
                messages: messages
            }
        });
        throw error;
    }
}

// Consolidate message listeners into one
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    ccLogMessage('Background received message:', message);

    if (message.type === 'AI_TOOL_RESPONSE') {
        ccLogMessage('Received AI_TOOL_RESPONSE', message.payload);
        if (currentToolResolvePromise) {
            currentToolResolvePromise(message.payload);
            currentToolResolvePromise = null;
        }
        return true;
    }

    // Add handler for confirmation dialog responses
    if (message.type === 'CONFIRMATION_DIALOG_RESPONSE') {
        ccLogMessage('Received CONFIRMATION_DIALOG_RESPONSE', message.payload);
        if (currentToolResolvePromise) {
            currentToolResolvePromise({success: true, result: message.payload});
            currentToolResolvePromise = null;
        }
        return true;
    }

    // Add handler for input dialog responses
    if (message.type === 'INPUT_DIALOG_RESPONSE') {
        ccLogMessage('Received INPUT_DIALOG_RESPONSE', message.payload);
        if (currentToolResolvePromise) {
            currentToolResolvePromise({success: true, result: message.payload});
            currentToolResolvePromise = null;
        }
        return true;
    }

    if (message.type === 'AI_REQUEST') {
        handleAIRequest(sender.tab.id, message.payload)
            .then(response => {
                ccLogMessage('AI response:', response);
                sendResponse(response);
            })
            .catch(error => {
                ccLogError('Error:', error);
                sendResponse({ error: error.message || 'Unknown error' });
            });
        return true; // Keep message channel open
    }

    if (message.type === 'GET_TAB_ID') {
        sendResponse({ tabId: sender.tab.id });
        return true;
    }

    if (message.type === 'GET_AUTOCOMPLETE') {
        const { input, commandHistory, context } = message.payload;
        
        AICaller.autocomplete(input, commandHistory, context)
            .then(suggestion => {
                sendResponse(suggestion);
            })
            .catch(error => {
                ccLogError('Autocomplete error:', error);
                sendResponse(null);
            });
        return true;
    }

    if (message.type === 'SET_OPENAI_KEY') {
        (async () => {
            setOpenAIKeyIndex++;
            ccLogMessage('SET_OPENAI_KEY2', message.payload);
            try {
                const success = await AICaller.setOpenAIKey(message.payload.key);
                if (success) {
                    // Send provider status update
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: 'PROVIDER_STATUS_UPDATE',
                        provider: 'openai',
                        status: true
                    });
                }
                sendResponse({ success });
            } catch (error) {
                ccLogError('Error setting OpenAI key:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.type === 'CHECK_OLLAMA_AVAILABLE') {
        try {
            AICaller.ollama.isAvailable().then(isAvailable => {
                sendResponse({ available: isAvailable, noAIMode: message.payload?.noAIMode });
            });
        } catch (error) {
            ccLogError('Error checking Ollama:', error);
            sendResponse({ available: false });
        }
        return true;
    }

    if (message.type === 'REINITIALIZE_AI_CALLER') {
        AICaller.reinitialize().then(newProvider => {
            ccLogMessage('AICaller reinitialized with provider:', newProvider);
            sendResponse({ success: true, provider: newProvider });
        });
        return true;
    }

    if (message.type === 'TOGGLE_PROVIDER') {
        const { provider, enabled } = message.payload;
        if (provider === 'openai') {
            if (!enabled) {
                // Temporarily disable OpenAI
                AICaller.disableProvider('openai');
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'PROVIDER_STATUS_UPDATE',
                    provider: 'openai',
                    status: false
                });
            } else {
                // Re-enable OpenAI if we have a key
                AICaller.enableProvider('openai');
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'PROVIDER_STATUS_UPDATE',
                    provider: 'openai',
                    status: true
                });
            }
        }
        sendResponse({ success: true });
        return true;
    }

    return false;
});