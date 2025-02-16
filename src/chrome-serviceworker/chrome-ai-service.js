import AICaller from './external-services/caller.js';


let currentToolResolvePromise = null;
let setOpenAIKeyIndex = 0;

const ccLogMessage = (...args) => {
    console.log('[CCSW]', ...args);
}

const ccLogError = (...args) => {
    console.error('[CCSW]', ...args);
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

function sendMessageToTab(tabId, authToken, type, payload) {
    if(!type.startsWith('CARBON_')) {
        type = 'CARBON_' + type;
    }
    ccLogMessage('Sending message to tab:', tabId, type, payload, 'authToken:', authToken);
    chrome.tabs.sendMessage(tabId, {
        type: type,
        payload: payload,
        _authToken: authToken,
        fromServiceWorker: true
    }).then((response) => {
        ccLogMessage('Message sent to tab:', response);
    }).catch((error) => {
        ccLogError('Error sending message to tab:', error);
    });
}



const toolCaller = async (tabId, authToken, tool) => {
  try {
    ccLogMessage('toolCaller', tool);
    
    // Send message to content script
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
        throw new Error('Tab no longer exists');
    }

    const currentToolPromise = new Promise((resolve) => {
        currentToolResolvePromise = resolve;
        sendMessageToTab(tabId, authToken, 'AI_EXECUTE_TOOL', {
            tool: tool
        });
    });

    const result = await currentToolPromise;
    if(!result.success) {
      ccLogMessage('toolCallerResult1', result, tool);
      //throw new Error(JSON.stringify(result));
    }

    const response = {
        ...result,
        tool_call_id: tool.id
    };
    ccLogMessage('toolCallerResult2', response, tool, result);
    // Add tool ID to the response
    return response;
  } catch (error) {
    ccLogError('Error in toolCaller:', error);
    throw error;
  }
};

async function handleAIRequest(tabId, authToken, request) {
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
              sendMessageToTab(tabId, authToken, 'AI_CHUNK_RESPONSE', {
                content: chunk,
                isFinished: typeof chunk === 'object' ? chunk.finish_reason == 'tool_calls' : false
              });
            },
            request.model,
            request.provider,
            (tool) => toolCaller(tabId, authToken, tool),
            request.tools,
            request.temp,
            request.keepAlive
        );

        // Send final chunk to indicate completion
        sendMessageToTab(tabId, authToken, 'AI_CHUNK_RESPONSE', {
            content: '',
            isFinished: true,
            messages: messages
        });

        return [response, token, messages];
    } catch (error) {
        ccLogError('Error in AI request:', error.message, error.details);
        var messages = [...request.messages];
        messages.push({ role: 'assistant', content: error.message });
        // Send error message to tab
        sendMessageToTab(tabId, authToken, 'AI_ERROR_RESPONSE', {
            content: error.message,
            isFinished: true,
            error: true,
            messages: messages
        });
        throw error;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let unprefixedType = message.type.replace('CARBON_', '');
    if (unprefixedType === 'GET_TAB_ID') {
        sendResponse({ tabId: sender.tab.id });
        return true;
    }

    if (unprefixedType === 'CHECK_OLLAMA_AVAILABLE') {
        try {
            ccLogMessage('Checking Ollama availability');
            AICaller.ollama.isAvailable().then(isAvailable => {
                sendResponse({ available: isAvailable, noAIMode: message.payload?.noAIMode });
            }).catch(error => {
                ccLogError('Error checking Ollama:', error);
                sendResponse({ available: false });
            });
        } catch (error) {
            ccLogError('Error checking Ollama:', error);
            sendResponse({ available: false });
        }
        return true;
    }

    if (unprefixedType === 'CHECK_OPENAI_AVAILABLE') {
        try {
            ccLogMessage('Checking OpenAI availability');
            AICaller.openai.isAvailable().then(isAvailable => {
                sendResponse({ available: isAvailable, noAIMode: message.payload?.noAIMode });
            }).catch(error => { 
                ccLogError('Error checking OpenAI:', error);
                sendResponse({ available: false });
            });
        } catch (error) {
            ccLogError('Error checking OpenAI:', error);
            sendResponse({ available: false });
        }
        return true;
    }
    
    if(!message.type || !message.type.startsWith('CARBON_')) {
        ccLogMessage('Received non-CARBON message (BAD):', message);
        return;
    }


    ccLogMessage('Background received message:', unprefixedType, message);

    if (unprefixedType === 'AI_TOOL_RESPONSE') {
        ccLogMessage('Received AI_TOOL_RESPONSE', message.payload);
        if (currentToolResolvePromise) {
            currentToolResolvePromise(message.payload);
            currentToolResolvePromise = null;
        }
        return true;
    }

    // Add handler for confirmation dialog responses
    if (unprefixedType === 'CONFIRMATION_DIALOG_RESPONSE') {
        ccLogMessage('Received CONFIRMATION_DIALOG_RESPONSE', message.payload);
        if (currentToolResolvePromise) {
            currentToolResolvePromise({success: true, result: message.payload});
            currentToolResolvePromise = null;
        }
        return true;
    }

    // Add handler for input dialog responses
    if (unprefixedType === 'INPUT_DIALOG_RESPONSE') {
        ccLogMessage('Received INPUT_DIALOG_RESPONSE', message.payload);
        if (currentToolResolvePromise) {
            currentToolResolvePromise({success: true, result: message.payload});
            currentToolResolvePromise = null;
        }
        return true;
    }

    if (unprefixedType === 'AI_REQUEST') {
        handleAIRequest(sender.tab.id, message.authToken, message.payload)
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



    if (unprefixedType === 'GET_AUTOCOMPLETE') {
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

    if (unprefixedType === 'SET_OPENAI_KEY') {
        (async () => {
            setOpenAIKeyIndex++;
            ccLogMessage('SET_OPENAI_KEY2', message.payload);
            try {
                const success = await AICaller.setOpenAIKey(message.payload.key, message.payload.test, message.payload.save);
                if (success && !message.payload.test) {
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



    if (unprefixedType === 'REINITIALIZE_AI_CALLER') {
        AICaller.reinitialize().then(newProvider => {
            ccLogMessage('AICaller reinitialized with provider:', newProvider);
            sendResponse({ success: true, provider: newProvider });
        });
        return true;
    }

    if (unprefixedType === 'TOGGLE_PROVIDER') {
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

    const newMessage = message.payload;

    ccLogMessage('Sending message to tab:', newMessage);

    sendResponse(newMessage);
    return false;
});