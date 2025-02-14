import CCLocalStorage from './local-storage.js';
import { ccLogger } from './global.js';

const inIframe = window.self !== window.top;

async function initializeStorage() {
  try {
    // Load all stored values
    let settings, commandHistory, keybind;
    try {
      [settings, commandHistory, keybind] = await Promise.all([
        CCLocalStorage.get('carbonbar_settings'),
        CCLocalStorage.get('carbonbar_command_history'),
        CCLocalStorage.get('carbonbar_keybind')
      ]);
    } catch (error) {
      ccLogger.error('Error loading storage values:', error);
      settings = {};
      commandHistory = [];
      keybind = { key: 'k', ctrl: true, meta: false };
    }

    // Send all initial values to the window
    try {
      if (settings) {
        window.postMessage({
          type: 'SETTINGS_LOADED',
          payload: settings
        }, window.location.origin);

        // Check for OpenAI key in new location
        if (settings.encryptedKeys?.includes('openai-key')) {
          try {
            const openaiKey = await CCLocalStorage.getEncrypted('encrypted_openai-key');
            if (openaiKey) {
              window.postMessage({
                type: 'PROVIDER_STATUS_UPDATE',
                provider: 'openai',
                status: true
              }, window.location.origin);
            } else {
              // Key was in settings but not found in storage, clean up settings
              try {
                settings.encryptedKeys = settings.encryptedKeys.filter(k => k !== 'openai-key');
                delete settings.keyValuePairs['openai-key'];
                await CCLocalStorage.set('carbonbar_settings', settings);
              } catch (cleanupError) {
                ccLogger.error('Error cleaning up settings:', cleanupError);
              }
            }
          } catch (error) {
            ccLogger.error('Error getting OpenAI key:', error);
            // Try to clean up settings on error
            try {
              settings.encryptedKeys = settings.encryptedKeys.filter(k => k !== 'openai-key');
              delete settings.keyValuePairs['openai-key'];
              await CCLocalStorage.set('carbonbar_settings', settings);
            } catch (cleanupError) {
              ccLogger.error('Error cleaning up settings after key error:', cleanupError);
            }
          }
        }
      }

      if (commandHistory) {
        window.postMessage({
          type: 'COMMAND_HISTORY_LOADED',
          payload: commandHistory
        }, window.location.origin);
      }

      if (keybind) {
        window.postMessage({
          type: 'SET_KEYBIND',
          payload: keybind
        }, window.location.origin);
      }
    } catch (error) {
      ccLogger.error('Error sending initial values to window:', error);
    }
  } catch (error) {
    ccLogger.error('Error in initializeStorage:', error);
  }
}

function injectCarbonBar(file_path, tag) {
  // Send message to background script to get tab ID
  chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, async function(response) {
    const currentTabId = response.tabId;

    // Create extension icon click handler
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'TOGGLE_CARBONBAR') {
        window.postMessage({ type: 'TOGGLE_CARBONBAR' }, window.location.origin);
        sendResponse(true);
      }
      if (message.type === 'SHOW_KEYBIND_DIALOG') {
        window.postMessage({ type: 'SHOW_KEYBIND_DIALOG' }, window.location.origin);
        sendResponse(true);
      }
    });

    ccLogger.debug('Injecting carbonbar script:', file_path, currentTabId);
    var node = document.getElementsByTagName(tag)[0];
    
    // Inject the tabId script
    const addMetaTabId = document.createElement('meta');
    addMetaTabId.setAttribute('name', 'tabId');
    addMetaTabId.setAttribute('content', currentTabId);
    node.appendChild(addMetaTabId);
    
    // Inject the main carbonbar script
    ccLogger.debug('Injecting carbonbar script:', file_path);
    const script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', file_path);
    node.appendChild(script);

    // Initialize storage after script is loaded
    script.onload = () => {
      initializeStorage();
    };
  });
}

