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
// Log levels enum
const LogLevel = {
    DEBUG: { name: 'DEBUG', color: '#7f8c8d', style: 'color: #7f8c8d' },
    INFO: { name: 'INFO', color: '#3498db', style: 'color: #3498db' },
    WARN: { name: 'WARN', color: '#f39c12', style: 'color: #f39c12' },
    ERROR: { name: 'ERROR', color: '#e74c3c', style: 'color: #e74c3c' },
    FATAL: { name: 'FATAL', color: '#c0392b', style: 'background: #c0392b; color: white; padding: 2px 4px; border-radius: 2px' }
};

class CCLogger {
    static #instance;
    #logLevel = LogLevel.FATAL;
    #logHistory = [];
    #maxHistorySize = 1000;
    #groupLevel = 0;
    #timers = new Map();
    #filters = new Set();

    constructor() {
        if (CCLogger.#instance) {
            return CCLogger.#instance;
        }
        CCLogger.#instance = this;
    }

    static getInstance() {
        if (!CCLogger.#instance) {
            CCLogger.#instance = new CCLogger();
        }
        return CCLogger.#instance;
    }

    disable() {
        this.#logLevel = LogLevel.FATAL;
    }

    enable() {
        this.#logLevel = LogLevel.DEBUG;
    }

    setLogLevel(level) {
        if (LogLevel[level]) {
            this.#logLevel = LogLevel[level];
        }
    }

    addFilter(pattern) {
        this.#filters.add(pattern);
    }

    removeFilter(pattern) {
        this.#filters.delete(pattern);
    }

    clearFilters() {
        this.#filters.clear();
    }

    #shouldLog(message) {
        if (this.#filters.size === 0) return true;
        return Array.from(this.#filters).some(pattern => 
            message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    #formatMessage(level, args) {
        const timestamp = new Date().toISOString();
        const prefix = '│'.repeat(this.#groupLevel);
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');

        return {
            formatted: `${prefix}[Carbon Commander][${level.name}] ${message}`,
            timestamp,
            level,
            raw: message
        };
    }

    #addToHistory(logEntry) {
        this.#logHistory.push(logEntry);
        if (this.#logHistory.length > this.#maxHistorySize) {
            this.#logHistory.shift();
        }
    }

    #log(level, ...args) {
        if (!this.#shouldLog(args.join(' '))) return;

        const logEntry = this.#formatMessage(level, args);
        this.#addToHistory(logEntry);

        const consoleArgs = [
            `%c${logEntry.timestamp} ${logEntry.formatted}`,
            level.style
        ];

        switch (level) {
            case LogLevel.DEBUG:
                console.debug(...consoleArgs);
                break;
            case LogLevel.INFO:
                console.info(...consoleArgs);
                break;
            case LogLevel.WARN:
                console.warn(...consoleArgs);
                break;
            case LogLevel.ERROR:
            case LogLevel.FATAL:
                console.error(...consoleArgs);
                if (args[0] instanceof Error) {
                    console.error(args[0].stack);
                }
                break;
        }
    }

    debug(...args) {
        this.#log(LogLevel.DEBUG, ...args);
    }

    info(...args) {
        this.#log(LogLevel.INFO, ...args);
    }

    warn(...args) {
        this.#log(LogLevel.WARN, ...args);
    }

    error(...args) {
        this.#log(LogLevel.ERROR, ...args);
    }

    fatal(...args) {
        this.#log(LogLevel.FATAL, ...args);
    }

    group(label) {
        if (this.#logLevel === LogLevel.DEBUG) {
            console.group(label);
        }
        this.#groupLevel++;
        this.debug(`Group Start: ${label}`);
    }

    groupEnd() {
        this.#groupLevel = Math.max(0, this.#groupLevel - 1);
        if (this.#logLevel === LogLevel.DEBUG) {
            console.groupEnd();
        }
        this.debug('Group End');
    }

    time(label) {
        this.#timers.set(label, performance.now());
        this.debug(`Timer Start: ${label}`);
    }

    timeEnd(label) {
        const startTime = this.#timers.get(label);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.#timers.delete(label);
            this.debug(`Timer End: ${label} (${duration.toFixed(2)}ms)`);
            return duration;
        }
        this.warn(`Timer not found: ${label}`);
        return null;
    }

    getLogHistory() {
        return [...this.#logHistory];
    }

    clearHistory() {
        this.#logHistory = [];
    }

    exportLogs() {
        return {
            logs: this.#logHistory,
            timestamp: new Date().toISOString(),
            filters: Array.from(this.#filters),
            logLevel: this.#logLevel.name
        };
    }
}

// Create a singleton instance
const ccLogger = CCLogger.getInstance();


if(typeof window !== 'undefined') {
    window.ccLogger= ccLogger;
}


;// ./src/service.js



const inIframe = window.self !== window.top;

function injectCarbonBar(file_path, tag) {
  // Send message to background script to get tab ID
  chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, function(response) {
    const currentTabId = response.tabId;
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