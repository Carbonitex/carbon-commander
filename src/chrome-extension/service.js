/**
 * Service script that acts as a bridge between the webpage and Chrome extension.
 * Handles secure communication, storage management, and initialization of the 
 * CarbonCommander interface.
 */

import CCLocalStorage from '../chrome-serviceworker/local-storage.js';
import { ccLogger } from '../global.js';

const inIframe = window.self !== window.top;

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

    // Ensure settings is an object
    settings = settings || {};

    // Generate secure token for this session
    const authToken = generateSecureToken();
    window.ccAuthToken = authToken;

    // Send all initial values to the window
    try {
      if (settings) {
        window.postMessage({
          type: 'SETTINGS_LOADED',
          payload: {
            ...settings,
            _authToken: authToken // Include auth token in settings
          }
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

    ccLogger.debug('Injecting carbonbar script:', file_path, currentTabId);
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
    secureMessagingScript.setAttribute('data-key', keyBase64);
    node.appendChild(secureMessagingScript);

    // Initialize secure messaging after script loads
    secureMessagingScript.onload = () => {
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
    };
  });
}

// make sure this only gets injected once
if (!window.carbonBarInjected && !inIframe) {
  ccLogger.debug('Injecting carbonbar script:', chrome.runtime.getURL('carbon-commander.js'));
  injectCarbonBar(chrome.runtime.getURL('carbon-commander.js'), 'body');
  window.carbonBarInjected = true;

  // Handle messages from chrome.runtime
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Forward messages from background to window without secure messaging
    if (message.type === 'FROM_BACKGROUND' || message.type === 'AI_EXECUTE_TOOL') {
      window.postMessage(message, window.location.origin);
    }
    // Always return true to indicate we will send a response asynchronously
    return true;
  });

  // Listen for messages from the injected script
  window.addEventListener('message', async (event) => {
    ccLogger.debug('Received message:', event);
    // We only accept messages from ourselves
    if (event.source !== window) {
      return;
    }

    // Only use secure messaging for CARBON_ prefixed messages from carbon-commander.js
    if (event.data.type && event.data.type.startsWith('CARBON_')) {
      // Handle secure message channel setup
      if (event.data.type === 'SECURE_MESSAGE') {
        const port = event.ports[0];
        const messageId = event.data.messageId;
        if (!port || !messageId) return;

        // Start port immediately to prevent closure
        port.start();

        port.onmessage = async (e) => {
          try {
            const message = e.data;
            const counter = message._counter;
            
            // Sign the message with current key
            const signature = await createSignedMessage(message, window.ccHMACKey);
            
            // Send signed message back through the secure channel
            port.postMessage({
              data: message,
              signature: signature,
              counter: counter
            });

            // Derive and update to next key
            const nextKey = await deriveNextKey(
              window.ccHMACKey,
              `${messageId}-${counter}`
            );

            if (nextKey) {
              window.ccHMACKey = nextKey;
            }
          } catch (error) {
            ccLogger.error('Error in secure message handling:', error);
            // Send error back through port
            port.postMessage({
              error: error.message,
              counter: message?._counter
            });
          }
        };

        // Handle port closure
        port.onclose = () => {
          ccLogger.debug('Secure message port closed:', messageId);
        };

        return;
      }

      // Verify auth token for secure messages
      if (!event.data.authToken || event.data.authToken !== window.ccAuthToken) {
        ccLogger.error('Invalid or missing auth token in message', event.data.authToken, window.ccAuthToken);
        return;
      }
    }

    // Handle messages based on type
    try {
      switch(event.data.type) {
        case 'CARBON_AI_REQUEST':
          var response = await aiRequest(event);
          ccLogger.debug('AI_REQUEST_RESPONSE', response);
          break;

        case 'CARBON_AI_TOOL_RESPONSE':
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { type: 'AI_TOOL_RESPONSE', payload: event.data.payload, tabId: event.data.tabId },
              (response) => {
                if (chrome.runtime.lastError) {
                  ccLogger.error('Error in AI_TOOL_RESPONSE:', chrome.runtime.lastError);
                  reject(chrome.runtime.lastError);
                } else {
                  ccLogger.debug('AI_TOOL_RESPONSE_RESULT', response);
                  resolve(response);
                }
              }
            );
          });
          break;

        case 'CARBON_CONFIRMATION_DIALOG_RESPONSE':
          await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { 
                type: 'CONFIRMATION_DIALOG_RESPONSE', 
                payload: event.data.payload,
                tabId: event.data.tabId 
              },
              (response) => {
                resolve(response);
              }
            );
          });
          break;

        case 'CARBON_INPUT_DIALOG_RESPONSE':
          await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { 
                type: 'INPUT_DIALOG_RESPONSE', 
                payload: event.data.payload,
                tabId: event.data.tabId 
              },
              (response) => {
                resolve(response);
              }
            );
          });
          break;

        case 'CARBON_GET_COMMAND_HISTORY':
          const history = await CCLocalStorage.get('carbonbar_command_history');
          window.postMessage({
            type: 'COMMAND_HISTORY_LOADED',
            payload: history || []
          }, window.location.origin);
          break;

        case 'CARBON_GET_AUTOCOMPLETE':
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { 
                type: 'GET_AUTOCOMPLETE', 
                payload: event.data.payload,
                tabId: window.tabId
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  ccLogger.error('Error in GET_AUTOCOMPLETE:', chrome.runtime.lastError);
                  reject(chrome.runtime.lastError);
                } else {
                  window.postMessage({
                    type: 'AUTOCOMPLETE_SUGGESTION',
                    payload: {
                      text: response,
                      requestId: event.data.payload.requestId
                    }
                  }, window.location.origin);
                  resolve(response);
                }
              }
            );
          });
          break;

        // Handle all other messages without secure messaging
        default:
          if (event.data.type) {
            await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                { 
                  type: event.data.type, 
                  payload: event.data.payload,
                  tabId: event.data.tabId 
                },
                (response) => {
                  if (chrome.runtime.lastError) {
                    ccLogger.error('Error in message:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                  } else if (response) {
                    window.postMessage({
                      type: event.data.type + '_RESPONSE',
                      payload: response
                    }, window.location.origin);
                    resolve(response);
                  } else {
                    resolve();
                  }
                }
              );
            });
          }
          break;
      }
    } catch (error) {
      ccLogger.error('Error handling message:', error);
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

// Add ratcheting key derivation function
async function deriveNextKey(currentKey, salt) {
  try {
    // Export current key to raw bytes
    const rawKey = await crypto.subtle.exportKey("raw", currentKey);
    
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