// make sure this only gets injected once
if (!window.carbonBarInjected && !inIframe) {
  ccLogger.debug('Injecting carbonbar script:', chrome.runtime.getURL('carbon-commander-dist.js'));
  injectCarbonBar(chrome.runtime.getURL('carbon-commander-dist.js'), 'body');
  window.carbonBarInjected = true;

  // Listen for messages from the injected script
  window.addEventListener('message', async (event) => {
    ccLogger.debug('Received message:', event);
    // We only accept messages from ourselves
    if (event.source !== window) {
      return;
    }

    if (event.data.type === "AI_REQUEST") {
      var response = await aiRequest(event);
      ccLogger.debug('AI_REQUEST_RESPONSE', response);
    }

    if (event.data.type === "AI_TOOL_RESPONSE") {
      toolResponseProxy(event);
      ccLogger.debug('AI_TOOL_RESPONSE', event);
    }
    
    // Add handler for confirmation dialog responses
    if (event.data.type === "CONFIRMATION_DIALOG_RESPONSE") {
      chrome.runtime.sendMessage(
        { 
          type: 'CONFIRMATION_DIALOG_RESPONSE', 
          payload: event.data.payload,
          tabId: event.data.tabId 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            ccLogger.error('Error sending confirmation response:', chrome.runtime.lastError.message);
          }
        }
      );
    }

    // Add handler for input dialog responses
    if (event.data.type === "INPUT_DIALOG_RESPONSE") {
      chrome.runtime.sendMessage(
        { 
          type: 'INPUT_DIALOG_RESPONSE', 
          payload: event.data.payload,
          tabId: event.data.tabId 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            ccLogger.error('Error sending input response:', chrome.runtime.lastError.message);
          }
        }
      );
    }

    if (event.data.type === "GET_COMMAND_HISTORY") {
      ccLogger.debug('GET_COMMAND_HISTORY');
      CCLocalStorage.get('carbonbar_command_history').then(history => {
        window.postMessage({
          type: 'COMMAND_HISTORY_LOADED',
          payload: history || []
        }, window.location.origin);
      });
    }

    if (event.data.type === "GET_AUTOCOMPLETE") {
      ccLogger.debug('GET_AUTOCOMPLETE');
        try {
            // Use the tabId that was already set during initialization
            chrome.runtime.sendMessage(
                { 
                    type: 'GET_AUTOCOMPLETE', 
                    payload: event.data.payload,
                    tabId: window.tabId
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        ccLogger.error('Error getting autocomplete:', chrome.runtime.lastError);
                        return;
                    }
                    
                    // Forward the suggestion back to the window with the request ID
                    window.postMessage({
                        type: 'AUTOCOMPLETE_SUGGESTION',
                        payload: {
                            text: response,
                            requestId: event.data.payload.requestId
                        }
                    }, window.location.origin);
                }
            );
        } catch (error) {
            ccLogger.error('Error sending autocomplete request:', error);
        }
    }

    if (event.data.type === "GET_ENCRYPTED_VALUE") {
      const { key } = event.data.payload;
      try {
        const value = await CCLocalStorage.getEncrypted(`encrypted_${key}`);
        window.postMessage({
          type: 'ENCRYPTED_VALUE_RESPONSE',
          payload: { key, value }
        }, window.location.origin);
      } catch (error) {
        ccLogger.error('Error getting encrypted value:', error);
        window.postMessage({
          type: 'ENCRYPTED_VALUE_RESPONSE',
          payload: { key, value: null, error: error.message }
        }, window.location.origin);
      }
    }

    if (event.data.type === "SET_OPENAI_KEY") {
      ccLogger.debug('SET_OPENAI_KEY', event.data.payload);
      try {
        chrome.runtime.sendMessage(
          { 
            type: 'SET_OPENAI_KEY', 
            payload: event.data.payload,
            tabId: event.data.tabId 
          },
          async (response) => {
            try {
              ccLogger.debug('SET_OPENAI_KEY_RESPONSE and PROVIDER_STATUS_UPDATE', response?.success);
              if(response?.success){
                try {
                  // Add the key to settings as an encrypted value
                  window.postMessage({
                    type: 'ENCRYPT_VALUE',
                    payload: { 
                      key: 'openai-key', 
                      value: event.data.payload.key 
                    }
                  }, window.location.origin);

                  // Update settings to track this as an encrypted key
                  const settings = await CCLocalStorage.get('carbonbar_settings') || {};
                  settings.keyValuePairs = settings.keyValuePairs || {};
                  settings.encryptedKeys = settings.encryptedKeys || [];
                  if (!settings.encryptedKeys.includes('openai-key')) {
                    settings.encryptedKeys.push('openai-key');
                  }
                  await CCLocalStorage.set('carbonbar_settings', settings);

                  window.postMessage({
                    type: 'PROVIDER_STATUS_UPDATE',
                    provider: 'openai',
                    status: true
                  }, window.location.origin);
                } catch (error) {
                  ccLogger.error('Error saving OpenAI key to settings:', error);
                }
              }

              window.postMessage({
                type: 'SET_OPENAI_KEY_RESPONSE',
                payload: response?.success || false
              }, window.location.origin);
            } catch (error) {
              ccLogger.error('Error handling OpenAI key response:', error);
              window.postMessage({
                type: 'SET_OPENAI_KEY_RESPONSE',
                payload: false
              }, window.location.origin);
            }
          }
        );
      } catch (error) {
        ccLogger.error('Error sending SET_OPENAI_KEY message:', error);
        window.postMessage({
          type: 'SET_OPENAI_KEY_RESPONSE',
          payload: false
        }, window.location.origin);
      }
    }

    if (event.data.type === "CHECK_OLLAMA_AVAILABLE") {
      chrome.runtime.sendMessage(
        { 
          type: 'CHECK_OLLAMA_AVAILABLE',
          tabId: event.data.tabId,
          payload: event.data.payload
        },
        (response) => {
          if (response && response.available) {
            // Add reinitialize call before success message
            if(response.noAIMode){
              chrome.runtime.sendMessage({ type: 'REINITIALIZE_AI_CALLER' }, (response) => {
                ccLogger.debug('CHECK_OLLAMA_AVAILABLE', response);
                window.postMessage({
                  type: 'AI_RESPONSE_CHUNK',
                  payload: {
                    content: "✅ Ollama is now available! You can start using it's AI features.",
                    isFinished: true
                  }
                }, window.location.origin);
                window.postMessage({
                  type: 'PROVIDER_STATUS_UPDATE',
                  provider: 'ollama',
                  status: true
                }, window.location.origin);
              });
            } else {
              window.postMessage({
                type: 'PROVIDER_STATUS_UPDATE',
                provider: 'ollama',
                status: true
              }, window.location.origin);
            }
          }
        }
      );
    }

    if (event.data.type === "SAVE_KEYBIND") {
      CCLocalStorage.set('carbonbar_keybind', event.data.payload).catch(error => {
        ccLogger.error('Error saving keybind:', error);
      });
    }

    if (event.data.type === "GET_KEYBIND") {
      CCLocalStorage.get('carbonbar_keybind').then(keybind => {
        window.postMessage({
          type: 'SET_KEYBIND',
          payload: keybind || { key: 'k', ctrl: true, meta: false }
        }, window.location.origin);
      });
    }

    if (event.data.type === "TOGGLE_PROVIDER") {
      const { provider, enabled } = event.data.payload;
      chrome.runtime.sendMessage(
        { 
          type: 'TOGGLE_PROVIDER', 
          payload: { provider, enabled },
          tabId: window.tabId 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            ccLogger.error('Error toggling provider:', chrome.runtime.lastError);
          }
        }
      );
    }

    if (event.data.type === "GET_SETTINGS") {
      CCLocalStorage.get('carbonbar_settings').then(settings => {
        window.postMessage({
          type: 'SETTINGS_LOADED',
          payload: settings
        }, window.location.origin);
      });
    }

    if (event.data.type === "SAVE_SETTINGS") {
      CCLocalStorage.set('carbonbar_settings', event.data.payload).catch(error => {
        ccLogger.error('Error saving settings:', error);
      });
    }

    if (event.data.type === "SAVE_COMMAND_HISTORY") {
      CCLocalStorage.set('carbonbar_command_history', event.data.payload).catch(error => {
        ccLogger.error('Error saving command history:', error);
      });
    }

    if (event.data.type === "ENCRYPT_VALUE") {
      const { key, value } = event.data.payload;
      try {
        await CCLocalStorage.setEncrypted(`encrypted_${key}`, value);
        ccLogger.debug('Value encrypted successfully:', key);
      } catch (error) {
        ccLogger.error('Error encrypting value:', error);
        // Try to clean up settings if encryption fails
        try {
          const settings = await CCLocalStorage.get('carbonbar_settings') || {};
          settings.encryptedKeys = (settings.encryptedKeys || []).filter(k => k !== key);
          delete settings.keyValuePairs[key];
          await CCLocalStorage.set('carbonbar_settings', settings);
        } catch (cleanupError) {
          ccLogger.error('Error cleaning up settings after encryption error:', cleanupError);
        }
      }
    }

    if (event.data.type === "UPDATE_ENCRYPTED_VALUE") {
      const { key, value } = event.data.payload;
      try {
        await CCLocalStorage.setEncrypted(`encrypted_${key}`, value);
        ccLogger.debug('Encrypted value updated successfully:', key);
      } catch (error) {
        ccLogger.error('Error updating encrypted value:', error);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type === 'FROM_BACKGROUND') {
        const payload = message.payload;

        // Forward the message to the window
        window.postMessage({
            type: payload.error ? 'AI_RESPONSE_ERROR' : 'AI_RESPONSE_CHUNK',
            payload: payload
        }, window.location.origin);
        ccLogger.debug('FROM_BACKGROUND', payload);
        sendResponse(true);
        return false;
    }

    // Add handling for AI_EXECUTE_TOOL messages
    if (message.type === 'AI_EXECUTE_TOOL') {
      const messageId = JSON.stringify(message) + Date.now();
      ccLogger.debug('Received AI_EXECUTE_TOOL in content script2:', message, messageId);
      // Forward the tool execution request to the window
      window.postMessage({
          type: 'AI_EXECUTE_TOOL',
          tool: message.payload.tool
      }, window.location.origin);
      sendResponse(true);
      return false;
    }
  });


}




