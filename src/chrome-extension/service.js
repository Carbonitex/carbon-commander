/**
 * Service script that acts as a bridge between the webpage and Chrome extension.
 * Handles secure communication, storage management, and initialization of the 
 * CarbonCommander interface.
 */

import CCLocalStorage from '../chrome-serviceworker/local-storage.js';
import { ccLogger, ccDefaultKeybind } from '../global.js';

ccLogger.setPrefix('[EXTENSION]');

const inIframe = window.self !== window.top;

// Add key state management
const messageKeyStates = new Map();
const activeMessagePorts = new Map();

function generateSecureToken() {
  // Generate a 32-byte random token and encode as base64
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, array));
}

// Function to create a signed message that can be verified
function createSignedMessage(message, secretKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(message));
  return crypto.subtle.sign(
    "HMAC",
    secretKey,
    data
  );
}

// Function to verify a signed message
async function verifySignedMessage(message, signature, secretKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(message));
  return await crypto.subtle.verify(
    "HMAC",
    secretKey,
    signature,
    data
  );
}

async function generateSecureHMACKey() {
  return await crypto.subtle.generateKey(
    {
      name: "HMAC",
      hash: {name: "SHA-256"}
    },
    true,
    ["sign", "verify"]
  );
}

async function initializeStorage() {
  try {
    // Load all stored values
    let settings = await getCarbonBarSettings();
    let keybind = await CCLocalStorage.get('carbonbar_keybind');
    if(!keybind) {
      keybind = ccDefaultKeybind;
    }

    // Generate secure token for this session
    const authToken = generateSecureToken();
    window.ccAuthToken = authToken;

    // Send all initial values to the window
    try {
      try {
        const openaiKey = await CCLocalStorage.getEncrypted('openai-key');
        if (openaiKey) {
          // Send message to check and set OpenAI key
          chrome.runtime.sendMessage(
            { type: 'CARBON_SET_OPENAI_KEY', payload: { key: openaiKey } },
            (response) => {
              if (response && response.success) {
                window.postMessage({
                  type: 'PROVIDER_STATUS_UPDATE',
                  provider: 'openai',
                  status: true
                }, window.location.origin);
              } else {
                // If key validation fails, clean up settings
                settings.encryptedKeys = settings.encryptedKeys?.filter(k => k !== 'openai-key') || [];
                CCLocalStorage.removeEncrypted('openai-key');
              }
            }
          );
        }
      } catch (error) {
        ccLogger.error('Error checking OpenAI key:', error);
      }

      window.postMessage({
        type: 'SET_KEYBIND',
        payload: keybind
      }, window.location.origin);
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

    var node = document.getElementsByTagName(tag)[0];
    
    // Inject the tabId script
    const addMetaTabId = document.createElement('meta');
    addMetaTabId.setAttribute('name', 'tabId');
    addMetaTabId.setAttribute('content', currentTabId);
    node.appendChild(addMetaTabId);

    // Generate HMAC key for message signing
    const hmacKey = await generateSecureHMACKey();
    const exportedKey = await crypto.subtle.exportKey("raw", hmacKey);
    const keyBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(exportedKey)));

    // Store the key in the service worker context
    // This window object is not the same at the page we inject into, its for the extension
    window.ccHMACKey = hmacKey;

    // First inject the secure messaging script with the key
    const secureMessagingScript = document.createElement('script');
    secureMessagingScript.setAttribute('type', 'text/javascript');
    secureMessagingScript.setAttribute('src', chrome.runtime.getURL('secure-messaging.js'));
    ccLogger.debug('Injecting secure messaging script with key:', keyBase64);
    secureMessagingScript.setAttribute('cc-data-key', keyBase64);
    node.appendChild(secureMessagingScript);

    // Initialize secure messaging after script loads
    secureMessagingScript.onload = () => {
      // Inject the main carbonbar script
      ccLogger.debug('Injecting carbonbar script:', file_path, currentTabId);
      const script = document.createElement('script');
      script.setAttribute('type', 'text/javascript');
      script.setAttribute('src', file_path);
      node.appendChild(script);

      // Initialize storage after script is loaded
      script.onload = () => {
        initializeStorage();
      };
    };
  });
}

