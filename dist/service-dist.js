/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./src/local-storage.js
class CCLocalStorage {
    static #pass = 'CarbonLocalSecurityKey';
    
    static async setEncrypted(key, value) {
        let enc = '';
        for(let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i) ^ this.#pass.charCodeAt(i % this.#pass.length);
            enc += c.toString(16).padStart(4, '0');
        }
        await chrome.storage.local.set({ [key]: enc });
        console.log('setEncrypted', key, `[${value.substring(0, 4)}...]`);
    }

    static async getEncrypted(key) {
        const result = await chrome.storage.local.get([key]);
        const enc = result[key];
        if (!enc) return null;
        
        let dec = '';
        for(let i = 0; i < enc.length; i += 4) {
            const c = parseInt(enc.slice(i, i + 4), 16);
            dec += String.fromCharCode(c ^ this.#pass.charCodeAt((i/4) % this.#pass.length));
        }
        console.log('getEncrypted', key, `[${dec.substring(0, 4)}...]`);
        return dec;
    }

    static async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
    }

    static async get(key) {
        const result = await chrome.storage.local.get([key]);
        return result[key] || null;
    }

    static async getAll() {
        return await chrome.storage.local.get(null);
    }

    static async remove(key) {
        await chrome.storage.local.remove(key);
    }
}

/* harmony default export */ const local_storage = (CCLocalStorage);
;// ./src/global.js
/**
 * Global logger implementation for Carbon Commander
 */
const ccLogger = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    group: console.group.bind(console),
    groupEnd: console.groupEnd.bind(console),
    time: console.time.bind(console),
    timeEnd: console.timeEnd.bind(console)
};
;// ./src/service.js



const inIframe = window.self !== window.top;

function injectCarbonBar(file_path, tag) {
  // Send message to background script to get tab ID
  chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, function(response) {
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
  });
}

// make sure this only gets injected once
if (!window.carbonBarInjected && !inIframe) {
  ccLogger.debug('Injecting carbonbar script:', chrome.runtime.getURL('carbon-commander-dist.js'));
  // Check for saved OpenAI key and update status
  local_storage.getEncrypted('openai_api_key').then(key => {
    if (key) {
      //TODO: find a better way than timeouts
      setTimeout(() => {
        window.postMessage({
            type: 'PROVIDER_STATUS_UPDATE',
          provider: 'openai',
          status: true
        }, window.location.origin);
      }, 1000);
    }
  });

  // Load saved keybind if it exists
  chrome.storage.local.get(['carbonbar_keybind'], (result) => {
    if (result.carbonbar_keybind) {
      window.postMessage({
        type: 'SET_KEYBIND',
        payload: result.carbonbar_keybind
      }, window.location.origin);
    }
  });

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

    if (event.data.type === "SAVE_COMMAND_HISTORY") {
      chrome.storage.local.set({ 
        'carbonbar_command_history': event.data.payload 
      }, () => {
        if (chrome.runtime.lastError) {
          ccLogger.error('Error saving command history:', chrome.runtime.lastError);
        }
      });
    }

    if (event.data.type === "GET_COMMAND_HISTORY") {
      ccLogger.debug('GET_COMMAND_HISTORY');
      chrome.storage.local.get(['carbonbar_command_history'], (result) => {
        window.postMessage({
          type: 'COMMAND_HISTORY_LOADED',
          payload: result.carbonbar_command_history || []
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

    if (event.data.type === "SET_OPENAI_KEY") {
      ccLogger.debug('SET_OPENAI_KEY', event.data.payload);
      chrome.runtime.sendMessage(
        { 
          type: 'SET_OPENAI_KEY', 
          payload: event.data.payload,
          tabId: event.data.tabId 
        },
        async (response) => {
          ccLogger.debug('SET_OPENAI_KEY_RESPONSE and PROVIDER_STATUS_UPDATE', response.success);
          if(response.success){
            // Save the key to storage
            await local_storage.setEncrypted('openai_api_key', event.data.payload.key);
            window.postMessage({
                type: 'PROVIDER_STATUS_UPDATE',
                provider: 'openai',
                status: true
              }, window.location.origin);
          }

          window.postMessage({
            type: 'SET_OPENAI_KEY_RESPONSE',
            payload: response.success
          }, window.location.origin);
        }
      );
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
      chrome.storage.local.set({ 
        'carbonbar_keybind': event.data.payload 
      }, () => {
        if (chrome.runtime.lastError) {
          ccLogger.error('Error saving keybind:', chrome.runtime.lastError);
        }
      });
    }

    if (event.data.type === "GET_KEYBIND") {
      chrome.storage.local.get(['carbonbar_keybind'], (result) => {
        window.postMessage({
          type: 'SET_KEYBIND',
          payload: result.carbonbar_keybind || { key: 'k', ctrl: true, meta: false }
        }, window.location.origin);
      });
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
/******/ })()
;
//# sourceMappingURL=service-dist.js.map