const aiRequest = async (event) => {
    try {
        const tabId = event.data.tabId || (await getCurrentTabId());
        ccLogger.debug('AI_REQUEST', event.data.payload, tabId);
        
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'AI_REQUEST', payload: event.data.payload, tabId },
                (response) => {
                    ccLogger.debug('AI_REQUEST_RESPONSE', response);
                    if (chrome.runtime.lastError) {
                      ccLogger.error('[aiRequest] AI_REQUEST_RESPONSE1', response);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.error) {
                      ccLogger.error('[aiRequest] AI_REQUEST_RESPONSE2', response);
                        reject(new Error(response.error));
                    } else {
                      ccLogger.debug('[aiRequest] AI_REQUEST_RESPONSE3', response);
                        resolve(response);
                    }
                }
            );
        });

        ccLogger.debug('AI request completed:', response);
        return response;
    } catch (error) {
        ccLogger.error('AI_RESPONSE_ERROR2:', error);
        return error;
    }
}

// Replace the getCurrentTabId function with a simpler version that uses the meta tag
function getCurrentTabId() {
    return new Promise((resolve) => {
        const tabIdMeta = document.querySelector('meta[name="tabId"]');
        if (tabIdMeta) {
            resolve(tabIdMeta.getAttribute('content'));
        } else {
            ccLogger.error('TabId meta tag not found');
            resolve(null);
        }
    });
}

const toolResponseProxy = async (event) => {
  try {
    ccLogger.debug('Received AI_TOOL_RESPONSE in service.js', event);
    chrome.runtime.sendMessage(
      { type: 'AI_TOOL_RESPONSE', payload: event.data.payload, tabId: event.data.tabId },
      (response) => {
          if (chrome.runtime.lastError) {
              ccLogger.error('Error communicating with extension:', chrome.runtime.lastError.message);
          } else {
              ccLogger.debug('AI_TOOL_RESPONSE_RESULT', response);
          }
      }
    );
  } catch (error) {
    ccLogger.error('Error communicating with extension:', error);
  }
}