async function getCarbonBarSettings() {
  let settings = await CCLocalStorage.get('carbonbar_settings');
  if(!settings) {
    settings = {
      keyValuePairs: new Map(),
      encryptedKeys: new Map(),
      systemPrompt: '',
      hostnamePrompts: new Map(),
      mcpConfigurations: new Map(),
      keybind: ccDefaultKeybind
    };
  }

  // Convert keyValuePairs to Map if it exists
  if (settings.keyValuePairs) {
    settings.keyValuePairs = new Map(
        settings.keyValuePairs instanceof Map ? 
            settings.keyValuePairs : 
            Object.entries(settings.keyValuePairs)
    );
  }

  // Convert hostnamePrompts to Map if it exists
  if (settings.hostnamePrompts) {
    settings.hostnamePrompts = new Map(
        settings.hostnamePrompts instanceof Map ?
            settings.hostnamePrompts :
            Object.entries(settings.hostnamePrompts)
    );
  } else {
    settings.hostnamePrompts = new Map();
  }

  // Convert mcpConfigurations to Map if it exists
  if (settings.mcpConfigurations) {
    settings.mcpConfigurations = new Map(
        settings.mcpConfigurations instanceof Map ?
            settings.mcpConfigurations :
            Object.entries(settings.mcpConfigurations)
    );
  } else {
    settings.mcpConfigurations = new Map();
  }

  // Load MCP API keys from encrypted storage
  for (const [serviceId, config] of settings.mcpConfigurations.entries()) {
    const apiKey = await CCLocalStorage.getEncrypted(`mcp-key-${serviceId}`);
    if (apiKey) {
      config.apiKey = apiKey;
    }
  }

  //enhance settings with encrypted keys
  const encryptedKeys = await CCLocalStorage.getEncryptedKeys();
  settings.encryptedKeys = new Map();
  for (const key of encryptedKeys) {
    if(key.startsWith('carbonbar_command_history_')) {
      continue;
    }
    const encryptedValue = await CCLocalStorage.getEncrypted(key);
    //ignore carbonbar_command_history_

    const hasValue = encryptedValue !== null && encryptedValue !== undefined && encryptedValue !== '';
    settings.encryptedKeys.set(key, hasValue);
    settings.keyValuePairs?.delete(key);
  }

  return settings;
}


