/**
 * Implements secure message passing between the webpage and extension using HMAC
 * signatures and key ratcheting. Replaces standard window.postMessage for 
 * CarbonCommander messages.
 */

// This file will be injected before the main carbonbar script
(function() {
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
        console.error('Error verifying signature:', error);
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
        console.error('Error deriving next key:', error);
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
        
        const keyBase64 = script.getAttribute('data-key');
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
        console.error('Error initializing secure messaging:', error);
      }
    },

    async verifyAndSend(message) {
      try {
        console.group('Secure Message Send');
        console.log('Sending secure message:', { type: message.type, payload: message.payload });
        
        if (!this.hmacKey) {
          console.error('HMAC key not initialized');
          console.groupEnd();
          return;
        }

        // Create a promise that will resolve when we get a response
        const responsePromise = new Promise((resolve, reject) => {
          const messageId = `${Date.now()}-${Math.random()}`;
          console.log('Created message channel with ID:', messageId);
          
          const channel = new MessageChannel();
          const messageKey = this.hmacKey; // Capture current key state for this message

          // Add message metadata while preserving original type
          const enrichedMessage = {
            ...message,
            _messageId: messageId,
            _counter: this.messageCounter++
          };
          console.log('Enriched message:', { type: enrichedMessage.type, counter: enrichedMessage._counter });

          // Store message context with isolated key state
          this.pendingMessages.set(messageId, {
            resolve,
            reject,
            channel,
            currentKey: messageKey,
            timeout: setTimeout(() => {
              console.warn('Message timeout for ID:', messageId);
              this.cleanupChannel(messageId, new Error('Message timeout'));
            }, 30000) // Cleanup after 30 seconds
          });

          // Store channel reference
          this.activeChannels.set(messageId, {
            port1: channel.port1,
            port2: channel.port2,
            currentKey: messageKey
          });

          // Start port immediately
          channel.port1.start();
          console.log('Started message port for ID:', messageId);

          // Listen for response
          channel.port1.onmessage = async (event) => {
            console.group('Secure Message Response');
            console.log('Received response on port:', { messageId, data: event.data });
            
            try {
              const { data, signature, counter, error } = event.data;

              if (error) {
                console.error('Error in response:', error);
                this.cleanupChannel(messageId, new Error(error));
                console.groupEnd();
                return;
              }

              const pendingMessage = this.pendingMessages.get(messageId);
              const activeChannel = this.activeChannels.get(messageId);
              
              if (!pendingMessage || !activeChannel) {
                console.error('No pending message or active channel found for ID:', messageId);
                console.groupEnd();
                return;
              }

              console.log('Verifying message signature...');
              // Verify the message with message-specific key
              const isValid = await this.verifySignature(data, signature, pendingMessage.currentKey);

              if (isValid) {
                console.log('Message signature valid');
                // Derive next key using current message as salt
                const nextKey = await this.deriveNextKey(
                  pendingMessage.currentKey,
                  `${messageId}-${counter}`
                );

                if (nextKey) {
                  this.hmacKey = nextKey;
                  console.log('Updated HMAC key');
                }

                // Forward verified message while preserving type
                const { _messageId, _counter, ...cleanMessage } = data;
                console.log('Forwarding verified message:', { type: cleanMessage.type });
                pendingMessage.resolve(cleanMessage);
                this.cleanupChannel(messageId);
              } else {
                console.error('Invalid message signature');
                this.cleanupChannel(messageId, new Error('Invalid message signature'));
              }
            } catch (error) {
              console.error('Error processing response:', error);
              this.cleanupChannel(messageId, error);
            }
            console.groupEnd();
          };

          // Handle port errors
          channel.port1.onerror = (error) => {
            console.error('Port error for message ID:', messageId, error);
            this.cleanupChannel(messageId, error);
          };

          // Send message through secure channel
          console.log('Setting up secure channel for message ID:', messageId);
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
          console.log('Sending message through port:', { type: enrichedMessage.type });
          channel.port1.postMessage(enrichedMessage);
        });

        // Wait for response and forward it with original type
        const response = await responsePromise;
        if (response) {
          console.log('Forwarding final response:', { type: response.type });
          // Skip forwarding the original message since it will be handled by the service worker
          // Only forward the response
          if (response.type && response.type.endsWith('_RESPONSE')) {
            originalPostMessage.call(window, response, window.location.origin);
          }
        }
        console.groupEnd();
      } catch (error) {
        console.error('Error in secure messaging:', error);
        console.groupEnd();
      }
    },

    cleanupChannel(messageId, error = null) {
      console.log('Cleaning up channel:', messageId);
      const pending = this.pendingMessages.get(messageId);
      const active = this.activeChannels.get(messageId);
      
      if (pending) {
        clearTimeout(pending.timeout);
        if (error) {
          console.error('Channel cleanup with error:', error);
          pending.reject(error);
        }
      }
      
      if (active) {
        active.port1.close();
        active.port2.close();
      }
      
      this.pendingMessages.delete(messageId);
      this.activeChannels.delete(messageId);
      console.log('Channel cleanup complete');
    }
  };

  // Store original postMessage
  const originalPostMessage = window.postMessage;

  // Replace window.postMessage with secure version for carbonbar
  window.postMessage = function(message, targetOrigin, transfer) {
    if (message && message.type) {
      if (message.type.startsWith('CARBON_')) {
        console.log('Intercepted CARBON_ message:', { type: message.type });
        // Skip secure channel for completion and response messages
        if (message.type === 'CARBON_AI_TOOL_RESPONSE_COMPLETE' || 
            message.type === 'CARBON_AI_RESPONSE_CHUNK' ||
            message.type === 'CARBON_AI_RESPONSE_ERROR') {
          console.log('Passing through direct message:', { type: message.type });
          originalPostMessage.call(window, message, targetOrigin, transfer);
          return;
        }
        ccSecureMessaging.verifyAndSend(message);
      } else if (message.type.endsWith('_RESPONSE')) {
        console.log('Passing through response message:', { type: message.type });
        // Add CARBON_ prefix to response messages for consistent handling
        const carbonMessage = {
          ...message,
          type: 'CARBON_' + message.type
        };
        originalPostMessage.call(window, carbonMessage, targetOrigin, transfer);
      } else {
        console.log('Passing through non-CARBON message:', { type: message.type });
        originalPostMessage.call(window, message, targetOrigin, transfer);
      }
    } else {
      originalPostMessage.call(window, message, targetOrigin, transfer);
    }
  };

  // Initialize immediately using the script's data attribute
  ccSecureMessaging.initialize();
})(); 