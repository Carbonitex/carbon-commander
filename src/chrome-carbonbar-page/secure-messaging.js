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

    async deriveNextKey(currentKey, salt) {
      try {
        // Use HKDF to derive a new key
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
          "raw",
          currentKey,
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
        if (!this.hmacKey) {
          console.error('HMAC key not initialized');
          return;
        }

        // Create a promise that will resolve when we get a response
        const responsePromise = new Promise((resolve, reject) => {
          const messageId = `${Date.now()}-${Math.random()}`;
          const channel = new MessageChannel();

          // Add message metadata
          const enrichedMessage = {
            ...message,
            _messageId: messageId,
            _counter: this.messageCounter++
          };

          // Store message context
          this.pendingMessages.set(messageId, {
            resolve,
            reject,
            channel,
            currentKey: this.hmacKey,
            timeout: setTimeout(() => {
              this.cleanupChannel(messageId, new Error('Message timeout'));
            }, 30000) // Cleanup after 30 seconds
          });

          // Start port immediately
          channel.port1.start();

          // Listen for response
          channel.port1.onmessage = async (event) => {
            try {
              const { data, signature, counter, error } = event.data;

              if (error) {
                this.cleanupChannel(messageId, new Error(error));
                return;
              }

              const pendingMessage = this.pendingMessages.get(messageId);
              if (!pendingMessage) {
                console.error('No pending message found');
                return;
              }

              // Verify the message with current key
              const isValid = await crypto.subtle.verify(
                "HMAC",
                pendingMessage.currentKey,
                signature,
                new TextEncoder().encode(JSON.stringify(data))
              );

              if (isValid) {
                // Derive next key using current message as salt
                const nextKey = await this.deriveNextKey(
                  await crypto.subtle.exportKey("raw", pendingMessage.currentKey),
                  `${messageId}-${counter}`
                );

                if (nextKey) {
                  this.hmacKey = nextKey;
                }

                // Forward verified message
                const { _messageId, _counter, ...cleanMessage } = data;
                pendingMessage.resolve(cleanMessage);
                this.cleanupChannel(messageId);
              } else {
                this.cleanupChannel(messageId, new Error('Invalid message signature'));
              }
            } catch (error) {
              this.cleanupChannel(messageId, error);
            }
          };

          // Handle port errors
          channel.port1.onerror = (error) => {
            this.cleanupChannel(messageId, error);
          };

          // Send message through secure channel
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
          channel.port1.postMessage(enrichedMessage);
        });

        // Wait for response and forward it
        const response = await responsePromise;
        if (response) {
          // Use the original postMessage to forward the response
          originalPostMessage.call(window, response, window.location.origin);
        }
      } catch (error) {
        console.error('Error in secure messaging:', error);
      }
    },

    cleanupChannel(messageId, error = null) {
      const pending = this.pendingMessages.get(messageId);
      if (pending) {
        clearTimeout(pending.timeout);
        if (error) {
          pending.reject(error);
        }
        pending.channel.port1.close();
        pending.channel.port2.close();
        this.pendingMessages.delete(messageId);
      }
    }
  };

  // Store original postMessage
  const originalPostMessage = window.postMessage;

  // Replace window.postMessage with secure version for carbonbar
  window.postMessage = function(message, targetOrigin, transfer) {
    if (message && message.type && message.type.startsWith('CARBON_')) {
      ccSecureMessaging.verifyAndSend(message);
    } else {
      originalPostMessage.call(window, message, targetOrigin, transfer);
    }
  };

  // Initialize immediately using the script's data attribute
  ccSecureMessaging.initialize();
})(); 