// make sure this only gets injected once
if (!window.carbonBarInjected && !inIframe) {
  ccLogger.debug('Start injecting carbonbar script:', chrome.runtime.getURL('carbon-commander.js'));
  injectCarbonBar(chrome.runtime.getURL('carbon-commander.js'), 'body');
  window.carbonBarInjected = true;

  // Add signature creation function
  async function createSignedMessage(message, key) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(message));
      return await crypto.subtle.sign(
        "HMAC",
        key,
        data
      );
    } catch (error) {
      ccLogger.error('Error creating signature:', error);
      throw error;
    }
  }

  // Add key derivation function
  async function deriveNextKey(currentKey, salt) {
    try {
      // Export current key to raw bytes if it's a CryptoKey object
      const rawKey = currentKey instanceof CryptoKey ? 
        await crypto.subtle.exportKey("raw", currentKey) :
        currentKey;
      
      // Use HKDF to derive a new key
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "HKDF" },
        false, // HKDF keys must not be extractable
        ["deriveBits"]
      );

      const bits = await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: encoder.encode(salt),
          info: encoder.encode("CarbonCommanderRatchet")
        },
        keyMaterial,
        256
      );

      // Convert derived bits to new HMAC key
      return await crypto.subtle.importKey(
        "raw",
        bits,
        {
          name: "HMAC",
          hash: { name: "SHA-256" }
        },
        true, // Keep HMAC key extractable for ratcheting
        ["sign", "verify"]
      );
    } catch (error) {
      ccLogger.error('Error deriving next key:', error);
      return null;
    }
  }

  // Handle messages from chrome.runtime
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    sendResponse({ received: true });


    if(!message.type.startsWith('CARBON_')) {
      ccLogger.debug('Received non-CARBON message(2):', message);
      return;
    }

    if(!message.fromServiceWorker) {
      ccLogger.debug('Received message from non-service worker:', message);
      return;
    }

    if(!message._authToken || message._authToken !== window.ccAuthToken) {
      ccLogger.error('Received message from non-service worker with invalid auth token:', message);
      return;
    }

    const unprefixedType = message.type.replace(/^CARBON_/, '');
    

    
    // Handle AI_EXECUTE_TOOL messages
    //if (unprefixedType === 'AI_EXECUTE_TOOL' && message.payload?.tool) {
    //  const responseHandler = (event) => {
    //    if (event.source === window && 
    //        event.data.type === 'AI_TOOL_RESPONSE' && 
    //        event.data.payload) {
    //      ccLogger.debug('Received tool response:', event.data);
    //      window.removeEventListener('message', responseHandler);
    //      sendResponse(event.data.payload);
    //    }
    //  };
    //  
    //  window.addEventListener('message', responseHandler);
    //  // Forward the tool execution request using secure messaging
    //  window.postMessage({
    //    type: 'CARBON_AI_EXECUTE_TOOL',
    //    payload: {
    //      tool: {
    //        name: message.payload.tool.name,
    //        arguments: message.payload.tool.arguments
    //      }
    //    }
    //  }, window.location.origin);
    //  return true; // Keep the message channel open
    //}


    // Forward messages from background to window using standard postMessage
    ccLogger.debug('Forwarding message to window:', message, 'sender:', sender);
    window.postMessage(message, window.location.origin);
    
    return true;
  });

  // Listen for messages from the injected script
  window.addEventListener('message', async (event) => {
    // We only accept messages from ourselves
    if (event.source !== window) {
      ccLogger.warn('Rejected message from external source');
      return;
    }

    if(event.data.type && event.data.type.startsWith('CARBON_') && event.data._authToken !== window.ccAuthToken) {
      ccLogger.error('Rejected unauthorized message', event.data.type);
      return;
    }

    const hasAuthToken = event.data._authToken;
    const authTokenMatched = hasAuthToken && event.data._authToken === window.ccAuthToken;
    delete event.data._authToken;

    ccLogger.group('Service Message Handler');
    ccLogger.debug('Received message:', {
      hasAuthToken: hasAuthToken,
      authTokenMatched: authTokenMatched,
      type: event.data.type,
      payload: event.data.payload
    });



    // Handle both prefixed and unprefixed message types for backward compatibility
    const messageType = event.data.type;
    const unprefixedType = messageType.replace(/^CARBON_/, '');
    ccLogger.debug('Processing message:', { original: messageType, unprefixed: unprefixedType });

    // Special handling for one-way messages that don't need secure messaging or auth
    //if (messageType === 'AI_RESPONSE_CHUNK' || 
    //    messageType === 'AI_RESPONSE_ERROR' || 
    //    messageType === 'SET_OPENAI_KEY' || 
    //    messageType === 'CHECK_OLLAMA_AVAILABLE' || 
    //    messageType === 'AI_EXECUTE_TOOL') {
    //    ccLogger.debug('[SECURITYDEBUG] Handling one-way message type:', messageType);
    //    await handleMessage(event.data, unprefixedType);
    //    ccLogger.groupEnd();
    //    return;
    //}

    // Handle provider status updates directly without forwarding
    if (messageType === 'PROVIDER_STATUS_UPDATE') {
        ccLogger.debug('Received provider status update:', event.data);
        // Don't forward or process further to prevent loops
        ccLogger.groupEnd();
        return;
    }

    // Handle secure message channel setup first
    if (messageType === 'SECURE_MESSAGE') {
      ccLogger.debug('Setting up secure message channel');
      const port = event.ports[0];
      const messageId = event.data.messageId;
      if (!port || !messageId) {
        ccLogger.error('Missing port or messageId for secure channel');
        ccLogger.groupEnd();
        return;
      }

      // Store port reference
      activeMessagePorts.set(messageId, port);
      // Initialize key state for this message
      messageKeyStates.set(messageId, window.ccHMACKey);
      ccLogger.debug('Initialized message state:', { messageId });

      // Start port immediately to prevent closure
      port.start();
      ccLogger.debug('Started message port');

      port.onmessage = async (e) => {
        ccLogger.group('Secure Channel Message');
        try {
          const message = e.data;
          const counter = message._counter;
          ccLogger.debug('Received message on secure channel:', { 
            type: message.type,
            counter,
            messageId 
          });
          
          // Get current key for this message
          const currentKey = messageKeyStates.get(messageId);
          if (!currentKey) {
            throw new Error('No key found for message');
          }

          // Create signature using the same format as verification
          const signature = await createSignedMessage(message, currentKey);
          ccLogger.debug('Created message signature');
          
          // Send signed message back through the secure channel
          port.postMessage({
            data: message,
            signature: signature,
            counter: counter
          });
          ccLogger.debug('Sent signed response');

          // Derive and update to next key
          const nextKey = await deriveNextKey(currentKey, `${messageId}-${counter}`);

          if (nextKey) {
            messageKeyStates.set(messageId, nextKey);
            window.ccHMACKey = nextKey;
            ccLogger.debug('Updated message key');
          }

          // Process the actual message
          const unprefixedMessageType = message.type.replace(/^CARBON_/, '');
          ccLogger.debug('Processing secure message:', unprefixedMessageType);
          
          // Handle the message based on its type
          await handleMessage(message, unprefixedMessageType);
          
        } catch (error) {
          ccLogger.error('Error in secure message handling:', error);
          // Send error back through port
          port.postMessage({
            error: error.message,
            counter: message?._counter
          });
        }
        ccLogger.groupEnd();
      };

      // Handle port closure and cleanup
      port.onclose = () => {
        ccLogger.debug('Secure message port closed:', messageId);
        messageKeyStates.delete(messageId);
        activeMessagePorts.delete(messageId);
      };

      ccLogger.groupEnd();
      return;
    }

    
    // Only use secure messaging for CARBON_ prefixed messages from carbon-commander.js
    if (messageType.startsWith('CARBON_')) {

      if (!authTokenMatched) {
        ccLogger.error('Invalid or missing auth token in message:', {
          received: event.data.authToken,
          expected: window.ccAuthToken
        });
        ccLogger.groupEnd();
        return;
      } else {
        ccLogger.debug('Valid auth token in message:', {
          messageType: event.data.type,
          unprefixedType: unprefixedType,
          received: event.data.authToken,
          expected: window.ccAuthToken
        });
      }

      // Handle messages based on unprefixed type
      try {
        // Skip processing if this is a response message (it's already been handled)
        if (!unprefixedType.endsWith('_RESPONSE')) {
          await handleMessage(event.data, unprefixedType);
        } else {
          ccLogger.debug('Skipping response message:', unprefixedType);
        }
      } catch (error) {
        ccLogger.error('Error handling message1:', error);
      }
    } else if(messageType.startsWith('CB_')) {
      await handleMessage(event.data, messageType);
    } else {
      ccLogger.debug('Ignored non-CARBON message');
    }
    ccLogger.groupEnd();
  });
}

