/**
 * Implements secure message passing between the webpage and extension using HMAC
 * signatures and key ratcheting. Replaces standard window.postMessage for 
 * CarbonCommander messages.
 */

// This file will be injected before the main carbonbar script
(function() {
  const ccLogger = {
    log: console.log.bind(console, '[CARBONBAR-SECURE]'),
    info: console.info.bind(console, '[CARBONBAR-SECURE]'),
    warn: console.warn.bind(console, '[CARBONBAR-SECURE]'),
    error: console.error.bind(console, '[CARBONBAR-SECURE]'),
    debug: console.debug.bind(console, '[CARBONBAR-SECURE]'),
    group: console.group.bind(console, '[CARBONBAR-SECURE]'),
    groupEnd: console.groupEnd.bind(console, '[CARBONBAR-SECURE]'),
  }
  const ccSecureMessaging = {
    hmacKey: null,
    messageCounter: 0,
    pendingMessages: new Map(), // Track messages waiting for response
    activeChannels: new Map(), // Track active message channels and their keys

    /**
     * Creates a canonical JSON string with deterministic property ordering
     * @param {Object} obj - The object to canonicalize
     * @returns {string} Canonical JSON string
     */
    canonicalizeJson(obj) {
      if (Array.isArray(obj)) {
        return '[' + obj.map(item => this.canonicalizeJson(item)).join(',') + ']';
      } else if (typeof obj === 'object' && obj !== null) {
        return '{' + Object.keys(obj)
          .sort() // Sort keys alphabetically
          .map(key => {
            const value = obj[key];
            // Skip undefined values and functions
            if (value === undefined || typeof value === 'function') {
              return '';
            }
            return JSON.stringify(key) + ':' + this.canonicalizeJson(value);
          })
          .filter(Boolean) // Remove empty strings from undefined values
          .join(',') + '}';
      }
      return JSON.stringify(obj);
    },

    async verifySignature(message, signature, key) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(message));
        return await crypto.subtle.verify(
          "HMAC",
          key,
          signature,
          data
        );
      } catch (error) {
        ccLogger.error('Error verifying signature:', error);
        return false;
      }
    },

    async deriveNextKey(currentKey, salt) {
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
    },

    async initialize() {
      try {
        // Get the key from the script's data attribute
        const script = document.currentScript;
        if (!script) {
          throw new Error('Script context not available');
        }
        
        const keyBase64 = script.getAttribute('cc-data-key');
        if (!keyBase64) {
          throw new Error('Initialization key not found');
        }

        const rawKey = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
        this.hmacKey = await crypto.subtle.importKey(
          "raw",
          rawKey,
          {
            name: "HMAC",
            hash: { name: "SHA-256" }
          },
          true, // Make key extractable for ratcheting
          ["sign", "verify"]
        );
        this.messageCounter = 0;
      } catch (error) {
        ccLogger.error('Error initializing secure messaging:', error);
      }
    },

    async verifyAndSend(message, returnFunc) {
      try {
        ccLogger.group(`Secure Message Send`);
        ccLogger.log('Sending secure message:', { type: message.type, payload: message.payload });
        
        if (!this.hmacKey) {
          ccLogger.error('HMAC key not initialized');
          ccLogger.groupEnd();
          return new Error('HMAC key not initialized');
        }

        // Create a promise that will resolve when we get a response
        const responsePromise = new Promise((resolve, reject) => {
          const messageId = `${Date.now()}-${Math.random()}`;
          ccLogger.log('Created message channel with ID:', messageId);
          
          const channel = new MessageChannel();
          const messageKey = this.hmacKey; // Capture current key state for this message

          // Add message metadata while preserving original type
          const enrichedMessage = {
            ...message,
            _messageId: messageId,
            _counter: this.messageCounter++
          };
          const messageType = enrichedMessage.type;
          ccLogger.log('Enriched message:', { type: enrichedMessage.type, counter: enrichedMessage._counter });

          // Store message context with isolated key state
          this.pendingMessages.set(messageId, {
            resolve,
            reject,
            channel,
            currentKey: messageKey,
            timeout: setTimeout(() => {
              ccLogger.warn('Message timeout for ID:', messageId);
              this.cleanupChannel(messageId, new Error('Message timeout'));
            }, 120000) // Cleanup after 2 minutes
          });

          // Store channel reference
          this.activeChannels.set(messageId, {
            port1: channel.port1,
            port2: channel.port2,
            currentKey: messageKey
          });

          // Start port immediately
          channel.port1.start();
          ccLogger.log('Started message port for ID:', messageId);

          // Listen for response
          channel.port1.onmessage = async (event) => {
            ccLogger.group('Secure Message Response');
            ccLogger.log('Received response on port:', { messageId, data: event.data });
            
            try {
              const { data, signature, counter, error } = event.data;

              if (error) {
                ccLogger.error('Error in response:', error);
                this.cleanupChannel(messageId, new Error(error));
                ccLogger.groupEnd();
                return;
              }

              const pendingMessage = this.pendingMessages.get(messageId);
              const activeChannel = this.activeChannels.get(messageId);
              
              if (!pendingMessage || !activeChannel) {
                ccLogger.error('No pending message or active channel found for ID:', messageId);
                ccLogger.groupEnd();
                return;
              }

              ccLogger.log('Verifying message signature...');
              // Verify the message with message-specific key
              const isValid = await this.verifySignature(data, signature, pendingMessage.currentKey);

              if (isValid) {
                ccLogger.log('Message signature valid');
                // Derive next key using current message as salt
                const nextKey = await this.deriveNextKey(
                  pendingMessage.currentKey,
                  `${messageId}-${counter}`
                );

                if (nextKey) {
                  this.hmacKey = nextKey;
                  ccLogger.log('Updated HMAC key');
                }

                // Forward verified message while preserving type
                const { _messageId, _counter, ...cleanMessage } = data;
                ccLogger.log('Forwarding verified message:', { type: cleanMessage.type });


                //


                pendingMessage.resolve(cleanMessage);
                this.cleanupChannel(messageId);
              } else {
                ccLogger.error('Invalid message signature');
                this.cleanupChannel(messageId, new Error('Invalid message signature'));
              }
            } catch (error) {
              ccLogger.error('Error processing response:', error);
              this.cleanupChannel(messageId, error);
            }
            ccLogger.groupEnd();
          };

          // Handle port errors
          channel.port1.onerror = (error) => {
            ccLogger.error('Port error for message ID:', messageId, error);
            this.cleanupChannel(messageId, error);
          };

          // Send message through secure channel
          ccLogger.log('Setting up secure channel for message ID:', messageId);
          window.postMessage(
            { 
              type: 'SECURE_MESSAGE',
              port: channel.port2,
              messageId
            },
            '*',
            [channel.port2]
          );

          // Send the actual message through the port
          ccLogger.log('Sending message through port:', { type: enrichedMessage.type });
          channel.port1.postMessage(enrichedMessage);
        });

        // Wait for response and forward it with original type
        const response = await responsePromise;
        if (response) {
          



          // If returnFunc is provided, call it with the response instead of forwarding
          if (returnFunc) {
            ccLogger.log('Calling returnFunc with response:', response);
            returnFunc(response);
          } else if (response.type && response.type.endsWith('_RESPONSE')) {
            // Only forward the response if no returnFunc provided
            ccLogger.log('Forwarding response:', { type: response.type });
            originalPostMessage.call(window, response, window.location.origin);
          } else {
            ccLogger.log('No returnFunc or response sent. Closing channel for:', messageId);
            this.cleanupChannel(messageId);
          }

          ccLogger.groupEnd();
        } else {
          ccLogger.error('No response from extension');
          ccLogger.groupEnd();
          return response;
        }
      } catch (error) {
        ccLogger.error('Error in secure messaging:', error);
        ccLogger.groupEnd();
      }
    },

    cleanupChannel(messageId, error = null) {
      ccLogger.log('Cleaning up channel:', messageId);
      const pending = this.pendingMessages.get(messageId);
      const active = this.activeChannels.get(messageId);
      
      if (pending) {
        clearTimeout(pending.timeout);
        if (error) {
          ccLogger.error('Channel cleanup with error:', error);
          pending.reject(error);
        }
      }
      
      if (active) {
        active.port1.close();
        active.port2.close();
      }
      
      this.pendingMessages.delete(messageId);
      this.activeChannels.delete(messageId);
      ccLogger.log('Channel cleanup complete');
    }
  };

  // Store original postMessage
  const originalPostMessage = window.postMessage;

  // Replace window.postMessage with secure version for carbonbar
  window.postMessage = async function(message, targetOrigin, transfer) {

    let promise = new Promise((resolve, reject) => {
      if (message && message.type) {
        if (message.type.startsWith('CARBON_')) {
          ccLogger.log('Intercepted CARBON_ message:', { type: message.type });
          // Skip secure channel for completion and response messages
          //f (message.type === 'CARBON_AI_TOOL_RESPONSE_COMPLETE' || 
          //   message.type === 'CARBON_AI_RESPONSE_CHUNK' ||
          //   message.type === 'CARBON_AI_RESPONSE_ERROR') {
          // ccLogger.log('[SECURITYDEBUG] Passing through direct message:', { type: message.type });
          // originalPostMessage.call(window, message, targetOrigin, transfer);
          // return;
          //
          ccSecureMessaging.verifyAndSend(message, (response) => {
            ccLogger.log('Secure message response:', response);
            resolve(response);
          }).catch((error) => {
            reject(error);
          });
        } else if (message.type.endsWith('_RESPONSE')) {
          ccLogger.log('Passing through response message:', { type: message.type });
          // Add CARBON_ prefix to response messages for consistent handling
          const carbonMessage = {
            ...message,
            type: 'CARBON_' + message.type
          };
          originalPostMessage.call(window, carbonMessage, targetOrigin, transfer);
          resolve();
          
        } else {
          ccLogger.log('Passing through non-CARBON message:', { type: message.type }, message);
          originalPostMessage.call(window, message, targetOrigin, transfer);
          resolve();
        }
      } else {
        originalPostMessage.call(window, message, targetOrigin, transfer);
        resolve();
      }
      //resolve();
    });

    return promise;
  };

  // Initialize immediately using the script's data attribute
  ccSecureMessaging.initialize();
})(); 