// Helper function to handle messages
async function handleMessage(message, unprefixedType) {

  const sendResponseMsg = (response) => {
    ccLogger.debug(`Sending ${unprefixedType} response`);
    window.postMessage({
      type: `CARBON_${unprefixedType}_RESPONSE`,
      payload: response,
      _authToken: window.ccAuthToken
    }, window.location.origin);
  }

  ccLogger.debug('Processing message type:', unprefixedType, "message.type:", message.type);
  switch(unprefixedType) {
    //case 'AI_REQUEST':
    //  ccLogger.debug('Handling AI request');
    //  try {
    //    var aiResponse = await aiRequest({ data: message });
    //    ccLogger.debug('AI request completed:', aiResponse);
    //  } catch (error) {
    //    ccLogger.error('Error in AI request:', error);
    //    window.postMessage({
    //      type: 'AI_RESPONSE_ERROR',
    //      payload: { error: error.message || 'Unknown error' }
    //    }, window.location.origin);
    //  }
    //  break;

    //case 'AI_TOOL_RESPONSE':
    //  ccLogger.debug('Handling AI tool response');
    //  try {
    //    const toolResponse = await new Promise((resolve, reject) => {
    //      const timeoutId = setTimeout(() => {
    //        reject(new Error('Tool response timeout'));
    //      }, 30000); // 30 second timeout
//
    //      // Send to chrome runtime first
    //      chrome.runtime.sendMessage(
    //        { 
    //          type: 'AI_TOOL_RESPONSE', 
    //          payload: {
    //            success: message.payload?.success ?? true,
    //            result: message.payload?.result,
    //            content: message.payload?.result?.content || message.payload?.result || JSON.stringify(message.payload?.result),
    //            name: message.payload?.name,
    //            arguments: message.payload?.arguments,
    //            tool_call_id: message.payload?.tool_call_id
    //          }, 
    //          tabId: message.tabId 
    //        },
    //        (response) => {
    //          clearTimeout(timeoutId);
    //          if (chrome.runtime.lastError) {
    //            ccLogger.error('Error in AI_TOOL_RESPONSE:', chrome.runtime.lastError);
    //            reject(chrome.runtime.lastError);
    //          } else {
    //            ccLogger.debug('AI tool response processed:', response);
    //            // Now send completion through secure channel
    //            window.postMessage({
    //              type: 'CARBON_AI_TOOL_RESPONSE_COMPLETE',
    //              payload: response
    //            }, window.location.origin);
    //            resolve(response);
    //          }
    //        }
    //      );
    //    });
//
    //    return true; // Keep message channel open
    //  } catch (error) {
    //    ccLogger.error('Error processing tool response:', error);
    //    window.postMessage({
    //      type: 'CARBON_AI_TOOL_RESPONSE_COMPLETE',
    //      payload: { 
    //        success: false,
    //        error: error.message || 'Unknown error',
    //        content: error.message || 'Unknown error'
    //      }
    //    }, window.location.origin);
    //  }
    //  break;

    //case 'SET_OPENAI_KEY':
    //  ccLogger.debug('Setting OpenAI key');
    //  const keyResponse = await new Promise((resolve, reject) => {
    //    chrome.runtime.sendMessage(
    //      { type: 'SET_OPENAI_KEY', payload: message.payload, tabId: message.tabId },
    //      (setKeyResponse) => {
    //        if (chrome.runtime.lastError) {
    //          ccLogger.error('Error setting OpenAI key:', chrome.runtime.lastError);
    //          reject(chrome.runtime.lastError);
    //        } else {
    //          ccLogger.debug('OpenAI key set response:', setKeyResponse);
    //          if (setKeyResponse.success && !message.payload.test) {
    //            // Send provider status update directly to window
    //            window.postMessage({
    //              type: 'PROVIDER_STATUS_UPDATE',
    //              provider: 'openai',
    //              status: true
    //            }, window.location.origin);
    //          }
    //          resolve(setKeyResponse);
    //        }
    //      }
    //    );
    //  });
    //  break;
//
    case 'GET_SETTINGS':
      ccLogger.debug('Fetching settings');
      const settings = await getCarbonBarSettings();
      sendResponseMsg({
        ...settings || {}
      });
      break;

    case 'GET_KEYBIND':
      ccLogger.debug('Fetching keybind');
      const keybind = await CCLocalStorage.get('carbonbar_keybind');
      window.postMessage({
        type: 'SET_KEYBIND',
        payload: keybind || { key: 'k', ctrl: true, meta: false }
      }, window.location.origin);
      ccLogger.debug('Keybind sent');
      break;

    case 'GET_ENCRYPTED_VALUE':
      
      const value = await CCLocalStorage.getEncrypted(message.payload.key);
      ccLogger.debug('Fetching encrypted value', message.payload.key, value);
      sendResponseMsg({
        key: message.payload.key,
        value: value
      });
      break;

    case 'SAVE_ENCRYPTED_VALUE':
      ccLogger.debug('Saving encrypted value');
      try {
        await CCLocalStorage.setEncrypted(message.payload.key, message.payload.value);
        ccLogger.debug('Encrypted value saved');
      } catch (error) {
        ccLogger.error('Error saving encrypted value:', error);
      }
      break;

    case 'DELETE_ENCRYPTED_VALUE':
      ccLogger.debug('Deleting encrypted value');
      await CCLocalStorage.removeEncrypted(message.payload.key);
      ccLogger.debug('Encrypted value deleted');
      break;

    case 'SAVE_SETTINGS':
      ccLogger.debug('Saving settings');
      try {
        // Remove encrypted keys from keyValuePairs, if they exist
        if(message.payload.encryptedKeys) {
          for(const [key, value] of message.payload.encryptedKeys.entries()) {
            message.payload.keyValuePairs?.delete(key);
          }
        }

        // Convert Maps to objects for storage
        message.payload.encryptedKeys = undefined;
        if(message.payload.keyValuePairs && message.payload.keyValuePairs instanceof Map) {
          message.payload.keyValuePairs = Object.fromEntries(message.payload.keyValuePairs);
        }
        if(message.payload.hostnamePrompts && message.payload.hostnamePrompts instanceof Map) {
          message.payload.hostnamePrompts = Object.fromEntries(message.payload.hostnamePrompts);
        }

        // Save settings
        await CCLocalStorage.set('carbonbar_settings', message.payload);
        ccLogger.debug('Settings saved, sending GET_SETTINGS');

        // Fire a GET_SETTINGS message
        await handleMessage(message, 'GET_SETTINGS');
      } catch (error) {
        ccLogger.error('Error saving settings:', error);
      }
      break;

    case 'GET_COMMAND_HISTORY':
      ccLogger.debug('Fetching command history');
      try {
        const hostname = message.payload.hostname;
        const history = await CCLocalStorage.getEncrypted(`carbonbar_command_history_${hostname}`);
        window.postMessage({
          type: 'CARBON_COMMAND_HISTORY_RESPONSE',
          payload: history ? JSON.parse(history) : [],
          _authToken: window.ccAuthToken
        }, window.location.origin);
        ccLogger.debug('Command history sent');
      } catch (error) {
        ccLogger.error('Error fetching command history:', error);
        window.postMessage({
          type: 'CARBON_COMMAND_HISTORY_RESPONSE',
          payload: [],
          _authToken: window.ccAuthToken
        }, window.location.origin);
      }
      break;

    case 'SAVE_COMMAND_HISTORY':
      ccLogger.debug('Saving command history');
      try {
        const hostname = message.payload.hostname;
        const historyToSave = JSON.stringify(message.payload.history);
        await CCLocalStorage.setEncrypted(`carbonbar_command_history_${hostname}`, historyToSave);
        ccLogger.debug('Command history saved');
      } catch (error) {
        ccLogger.error('Error saving command history:', error);
      }
      break;

    case 'GET_HISTORY_HOSTNAMES':
      ccLogger.debug('Fetching command history hostnames');
      try {
        const allKeys = await CCLocalStorage.getAllKeys();
        const historyKeys = allKeys
          .filter(key => key.startsWith('carbonbar_command_history_'))
          .map(key => key.replace('carbonbar_command_history_', ''));
        
        window.postMessage({
          type: 'CARBON_GET_HISTORY_HOSTNAMES_RESPONSE',
          payload: historyKeys,
          _authToken: window.ccAuthToken
        }, window.location.origin);
      } catch (error) {
        ccLogger.error('Error fetching history hostnames:', error);
        window.postMessage({
          type: 'CARBON_GET_HISTORY_HOSTNAMES_RESPONSE',
          payload: [],
          _authToken: window.ccAuthToken
        }, window.location.origin);
      }
      break;

    case 'CLEAR_COMMAND_HISTORY':
      ccLogger.debug('Clearing command history');
      try {
        const hostname = message.payload.hostname;
        await CCLocalStorage.remove(`carbonbar_command_history_${hostname}`);
        ccLogger.debug('Command history cleared');
      } catch (error) {
        ccLogger.error('Error clearing command history:', error);
      }
      break;

    // Handle all other messages to @chrome-ai-service.js ?
    default:
      if (message.type) {
        ccLogger.debug('Handling default message type:', unprefixedType, message);
        try {
          //if (unprefixedType === 'AI_EXECUTE_TOOL' && message.payload?.tool) {
          //  ccLogger.debug('Processing AI tool execution:', message.payload.tool);
          //  const toolResponse = await new Promise((resolve, reject) => {
          //    chrome.runtime.sendMessage(
          //      { 
          //        type: 'AI_TOOL_RESPONSE',
          //        payload: {
          //          success: true,
          //          result: message.payload.tool.result,
          //          content: message.payload.tool.result?.content || message.payload.tool.result || JSON.stringify(message.payload.tool.result),
          //          name: message.payload.tool.name,
          //          arguments: message.payload.tool.arguments,
          //          tool_call_id: message.payload.tool.id
          //        },
          //        tabId: message.tabId 
          //      },
          //      (response) => {
          //        if (chrome.runtime.lastError) {
          //          ccLogger.error('Error in AI tool execution:', chrome.runtime.lastError);
          //          reject(chrome.runtime.lastError);
          //        } else {
          //          ccLogger.debug('AI tool execution completed:', response);
          //          resolve(response);
          //        }
          //      }
          //    );
          //  });
          //  return true;
          //}

          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message,
              (defaultResponse) => {
                if (chrome.runtime.lastError) {
                  ccLogger.error('Error in message:', unprefixedType, chrome.runtime.lastError);
                  reject(chrome.runtime.lastError);
                } else if (defaultResponse) {
                  ccLogger.debug('Received response:', defaultResponse);
                  // Special handling for Ollama availability check
                  if (unprefixedType === 'CHECK_OLLAMA_AVAILABLE') {
                    window.postMessage({
                      type: 'PROVIDER_STATUS_UPDATE',
                      provider: 'ollama',
                      status: defaultResponse.available
                    }, window.location.origin);
                  } else if (unprefixedType === 'CHECK_OPENAI_AVAILABLE') {
                    window.postMessage({
                      type: 'PROVIDER_STATUS_UPDATE',
                      provider: 'openai',
                      status: defaultResponse.available
                    }, window.location.origin);
                  }
                  sendResponseMsg({
                    type: unprefixedType + '_RESPONSE',
                    payload: defaultResponse
                  });
                  resolve(defaultResponse);
                } else {
                  ccLogger.debug('No response received');
                  resolve();
                }
              }
            );
          });
        } catch (error) {
          ccLogger.error('Error handling message2:', error);
          sendResponseMsg({
            type: unprefixedType + '_ERROR',
            payload: { error: error.message || 'Unknown error' }
          });
        }
      } else {
        ccLogger.error('Handling default message type:', unprefixedType, message);
      }
      break;
  }
}

//const aiRequest = async (event) => {
//    try {
//        const tabId = event.data.tabId || (await getCurrentTabId());
//        ccLogger.debug('AI_REQUEST', event.data.payload, tabId);
//        
//        return await new Promise((resolve, reject) => {
//            const messageHandler = (response) => {
//                ccLogger.debug('AI_REQUEST_RESPONSE', response);
//                if (chrome.runtime.lastError) {
//                    ccLogger.error('[aiRequest] AI_REQUEST_RESPONSE1', response);
//                    reject(new Error(chrome.runtime.lastError.message));
//                } else if (response && response.error) {
//                    ccLogger.error('[aiRequest] AI_REQUEST_RESPONSE2', response);
//                    reject(new Error(response.error));
//                } else {
//                    ccLogger.debug('[aiRequest] AI_REQUEST_RESPONSE3', response);
//                    resolve(response);
//                }
//            };
//
//            chrome.runtime.sendMessage(
//                { type: 'AI_REQUEST', payload: event.data.payload, tabId },
//                messageHandler
//            );
//        });
//    } catch (error) {
//        ccLogger.error('AI_RESPONSE_ERROR2:', error);
//        throw error;
//    }
//}

// Replace the getCurrentTabId function with a simpler version that uses the meta tag
//function getCurrentTabId() {
//    return new Promise((resolve) => {
//        const tabIdMeta = document.querySelector('meta[name="tabId"]');
//        if (tabIdMeta) {
//            resolve(tabIdMeta.getAttribute('content'));
//        } else {
//            ccLogger.error('TabId meta tag not found');
//            resolve(null);
//        }
//    });
//}