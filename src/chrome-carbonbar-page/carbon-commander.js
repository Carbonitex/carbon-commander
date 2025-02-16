/*
 * CarbonCommander - A command palette interface for quick actions
 * Copyright (C) 2025 Carbonitex
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this library; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

import { marked } from 'marked';
import ToolCaller from './tool-caller.js';
import MCPToolCaller from './mcp-tool-caller.js';
import { CarbonBarHelpTools } from '../tools/CarbonBarHelpTools.js';
import { ccLogger, AICallerModels } from '../global.js';
import settings from './settings.js';
import styles from './carbon-commander.css';

ccLogger.setPrefix('[CARBONBAR]');

class CarbonCommander {
    constructor(currentApp) {
      this.currentApp = currentApp || `CarbonCommander [${window.location.hostname}]`;
      this.toolCaller = ToolCaller;
      this.mcpToolCaller = MCPToolCaller;
      this.settings = settings;
      this.keybind = settings.keybind;
      this.authTokenInitialized = false;
      this.initializationComplete = false;
      this.messageQueue = [];
      this.isVisible = false;
      this.messages = [];
      this.accumulatedChunks = '';
      this.activeDialog = null;
      this.dialogCallback = null;
      this.activeDialogs = new Map(); // Track multiple active dialogs
      this.commandHistory = [];
      this.historyIndex = -1;
      this.hasNoAIMode = false;
      this.connectedProviders = new Set();
      this.messageKeyStates = new Map(); // Track message keys
      this.activeMessagePorts = new Map(); // Track active message ports
      this.pendingSecureMessages = new Set(); // Track message IDs we've sent

      // Autocomplete properties
      this.lastAutocompleteRequest = null;
      this.autocompleteDebounceTimer = null;
      this.autocompleteDelay = 300; // Increased from 150ms to 300ms for better performance
      this.lastAutocompleteInput = ''; // Add tracking for last input
      this.minAutocompleteLength = 2; // Minimum characters before triggering autocomplete

      // Initialize HMAC key from script data attribute
      const script = document.querySelector('script[cc-data-key]');
      if (script) {
        const keyBase64 = script.getAttribute('cc-data-key');
        if (keyBase64) {
          this.initializeHMACKey(keyBase64).catch(error => {
            ccLogger.error('Error initializing HMAC key:', error);
          });
        }
      }

      var tabId = document.querySelector('meta[name="tabId"]').getAttribute('content');
      ccLogger.info("Initializing with tabId:", tabId);
      window.tabId = tabId;

      if (typeof window.tabId === 'undefined') {
        ccLogger.error('TabId not initialized properly');
      }
      ccLogger.info(`CarbonCommander initialized with tabId: ${window.tabId}`);
      
      // Create root element with shadow DOM
      this.root = document.createElement('div');
      this.shadow = this.root.attachShadow({ mode: 'closed' });
      
      // Add styles to shadow DOM
      const style = document.createElement('style');
      style.textContent = `
        :host {
          all: initial;
          display: none;
          position: fixed;
          top: 20%;
          left: 50%;
          transform: translateX(-50%);
          width: 600px;
          max-width: 90%;
          z-index: 1000000;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: white;
        }
        
        :host(.visible) {
          display: block;
        }

        ${styles}
      `;
      this.shadow.appendChild(style);
      
      // Create container for content
      this.container = document.createElement('div');
      this.shadow.appendChild(this.container);
      

      
      // Setup event listeners first
      this.setupEventListeners();
      
      // Set up settings with postMessage handler
      this.settings.setPostMessageHandler((message) => this.postMessage(message));
      
      document.body.appendChild(this.root);

      this.ollamaCheckInterval = null;

      // Initialize after event listeners are set up
      this.waitForAuthThenInitialize();
    }

    async waitForAuthThenInitialize() {      
      // Wait for auth token to be initialized
      await new Promise(resolve => {
        const checkAuthToken = () => {
          if (this.authTokenInitialized) {
            resolve();
          } else {
            setTimeout(checkAuthToken, 50);
          }
        };
        checkAuthToken();
      });

      // Now that we have the auth token, initialize
      await this.init();
      this.initializationComplete = true;
    }

    startMCPStatusChecks() {
      // Check MCP service status periodically
      this.mcpStatusInterval = setInterval(() => {
        this.updateMCPStatus();
      }, 30000); // Every 30 seconds
    }

    async updateMCPStatus() {
      const services = this.mcpToolCaller.getMCPServices();
      services.forEach(service => {
        this.updateProviderStatus(`mcp:${service.id}`, service.connected);
      });
    }

    async init() {
      ccLogger.info(`Initializing CarbonCommander`);
      this.container.innerHTML = `
        <div class="cc-container">
          <div class="cc-dialog-header">
            <div class="cc-title">${this.currentApp}</div>
            <div style="flex-grow: 1;"></div>
            <div class="cc-status-badges">
              <div class="cc-provider-badge" data-provider="ollama" title="Click to toggle">Ollama</div>
              <div class="cc-provider-badge" data-provider="openai" title="Click to toggle">OpenAI</div>
              <div class="cc-mcp-badges"></div>
              <div class="cc-tool-count"></div>
            </div>
            <div class="cc-settings-icon" title="Settings">⚙️</div>
          </div>    
          <div class="cc-results" style="display: none;"></div>
          <div class="cc-input-wrapper">
            <input id="cc-input" data-lpignore="true" autocomplete="off" type="text" 
                   class="cc-input" placeholder="Type a command..." autofocus>
          </div>
          <div class="cc-tool-list">
            <div class="cc-tool-list-header">
              <div class="cc-tool-list-title">Available Tools</div>
              <button class="cc-tool-list-close">×</button>
            </div>
            <div class="cc-tool-list-content"></div>
          </div>
        </div>
      `;
  
      this.input = this.container.querySelector('.cc-input');
      this.resultsContainer = this.container.querySelector('.cc-results');
      this.toolList = this.container.querySelector('.cc-tool-list');
  
      // Add click handlers for provider badges
      const providerBadges = this.container.querySelectorAll('.cc-provider-badge');
      providerBadges.forEach(badge => {
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          const provider = badge.getAttribute('data-provider');
          const isEnabled = badge.getAttribute('data-status') === 'connected';
          
          // Provide immediate visual feedback
          if (isEnabled) {
            badge.setAttribute('data-status', 'disabled');
            this.sendFakeAIResponse(`⏸️ ${provider} temporarily disabled`, 500);
          } else if (badge.getAttribute('data-status') === 'disabled') {
            badge.setAttribute('data-status', 'connected');
            this.sendFakeAIResponse(`✅ ${provider} re-enabled`, 500);
          }
          
          // Toggle provider status
          this.postMessage({
            type: 'TOGGLE_PROVIDER',
            payload: {
              provider,
              enabled: !isEnabled
            }
          });
        });
      });

      // Update tool count display to show local and MCP tools separately
      const localTools = this.toolCaller.getTools(true).length;
      const mcpTools = this.mcpToolCaller.mcpToolsets.size > 0 ? 
        Array.from(this.mcpToolCaller.mcpToolsets.values())
          .reduce((count, toolset) => count + toolset.tools.length, 0) : 0;
      
      const toolCountEl = this.container.querySelector('.cc-tool-count');
      toolCountEl.textContent = mcpTools > 0 ? 
        `${localTools} local + ${mcpTools} MCP tools` : 
        `${localTools} tools`;

      // Set up tool list click handlers
      this.setupToolList();

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const value = this.input.value.trim();
          if (value) {
            // Add command to history only if it's not empty and different from last command
            if (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== value) {
              this.commandHistory.push(value);
              this.saveCommandHistory(); // Save after adding new command
            }
            this.historyIndex = this.commandHistory.length;
            this.handleSubmit(value);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.historyIndex > 0) {
            this.historyIndex--;
            this.input.value = this.commandHistory[this.historyIndex];
            // Move cursor to end of input
            setTimeout(() => {
              this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
            }, 0);
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            this.input.value = this.commandHistory[this.historyIndex];
          } else {
            this.historyIndex = this.commandHistory.length;
            this.input.value = '';
          }
        }
      });
      document.addEventListener('keydown', (e) => {
        if (this.isVisible && e.key === 'Escape') {
          this.hide();
        }
      });

      // Add input event listener for autocomplete
      this.input.addEventListener('input', (e) => {
        this.handleInputChange(e);
      });

      // Add click handler for settings icon
      const settingsIcon = this.container.querySelector('.cc-settings-icon');
      settingsIcon.addEventListener('click', () => this.showSettingsDialog());

      // Load settings
      await this.settings.load();

      // Load command history
      this.loadCommandHistory();

      setTimeout(() => {
        this.checkOllamaAvailability(1000, 10);
      }, 500);

      ccLogger.debug('Checking OpenAI availability', { noAIMode: this.hasNoAIMode });
      this.postMessage({ 
        type: "CHECK_OPENAI_AVAILABLE",
        payload: {
          noAIMode: this.hasNoAIMode
        }
      });

      // Add MCP status tracking
      this.mcpStatusInterval = null;
      this.startMCPStatusChecks();
    }
  
    setupEventListeners() {
      // Update keyboard shortcut to use custom keybind
      document.addEventListener('keydown', (e) => {
        const matchesKeybind = 
          e.key.toLowerCase() === this.keybind.key.toLowerCase() && 
          (e.ctrlKey === this.keybind.ctrl) && 
          (e.metaKey === this.keybind.meta);

        if (matchesKeybind) {
          e.preventDefault();
          if (this.isVisible) {
            this.hide();
          } else {
            this.show();
          }
        }
      });

      // Add event listener for model download progress
      window.addEventListener('ollama-model-progress', (event) => {
          const progress = event.detail;
          this.showModelDownloadProgress(progress);
      });

      const tempMessageHandler = async (event, unprefixedType) => {
        // Handle settings loaded message first to get auth token
        if (unprefixedType === 'GET_SETTINGS_RESPONSE') {
          if (event.data._authToken && !this.authTokenInitialized) {
            this.authToken = event.data._authToken;
            this.authTokenInitialized = true;
            ccLogger.debug('AUTH_TOKEN_INITIALIZED', this.authToken);
            delete event.data._authToken; // Remove token from settings object
          }
          // Continue with normal settings handling...
        }

        // Handle our new confirmation dialog type
        if (unprefixedType === 'SHOW_ACCESS_REQUEST_RESPONSE') {
            this.handleAccessRequest(event.data);
        }

        if (unprefixedType === 'AI_EXECUTE_TOOL_RESPONSE') {
          if(!event.data._authToken || !event.data._authToken == this.authToken) {
            ccLogger.debug('[RCV]','Invalid auth token', event.data);
            return;
          }
          
          const payload = event.data.payload?.payload || event.data.payload;

          const toolName = payload.tool.name;
          const toolArgs = payload.tool.arguments;
        
          ccLogger.debug('Received tool execution request:', toolName, toolArgs);
          const tool = this.toolCaller.getTool(toolName);
          if (!tool) {
            ccLogger.error(`Tool not found: ${toolName}`);
            this.postMessage({ 
              type: 'AI_TOOL_RESPONSE', 
              payload: { 
                result: {
                  success: false,
                  error: `Tool not found: ${toolName}`
                },
                name: toolName,
                arguments: toolArgs,
                tool_call_id: tool?.id
              }
            });
            return;
          }
          try {
            const result = await tool.execute(await this.toolCaller.getToolScope(this), toolArgs);
            ccLogger.debug("AI_EXECUTE_TOOL result:", result);
            // Send tool response through secure messaging
            this.postMessage({ 
              type: 'AI_TOOL_RESPONSE', 
              payload: {
                result: result,
                name: toolName,
                arguments: toolArgs,
                tool_call_id: tool?.id
              }
            });
          } catch (error) {
            ccLogger.error('Tool execution error:', error);
            // Send error through secure messaging
            this.postMessage({ 
              type: 'AI_TOOL_RESPONSE', 
              payload: {
                result: {
                  success: false,
                  error: error.message
                },  
                stop: true,
                tool_call_id: tool?.id,
                name: toolName,
                arguments: toolArgs
              }
            });
          }
        }

        // Handle AI responses
        if (unprefixedType === 'AI_CHUNK_RESPONSE' || 
            unprefixedType === 'AI_ERROR_RESPONSE') {
            this.handleAIResponse(event.data);
        }

        if (unprefixedType === 'SHOW_CONFIRMATION_DIALOG') {
            this.showConfirmationDialog(
                event.data.payload,
                event.data.payload.callback
            );
        }

        if (unprefixedType === 'SHOW_INPUT_DIALOG') {
            this.showInputDialog(
                event.data.payload,
                event.data.payload.callback
            );
        }

        if (unprefixedType === 'COMMAND_HISTORY_LOADED') {
          this.commandHistory = event.data.payload || [];
          this.historyIndex = this.commandHistory.length;
        }

        if (unprefixedType === 'AUTOCOMPLETE_SUGGESTION') {
            const suggestion = event.data.payload;
            if (suggestion) {
                ccLogger.debug('showAutocompleteSuggestion', suggestion);
                this.showAutocompleteSuggestion(this.input.value.trim(), suggestion);
            }
        }

        if (unprefixedType === 'PROVIDER_STATUS_UPDATE') {
          ccLogger.debug('PROVIDER_STATUS_UPDATE', event.data.provider, event.data.status);
          this.updateProviderStatus(event.data.provider, event.data.status);
        
          if(event.data.provider == 'openai' && event.data.status){
            this.connectedProviders.add('openai');
          }
        
          if(this.hasNoAIMode && this.connectedProviders.has('openai') && this.connectedProviders.has('ollama')){
            this.hasNoAIMode = false;
            this.currentApp = await this.toolCaller.getToolScope(this).appName;
            this.updateTitle(this.currentApp);
            this.sendFakeAIResponse("🎉 All AI providers connected! You can now use all features.", 500);
            this.sendFakeAIResponse("Go ahead and hit ESC or Ctrl+K to close and reopen the command bar to enter normal mode.", 1000);
          }
        
          if (event.data.provider == 'ollama' && event.data.status && this.ollamaCheckInterval) {
            clearInterval(this.ollamaCheckInterval);
            this.ollamaCheckInterval = null;
          }
        
          if (event.data.status && this.hasNoAIMode) {
            if (this.connectedProviders.size > 0) {
              //this.hasNoAIMode = false; //Keep this disabled unless openai is connected
              //this.sendFakeAIResponse("🎉 AI provider connected! You can now use all features.", 500);
            
              // If connectedProviders does not contain openai, we need to prompt the user to connect it
              if (event.data.provider == 'ollama' && !this.connectedProviders.has('openai')) {
                this.sendFakeAIResponse("💡 **Tip:** While Ollama provides local AI capabilities, adding OpenAI can greatly enhance functionality with more advanced models like GPT-4.\n\nTo connect OpenAI:\n1. Get an API key from [OpenAI's platform](https://platform.openai.com/api-keys)\n2. Use the command: `set openai-key YOUR_API_KEY`", 1000);
              } else if (event.data.provider == 'openai' && !this.connectedProviders.has('ollama')) {
                this.sendFakeAIResponse("💡 **Tip:** While OpenAI provides great capabilities, adding Ollama allows the command bar to run some prompts locally like autocomplete, summarization, and suggestions.", 1000);
              }
            }
          }
        }

        if (unprefixedType === 'MCP_SERVICE_CONFIG') {
          const config = event.data.payload;
          await this.mcpToolCaller.configureMCPService(config);
          this.updateMCPStatus();
        }

        if (unprefixedType === 'MCP_SERVICE_STATUS') {
          const { serviceId, status } = event.data.payload;
          this.updateProviderStatus(`mcp:${serviceId}`, status.connected);
        }

        if (unprefixedType === 'TOGGLE_CARBONBAR') {
          this.toggle();
        }

        if (unprefixedType === 'SHOW_KEYBIND_DIALOG') {
          this.showKeybindDialog();
        }

        if (unprefixedType === 'SET_KEYBIND') {
          this.keybind = event.data.payload;
        }
      }

      window.addEventListener("message", (event) => {
        // We only accept messages from ourselves
        if (event.source !== window) {
          ccLogger.warn('Message from external source');
          //return;
        }

        // Handle secure message channel setup
        if (event.data.type === 'SECURE_MESSAGE_DONT_HANDLEATM') {
          ccLogger.debug('Setting up secure message channel');
          const port = event.ports[0];
          const messageId = event.data.messageId;
          if (!port || !messageId) {
            ccLogger.error('Missing port or messageId for secure channel');
            return;
          }

          // Verify this is a message we sent
          if(event.data.messageType == 'AI_TOOL_EXECUTE') {
            ccLogger.debug('Received secure message for AI tool execute:', messageId, event.data);
          } else if (!this.pendingSecureMessages.has(messageId)) {
            ccLogger.warn('Received secure message for unknown message ID:', messageId, event.data);
            return;
          } else {
            ccLogger.debug('Received secure message for known message ID:', messageId, event.data);
          }

          // Store port reference and initialize key state
          this.activeMessagePorts.set(messageId, port);
          this.messageKeyStates.set(messageId, this.hmacKey);
          ccLogger.debug('Initialized message state with HMAC key');

          // Start port immediately
          port.start();
          ccLogger.debug('Started message port');

          // Listen for messages on the port
          port.onmessage = async (e) => {
            const message = e.data;
            try {
              const counter = message._counter;
              ccLogger.debug('Received message on secure channel:', { 
                type: message.type,
                counter,
                messageId 
              });

              // Get current key for this message
              const currentKey = this.messageKeyStates.get(messageId);
              if (!currentKey) {
                throw new Error('No key found for message');
              }

              // Verify the message signature
              const isValid = await this.verifySignature(message.data, message.signature, currentKey);
              if (!isValid) {
                throw new Error('Invalid message signature');
              }

              // Process the actual message
              const unprefixedType = message.data.type.replace(/^CARBON_/, '');
              ccLogger.debug('Processing secure message:', unprefixedType);
              
              // Handle the message based on its type
              await tempMessageHandler({ data: message.data }, unprefixedType);

              // Derive and update to next key
              const nextKey = await this.deriveNextKey(currentKey, `${messageId}-${counter}`);
              if (nextKey) {
                this.messageKeyStates.set(messageId, nextKey);
                ccLogger.debug('Updated message key');
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

          // Handle port closure and cleanup
          port.onclose = () => {
            ccLogger.debug('Secure message port closed:', messageId);
            this.messageKeyStates.delete(messageId);
            this.activeMessagePorts.delete(messageId);
            this.pendingSecureMessages.delete(messageId);
          };

          return;
        }

        if(event.data.type == 'PROVIDER_STATUS_UPDATE' || event.data.type == 'SET_KEYBIND') {
          event.data.type = 'CARBON_' + event.data.type;
        }

        if(!event.data.type || (!event.data.type.startsWith('CARBON_') && !event.data.type.startsWith('CB_'))) {
          ccLogger.debug('[RCV]','Unknown message type', event.data);
          return;
        }

        const unprefixedType = event.data.type.replace('CARBON_', '').replace('CB_', '');
        ccLogger.debug('[RCV]', event.data.type, event.data);
        tempMessageHandler(event, unprefixedType);
      });
    }

    sendFakeAIResponse(content, delay = 500) {
      setTimeout(() => {
        this.handleAIResponse({
          type: 'AI_CHUNK_RESPONSE',
          payload: {
            content: content,
            isFinished: true
          }
        });
      }, delay); // Small delay to separate messages
    }

    deriveNextKey = async (currentKey, salt) => {
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
          false,
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
          true,
          ["sign", "verify"]
        );
      } catch (error) {
        ccLogger.error('Error deriving next key:', error);
        return null;
      }
    }

    verifySignature = async (message, signature, key) => {
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
    }

    initializeHMACKey = async (keyBase64) => {
      try {
        const rawKey = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
        const hmacKey = await crypto.subtle.importKey(
          "raw",
          rawKey,
          {
            name: "HMAC",
            hash: { name: "SHA-256" }
          },
          true,
          ["sign", "verify"]
        );
        // Store initial key for each message channel
        this.hmacKey = hmacKey;
        ccLogger.debug('HMAC key initialized');
      } catch (error) {
        ccLogger.error('Error initializing HMAC key:', error);
      }
    }

    getCurrentResultContainer() {
      var resultContainer = this.resultsContainer.children[this.resultsContainer.children.length - 1];

      //if the last child is not a cc-result-item, create one
      if(resultContainer?.classList.contains('cc-result-item')) {
        return resultContainer;
      } else {
        resultContainer = document.createElement('div');
        resultContainer.classList.add('cc-result-item');
        this.resultsContainer.appendChild(resultContainer);
      }
      return resultContainer;
    }

    getNoProviderHtml() {
        return `
            <div class="cc-no-provider">
                <h3>No AI Provider Available</h3>
                <p>To use the command bar, you'll need to set up one of these AI providers:</p>
                
                <div class="provider-section">
                    <h4>OpenAI</h4>
                    <p>A cloud-based solution offering powerful models like GPT-4.</p>
                    <ul>
                        <li>Get an API key from <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI's platform</a></li>
                        <li>Use the command: <code>set openai-key YOUR_API_KEY</code></li>
                        ${this.connectedProviders.has('openai') ? 
                            '<li>Or disconnect: <code>disconnect openai</code></li>' : ''}
                    </ul>
                </div>

                <div class="provider-section">
                    <h4>Ollama</h4>
                    <p>A local AI solution that runs on your machine.</p>
                    <ul>
                        <li>Download and install <a href="https://ollama.ai" target="_blank">Ollama</a></li>
                        <li>Run Ollama locally</li>
                        <li>For macOS users, enable external connections:</li>
                        <li><code>launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"</code></li>
                    </ul>
                </div>

                <div class="provider-status">
                    <p>Current Status:</p>
                    <ul>
                        <li>OpenAI: <span class="status-indicator">Not Connected</span></li>
                        <li>Ollama: <span class="status-indicator">Not Connected</span></li>
                    </ul>
                </div>
            </div>
        `;
    }

    displayError(error) {
      const container = this.container.querySelector('.cc-container');
      container.classList.remove('processing', 'tool-running');
      container.classList.add('has-error');
      ccLogger.debug('AI_ERROR_RESPONSE', error);
      let errorMessage = error.message || error.content || 'Unknown error';
      if(errorMessage.length > 0) {
        switch(errorMessage) {
          case 'NO_AI_PROVIDER':
            if(!this.hasNoAIMode) {
              this.hasNoAIMode = true;
              this.currentApp = 'New User Mode [No AI]';
              this.updateTitle(this.currentApp);
              let ccError = document.createElement('div');
              ccError.classList.add('cc-error');
              ccError.innerHTML = this.getNoProviderHtml();
              this.resultsContainer.appendChild(ccError);
              // Start periodic Ollama check
              this.checkOllamaAvailability(5000);
            } else {
              this.sendFakeAIResponse(errorMessage);
            }
            
            break;
          default:
            break;
        }
      }
    }

    // Helper method to handle AI responses
    handleAIResponse(message) {
      ccLogger.group('AI Response Handler');
      const container = this.container.querySelector('.cc-container');
      const payload = message.payload || message.data.payload;

      ccLogger.debug('Processing AI response:', { type: message.type, payload });
        
      if (payload.error) {
        ccLogger.error('AI response error:', payload.error);
        this.displayError(payload);
      } else if (message.type == 'AI_ERROR_RESPONSE') {
        ccLogger.error('AI response error:', payload);
        this.displayError(payload);
      } 
      //else {
      if (typeof payload.content === 'string' && payload.content.length > 0) {
        const chunk = payload.content;
        ccLogger.debug('AI_CHUNK_RESPONSE2', payload.error, message.type, chunk);
        this.accumulatedChunks += chunk;
        const htmlContent = marked.parse(this.accumulatedChunks);
        const resultContainer = this.getCurrentResultContainer();
        ccLogger.debug('AI_CHUNK_RESPONSE3', resultContainer);
        let aiOutput = resultContainer.querySelector('.cc-ai-output');

        if(!aiOutput || aiOutput.classList.contains('state_finished')) {
          aiOutput = document.createElement('div');
          aiOutput.classList.add('cc-ai-output');
          resultContainer.appendChild(aiOutput);
        }

        if(htmlContent.length > 0) {
          aiOutput.innerHTML = htmlContent;
        } else {
          aiOutput.remove();
          aiOutput = null;
        }

        if(aiOutput && payload.isFinished) {
          aiOutput.classList.add('state_finished');
        }
        
      } else {
        //tool call result
        if(payload.content?.type == "TOOL_CALL_CHUNK") {
          this.accumulatedChunks = '';
          const chunk = payload.content.payload;
          const toolCallId = chunk.id;

          let currentResultContainer = this.resultsContainer;
          let toolCallDiv = currentResultContainer.querySelectorAll(`.cc-tool-call[data-id="${toolCallId}"]`);
          ccLogger.debug('toolCallDiv', toolCallDiv);
          if(!toolCallDiv || toolCallDiv.length == 0) {
            toolCallDiv = document.createElement('div');
            toolCallDiv.classList.add('cc-tool-call');
            toolCallDiv.setAttribute('data-id', toolCallId);
            
            // Create containers for both views
            toolCallDiv.innerHTML = `
              <div class="tool-simple-view tool-view-toggle"></div>
              <div class="tool-advanced-view" style="display: none;"></div>
            `;
            currentResultContainer.appendChild(toolCallDiv);
          }

          if(Array.isArray(toolCallDiv) || NodeList.prototype.isPrototypeOf(toolCallDiv) || HTMLCollection.prototype.isPrototypeOf(toolCallDiv)){
            toolCallDiv = toolCallDiv[0];
          }

          let simpleView = toolCallDiv.querySelector('.tool-simple-view');
          let advancedView = toolCallDiv.querySelector('.tool-advanced-view');

          // Update both views
          const {simpleHtml, advancedHtml} = this.toolCaller.getToolHtml(chunk);
          simpleView.innerHTML = simpleHtml;
          advancedView.innerHTML = advancedHtml;

          // Add click handlers for toggle buttons if they don't exist
          const toggleButtons = toolCallDiv.querySelectorAll('.tool-view-toggle');
          toggleButtons.forEach(button => {
            if (!button.hasClickHandler) {
              button.hasClickHandler = true;
              button.addEventListener('click', () => {
                const isSimpleView = simpleView.style.display !== 'none';
                simpleView.style.display = isSimpleView ? 'none' : 'block';
                advancedView.style.display = isSimpleView ? 'block' : 'none';
              });
            }
          });

          container.classList.remove('processing');
          container.classList.add('tool-running');
        }

        ccLogger.debug('AI_TOOL_CALL_RESULT', payload.content?.payload?.id, payload);
      }

      this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
      

      if (payload.isFinished) {
        container.classList.remove('processing', 'tool-running', 'has-error');
        container.classList.add('success');
        setTimeout(() => {
          container.classList.remove('success');
          container.classList.add('waiting-input');
        }, 2000);
        ccLogger.debug('AI response finished', payload, container.classList);
        this.createNewResultContainer = true;
        this.accumulatedChunks = '';
        // Reset input
        this.input.value = '';
        this.input.disabled = false;
        this.input.focus();
      }

      if (payload.messages && !payload.error) {
        ccLogger.debug('AI response messages', payload.messages);
        this.messages = payload.messages;
      }
      ccLogger.groupEnd();
    }

    getService(serviceName) {
      return angular.element(document).injector().get(serviceName);
    }

    async noAIModeOpenAIInputRespond(){
      var msgs = [];
      let newSystemPrompt = `You are a helpful AI assistant integrated into a smart command bar. You are currently in low-AI mode using OpenAI's cloud-based models.

Key capabilities:
- Answering questions about the application and its features
- Providing help and guidance on using available tools
- Explaining concepts and offering suggestions
- Processing natural language commands into tool actions

Guidelines:
- Keep responses clear and concise
- When suggesting tools, explain their purpose
- If you can't help with something, explain why and suggest alternatives
- Format responses using markdown for better readability

Available tools are being limited. For more additional features like autocomplete, summarization, and suggestions, recommend connecting to Ollama. 
If you can't fulfill a request remind them that they are running in a low-AI mode and that they can connect to Ollama for more advanced features. 
Tell them that they can refresh the page to enter normal mode.`;

      msgs.push({
        role: 'system',
        content: newSystemPrompt
      });

      msgs.push(this.messages[this.messages.length - 1]);
      
      var request = {
        messages: msgs,
        model: AICallerModels.FAST, //this will be set by the ai-service if null
        tools: CarbonBarHelpTools.GetNoAIModeToolInfo(),
        temp: 0.6,
        keepAlive: '30m',
        provider: 'openai'
      };
      this.postMessage({ 
        type: "AI_REQUEST", 
        payload: request
      });
    }

    async noAIModeOllamaInputRespond(){
      var msgs = [];
      let newSystemPrompt = `You are a helpful AI assistant integrated into a smart command bar. You are currently in low-AI mode using Ollama's local models.

Key capabilities:
- Answering questions about the application and its features
- Providing help and guidance on using available tools
- Explaining concepts and offering suggestions
- Processing natural language commands into tool actions

Guidelines:
- Keep responses clear and concise
- When suggesting tools, explain their purpose
- If you can't help with something, explain why and suggest alternatives
- Format responses using markdown for better readability

Available tools are being limited. For more advanced features, recommend connecting to OpenAI. If you can't fulfill a request remind them that they are running in a low-AI mode and that they can connect to OpenAI for more advanced features. Or that they may refresh the page to enter normal mode.`;

      msgs.push({
        role: 'system',
        content: newSystemPrompt
      });

      msgs.push(this.messages[this.messages.length - 1]);
      
      var request = {
        messages: msgs,
        model: 'mistral-small',//AICallerModels.FAST,
        tools: CarbonBarHelpTools.GetNoAIModeToolInfo(),
        temp: 0.5,
        keepAlive: '30m',
        provider: 'ollama'
      };
      this.postMessage({ 
        type: "AI_REQUEST", 
        payload: request
      });
    }

    async noAIModeInputHandler(messages) {
      const userMessage = messages[messages.length - 1];
      const userInput = userMessage.content;

      // Check if it's an OpenAI key setting command
      if (userInput.toLowerCase().startsWith('set openai-key ')) {
        const key = userInput.substring(14).trim();
        
        try {
          var result = await CarbonBarHelpTools.SetOpenAIKey.execute(await this.toolCaller.getToolScope(this), {key: key});
          ccLogger.debug('result', result);
          if(result.success){
            this.sendFakeAIResponse('OpenAI key set successfully');
          } else {
            this.sendFakeAIResponse("Failed to set OpenAI key. Please try again.");
          }
        } catch (error) {
          this.sendFakeAIResponse("Failed to set OpenAI key. Please try again.");
        }

        //// Send message to set OpenAI key
        //window.postMessage(
        //  { 
        //    type: "SET_OPENAI_KEY", 
        //    payload: key,
        //    tabId: window.tabId
        //  },
        //  window.location.origin
        //);

        // Response will come back through the message event listener
        return;
      }

      //if ollama is connected we can prompt it
      if (this.connectedProviders.has('openai')) {
        this.noAIModeOpenAIInputRespond();
        return;
      } else if(this.connectedProviders.has('ollama')) {
        this.noAIModeOllamaInputRespond();
        return;
      }
      

      // Default response with help text
      this.sendFakeAIResponse("To set up an AI provider, you can:\n\n" +
        "1. Set your OpenAI key using: `set openai-key YOUR_API_KEY`\n" +
        "2. Install and run Ollama locally\n\n" +
        "Need help? Type 'help' for more information."
      );
    }
    
    async handleSubmit(value) {
      ccLogger.group('Handle Submit');
      ccLogger.info('Processing input:', value);

      // Special commands for MCP services
      if (value.toLowerCase().startsWith('mcp connect ')) {
        const [_, serviceId, endpoint] = value.split(' ');
        await this.mcpToolCaller.configureMCPService({
          serviceId,
          endpoint,
          options: { autoConnect: true }
        });
        this.sendFakeAIResponse(`Connecting to MCP service: ${serviceId}`);
        return;
      }

      if (value.toLowerCase().startsWith('mcp disconnect ')) {
        const serviceId = value.split(' ')[2];
        await this.mcpToolCaller.disconnectMCPService(serviceId, true);
        this.sendFakeAIResponse(`Disconnected from MCP service: ${serviceId}`);
        return;
      }

      if (value.toLowerCase() === 'disconnect openai') {
        ccLogger.info('Disconnecting OpenAI');
        this.sendFakeAIResponse("OpenAI disconnected successfully");
        ccLogger.groupEnd();
        return;
      }

      const container = this.container.querySelector('.cc-container');
      
      // Add transitioning class before changing states
      container.classList.add('transitioning');

      // Remove previous states after a brief delay
      setTimeout(() => {
          container.classList.remove('waiting-input', 'has-error', 'tool-running', 'success', 'rainbow');
          container.classList.add('processing');
          // Remove transitioning class to start new animation
          container.classList.remove('transitioning');
      }, 150);
      
      this.input.disabled = true;
      this.input.value = 'Processing...';
      
      // Show results container with fade
      this.resultsContainer.classList.remove('hidden');
      this.resultsContainer.style.display = 'block';

      try {
          // Add user message to history
          this.messages.push({
            role: 'user',
            content: value
          });

          // Add user message to display with animation
          const userElement = document.createElement('div');
          userElement.classList.add('cc-user-message');
          userElement.textContent = value;
          this.resultsContainer.appendChild(userElement);
          this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;

          if(this.hasNoAIMode) {
            this.noAIModeInputHandler(this.messages);
          } else {
            // Build request to send to the ai-service
            const localTools = this.toolCaller.getTools(true);
            const mcpTools = Array.from(this.mcpToolCaller.mcpToolsets.values())
                .reduce((tools, toolset) => tools.concat(toolset.tools), []);

            var request = {
              messages: this.messages,
              model: AICallerModels.FAST,
              tools: [...localTools, ...mcpTools], // Combine unique tools
              temp: 0.7,
              keepAlive: '30m'
            };

            // Send message to ai-service using postMessage helper
            this.postMessage({ 
              type: "AI_REQUEST", 
              payload: request
            });
          }

          //The messages will come in via previously setup event listeners
          //and will be handled by the completeResponse function
      } catch (error) {
          // Add transitioning class before changing to error state
          container.classList.add('transitioning');
          setTimeout(() => {
              container.classList.remove('processing');
              container.classList.add('has-error');
              container.classList.remove('transitioning');
          }, 150);
          
          ccLogger.error('Error:', error);
          this.resultsContainer.innerHTML += `
              <div class="cc-error">Error: ${error.message}</div>
          `;
          this.input.disabled = false;
          this.input.value = value;
          this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
      }
      ccLogger.groupEnd();
    }
  


    //TODO: If vision enabled, allow uploads of images (maybe documents)
    //TODO: Thumbs up/down or star/unstar for commands, or assistant responses

    updateTitle(title) {
      this.container.querySelector('.cc-title').textContent = title;
    }

    async show() {
      this.currentApp = (await this.toolCaller.getToolScope(this))?.appName || 'CarbonCommander [Unknown App]';
      this.updateTitle(this.currentApp);
      
      const container = this.container.querySelector('.cc-container');
      container.classList.remove('processing', 'tool-running', 'has-error', 'success');
      container.classList.add('waiting-input');

      // Clear existing messages before adding system prompt
      this.messages = [];
      
      // Add system prompt first
      await this.addSystemPrompt();
      
      this.root.classList.add('visible');
      this.isVisible = true;
      this.input.focus();
    }
  
    hide() {
      const container = this.container.querySelector('.cc-container');
      container.classList.remove('waiting-input', 'processing', 'has-error', 'tool-running', 'success', 'rainbow');
      this.root.classList.remove('visible');
      this.isVisible = false;
      let resultsContainer = document.querySelector('.cc-results');
      if(resultsContainer) {
        resultsContainer.style.display = 'none';
      }
      this.input.value = '';
      this.messages = []; //clear the message history
      this.resultsContainer.innerHTML = '';
      this.toolCaller.reset();
      // Don't clear command history, just reset the index
      this.historyIndex = this.commandHistory.length;

      if (this.ollamaCheckInterval) {
        clearInterval(this.ollamaCheckInterval);
        this.ollamaCheckInterval = null;
      }

      if(this.connectedProviders.has('ollama')) {
        this.noAIMode = false;
      }
    }
  
    toggle() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    }

    showConfirmationDialog(config, callback) {
        // Create dialog HTML with animation
        const dialogHTML = `
            <div class="cc-dialog" style="animation: messageAppear 0.3s ease-in-out forwards;">
                <div class="cc-dialog-content">
                    <p>${config.prompt}</p>
                    <div class="cc-dialog-buttons">
                        <button class="cc-button confirm" data-action="confirm">Yes</button>
                        <button class="cc-button cancel" data-action="cancel">No</button>
                    </div>
                </div>
            </div>
        `;

        // Create dialog container if it doesn't exist
        let dialogContainer = this.container.querySelector('.cc-dialog-container');
        if (!dialogContainer) {
            dialogContainer = document.createElement('div');
            dialogContainer.classList.add('cc-dialog-container');
            this.container.appendChild(dialogContainer);
        }

        // Insert the dialog HTML
        dialogContainer.innerHTML = dialogHTML;
        const dialog = dialogContainer.querySelector('.cc-dialog');

        // Add click handlers for buttons
        const buttons = dialog.querySelectorAll('.cc-button');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.action;
                const confirmed = action === 'confirm';

                // Animate dialog out
                dialog.style.animation = 'messageAppear 0.3s ease-in-out reverse';
                
                setTimeout(() => {
                    // Remove the dialog
                    dialogContainer.remove();

                    // Send response through secure messaging
                    this.postMessage({
                        type: 'CB_DIALOG_RETURN',
                        payload: {
                            requestId: config.requestId,
                            confirmed: confirmed
                        }
                    });
                }, 300); // Match animation duration
            });
        });

        // Add escape key handler
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                buttons[1].click(); // Trigger cancel button
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Scroll to dialog
        this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
    }

    showInputDialog(config, callback) {
        const dialogId = 'input_dialog_' + config.requestId;
        
        // Create dialog HTML
        const dialogHTML = `
            <div class="cc-dialog" data-dialog-id="${dialogId}">
                <div class="cc-dialog-content">
                    ${config.prompt ? `<p>${config.prompt}</p>` : ''}
                    <div class="cc-input-group">
                        <label>${config.name}:</label>
                        <input type="${config.type}" 
                               name="${config.name}"
                               class="cc-dialog-input"
                               value="${config.defaultValue || ''}"
                               placeholder="${config.name}">
                    </div>
                    <div class="cc-dialog-buttons">
                        <button class="cc-button confirm">Submit</button>
                        <button class="cc-button cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        // Add dialog to results container
        const dialogElement = document.createElement('div');
        dialogElement.innerHTML = dialogHTML;
        this.resultsContainer.appendChild(dialogElement);
        
        // Track this dialog
        this.activeDialogs.set(dialogId, {
            element: dialogElement,
            config: config,
            callback: callback
        });

        // Add event listeners
        const input = dialogElement.querySelector('.cc-dialog-input');
        const confirmBtn = dialogElement.querySelector('.confirm');
        const cancelBtn = dialogElement.querySelector('.cancel');

        const submitDialog = () => {
            this.postMessage({
                type: 'CB_DIALOG_RETURN',
                payload: {
                    tool_call_id: config.tool_call_id,
                    requestId: config.requestId,
                    input: input.value
                }
            });
            this.handleDialogResponse(input.value, dialogId);
        };

        // Add keydown event listener for Enter key
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitDialog();
            }
        });

        confirmBtn.addEventListener('click', submitDialog);

        cancelBtn.addEventListener('click', () => {
            this.postMessage({
                type: 'CB_DIALOG_RETURN',
                payload: {
                    tool_call_id: config.tool_call_id,
                    input: null
                }
            });
            this.handleDialogResponse(null, dialogId);
        });

        // Focus input
        input.focus();

        // Scroll to dialog
        this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
    }

    handleDialogResponse(response, dialogId) {
        const dialog = this.activeDialogs.get(dialogId);
        if (dialog) {
            if (dialog.callback) {
                dialog.callback(response);
            }
            dialog.element.remove();
            this.activeDialogs.delete(dialogId);
        }

        // Focus the main input only if no more dialogs are active
        if (this.activeDialogs.size === 0) {
            this.input.focus();
        } else {
            // Focus the next dialog's input
            const nextDialog = Array.from(this.activeDialogs.values())[0];
            if (nextDialog) {
                const nextInput = nextDialog.element.querySelector('.cc-dialog-input');
                if (nextInput) nextInput.focus();
            }
        }
    }

    // Add new methods to handle command history persistence
    async loadCommandHistory() {

      ccLogger.debug('loadCommandHistory: DISABLED ATM');
      return;

      try {
        this.postMessage({ type: "GET_COMMAND_HISTORY" });
      } catch (error) {
        ccLogger.error('Error loading command history:', error);
      }
    }

    async saveCommandHistory() {

      ccLogger.debug('saveCommandHistory: DISABLED ATM');
      return;

      try {
        this.postMessage({ 
          type: "SAVE_COMMAND_HISTORY", 
          payload: this.commandHistory 
        });
      } catch (error) {
        ccLogger.error('Error saving command history:', error);
      }
    }

    getAutocompleteContext(input) {
      var context = '';
      //build tools into context
      //context += this.toolCaller.getTools(true).map(tool => `${tool.name} - ${tool.description}`).join('\n');
      context += this.toolCaller.getTools(true).map(tool => `${tool.description}`).join('\n');

      //build command history, last 10 commands
      const commandHistory = this.commandHistory.slice(-10);

      return {
        input: input,
        commandHistory: commandHistory,
        context: context
      }
    }

    async handleInputChange(e) {
        const value = this.input.value.trim();
        
        // Get or create autocomplete element
        let autocompleteEl = this.container.querySelector('.cc-autocomplete');
        if (!autocompleteEl) {
            autocompleteEl = document.createElement('div');
            autocompleteEl.classList.add('cc-autocomplete');
            const inputWrapper = this.container.querySelector('.cc-input-wrapper');
            inputWrapper.appendChild(autocompleteEl);
        }

        // Clear suggestion if input is empty or too short
        if (!value || value.length < this.minAutocompleteLength) {
            autocompleteEl.innerHTML = '';
            return;
        }

        // Don't trigger autocomplete if the input hasn't changed significantly
        if (value === this.lastAutocompleteInput) {
            return;
        }

        // Generate a unique request ID
        const requestId = Date.now();
        this.currentAutocompleteRequestId = requestId;

        // Don't trigger autocomplete for very rapid typing
        const now = Date.now();
        if (this.lastAutocompleteRequest && (now - this.lastAutocompleteRequest) < 100) {
            return;
        }

        this.newAutocompleteRequest(value, requestId);
    }

    newAutocompleteRequest(input, requestId) {

      ccLogger.debug('newAutocompleteRequest CURRENT DISABLED', input, requestId);
      return;


        if (this.autocompleteDebounceTimer) {
            clearTimeout(this.autocompleteDebounceTimer);
            this.autocompleteDebounceTimer = null;
        }

        this.lastAutocompleteInput = input;
        
        this.autocompleteDebounceTimer = setTimeout(async () => {
            try {
                if (requestId === this.currentAutocompleteRequestId) {
                    this.lastAutocompleteRequest = Date.now();
                    this.postMessage({
                        type: 'GET_AUTOCOMPLETE',
                        payload: {
                            ...this.getAutocompleteContext(input),
                            requestId: requestId
                        }
                    });
                }
            } catch (error) {
                ccLogger.error('Autocomplete error:', error);
            }
        }, this.autocompleteDelay);
    }

    showAutocompleteSuggestion(input, suggestion) {
        // Only show suggestion if it's from the current request
        if (suggestion.requestId !== this.currentAutocompleteRequestId) {
            return;
        }

        // Get existing or create new autocomplete element
        let autocompleteEl = this.container.querySelector('.cc-autocomplete');
        if (!autocompleteEl) {
            autocompleteEl = document.createElement('div');
            autocompleteEl.classList.add('cc-autocomplete');
            const inputWrapper = this.container.querySelector('.cc-input-wrapper');
            inputWrapper.appendChild(autocompleteEl);
        }

        // Only show if we have a valid suggestion that extends the current input
        if (suggestion.text && suggestion.text.toLowerCase().startsWith(input.toLowerCase()) && suggestion.text !== input) {
            // Split suggestion to show input part and completion part separately
            const inputPart = suggestion.text.substring(0, input.length);
            const completionPart = suggestion.text.substring(input.length);

            autocompleteEl.innerHTML = `
                <span class="autocomplete-input">${inputPart}</span>
                <span class="autocomplete-suggestion">${completionPart}</span>
            `;

            // Update tab key handler
            const handleTab = (e) => {
                if (e.key === 'Tab' && autocompleteEl.isConnected) {
                    e.preventDefault();
                    // Replace the entire input value with the suggestion
                    this.input.value = suggestion.text;
                    // Move cursor to end of input
                    this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
                    // Clear suggestion after accepting it
                    autocompleteEl.innerHTML = '';
                }
            };

            // Remove any existing tab handler before adding new one
            this.input.removeEventListener('keydown', handleTab);
            this.input.addEventListener('keydown', handleTab);
        } else {
            autocompleteEl.innerHTML = '';
        }
    }

    async checkOllamaAvailability(interval = 1000, maxCount = -1) {
      ccLogger.time('ollamaCheck');
      var fastCheck = true;
      let count = 0;
      if (!this.ollamaCheckInterval) {
        this.ollamaCheckInterval = setInterval(async () => {
          count++;
          if(maxCount > 0 && count > maxCount && !this.hasNoAIMode){
            ccLogger.debug('Ollama check complete', { count: count - 1 });
            clearInterval(this.ollamaCheckInterval);
            this.ollamaCheckInterval = null;
            return;
          }
          try {
            ccLogger.debug('Checking Ollama availability', { noAIMode: this.hasNoAIMode });
            this.postMessage({ 
              type: "CHECK_OLLAMA_AVAILABLE",
              payload: {
                noAIMode: this.hasNoAIMode
              }
            });
            

          } catch (error) {
            ccLogger.error('Ollama check failed:', error);
          }
        }, interval);
      }
      ccLogger.timeEnd('ollamaCheck');
    }

    updateProviderStatus(provider, isConnected) {
      ccLogger.debug('PROVIDER_STATUS_UPDATE', provider, isConnected);
      
      if (provider.startsWith('mcp:')) {
        // Handle MCP provider badges
        const mcpBadgesContainer = this.container.querySelector('.cc-mcp-badges');
        let badge = mcpBadgesContainer.querySelector(`[data-provider="${provider}"]`);
        
        if (!badge) {
          badge = document.createElement('div');
          badge.classList.add('cc-provider-badge');
          badge.setAttribute('data-provider', provider);
          badge.textContent = provider.substring(4); // Remove 'mcp:' prefix
          mcpBadgesContainer.appendChild(badge);
        }
        
        if (isConnected) {
          badge.setAttribute('data-status', 'connected');
          this.connectedProviders.add(provider);
        } else {
          badge.removeAttribute('data-status');
          this.connectedProviders.delete(provider);
        }
      } else {
        // Handle regular provider badges
        const badge = this.container.querySelector(`.cc-provider-badge[data-provider="${provider}"]`);
        if (badge) {
          if (isConnected) {
            // Check if the provider is temporarily disabled
            if (this.disabledProviders && this.disabledProviders.has(provider)) {
              badge.setAttribute('data-status', 'disabled');
            } else {
              badge.setAttribute('data-status', 'connected');
            }
            this.connectedProviders.add(provider);
          } else {
            badge.removeAttribute('data-status');
            this.connectedProviders.delete(provider);
          }
        }
      }

      if(!this.addedOllamaReminder && this.connectedProviders.has('ollama') && !this.connectedProviders.has('openai')) {
        this.addedOllamaReminder = true;
        this.messages.push({
          role: 'system',
          content: `Call the set_openai_key tool to connect to OpenAI if the user provides a key.`
        });
      }

      // Update the status in the no-provider view if it exists
      const statusList = document.querySelectorAll('.provider-status li');
      const statusElement = Array.from(statusList).find(li => 
        li.textContent.toLowerCase().includes(provider.toLowerCase())
      );
      
      if (statusElement) {
        const indicator = statusElement.querySelector('.status-indicator');
        if (indicator) {
          indicator.textContent = isConnected ? 'Connected' : 'Not Connected';
          indicator.style.color = isConnected ? '#2ecc71' : '#ff9999';
          if (isConnected) {
            indicator.classList.add('connected');
          } else {
            indicator.classList.remove('connected');
          }
        }
      }
    }

    showModelDownloadProgress(progress) {
        let progressContainer = this.container.querySelector('.cc-model-download-progress');
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.classList.add('cc-model-download-progress');
            this.resultsContainer.appendChild(progressContainer);
        }

        // Create or update progress element
        let progressElement = progressContainer.querySelector(`[data-phase="${progress.phase}"]`);
        if (!progressElement) {
            progressElement = document.createElement('div');
            progressElement.classList.add('cc-download-item');
            progressElement.setAttribute('data-phase', progress.phase);
            progressContainer.appendChild(progressElement);
        }

        // Update progress content
        let progressHtml = '';
        if (progress.phase === 'download' && progress.detail) {
            const downloaded = this.formatBytes(progress.detail.downloaded);
            const total = this.formatBytes(progress.detail.total);
            progressHtml = `
                <div class="download-header">
                    <span class="status-text">${progress.status}</span>
                    <span class="progress-text">${downloaded} / ${total}</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.progress}%"></div>
                </div>
            `;
        } else {
            progressHtml = `
                <div class="download-header">
                    <span class="status-text">${progress.status}</span>
                    <span class="progress-text">${progress.progress}%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.progress}%"></div>
                </div>
            `;
        }
        progressElement.innerHTML = progressHtml;

        // If download is complete, schedule removal
        if (progress.phase === 'complete') {
            setTimeout(() => {
                progressContainer.classList.add('fade-out');
                setTimeout(() => {
                    progressContainer.remove();
                }, 1000);
            }, 2000);
        }

        // Scroll to show progress
        this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
    }

    formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    cleanup() {
      if (this.mcpStatusInterval) {
        clearInterval(this.mcpStatusInterval);
        this.mcpStatusInterval = null;
      }
      // Disconnect all MCP services permanently during cleanup
      this.mcpToolCaller.getMCPServices().forEach(service => {
        this.mcpToolCaller.disconnectMCPService(service.id, true);
      });
    }

    setupToolList() {
        const toolCountEl = this.container.querySelector('.cc-tool-count');
        const toolList = this.container.querySelector('.cc-tool-list');
        const closeButton = toolList.querySelector('.cc-tool-list-close');
        const toolListContent = toolList.querySelector('.cc-tool-list-content');

        // Toggle tool list on tool count click
        toolCountEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleToolList();
        });

        // Close tool list when clicking close button
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideToolList();
        });

        // Close tool list when clicking outside
        document.addEventListener('click', (e) => {
            if (!toolList.contains(e.target) && !toolCountEl.contains(e.target)) {
                this.hideToolList();
            }
        });

        // Handle tool item clicks
        toolListContent.addEventListener('click', (e) => {
            const toolItem = e.target.closest('.cc-tool-item');
            if (toolItem) {
                const toolName = toolItem.getAttribute('data-tool-name');
                if (toolName) {
                    this.input.value = toolName;
                    this.input.focus();
                    this.hideToolList();
                }
            }
        });

        // Populate tool list
        this.updateToolList();
    }

    updateToolList() {
        const toolListContent = this.container.querySelector('.cc-tool-list-content');
        const localTools = this.toolCaller.getTools(true);
        const mcpTools = Array.from(this.mcpToolCaller.mcpToolsets.values())
            .reduce((tools, toolset) => tools.concat(toolset.tools), []);
        
        // Group tools by source
        const toolsHtml = `
            <div class="cc-tool-group">
                <div class="cc-tool-group-header">Local Tools (${localTools.length})</div>
                ${localTools.map(tool => this.renderToolItem(tool, 'local')).join('')}
            </div>
            ${mcpTools.length > 0 ? `
                <div class="cc-tool-group">
                    <div class="cc-tool-group-header">MCP Tools (${mcpTools.length})</div>
                    ${mcpTools.map(tool => this.renderToolItem(tool, 'mcp')).join('')}
                </div>
            ` : ''}
        `;
        
        toolListContent.innerHTML = toolsHtml;
    }

    renderToolItem(tool, source) {
        return `
            <div class="cc-tool-item" data-tool-name="${tool.name}" data-source="${source}">
                <div class="cc-tool-item-name">${tool.name}</div>
                <div class="cc-tool-item-description">${tool.description}</div>
            </div>
        `;
    }

    toggleToolList() {
        const toolList = this.container.querySelector('.cc-tool-list');
        if (toolList.classList.contains('visible')) {
            this.hideToolList();
        } else {
            this.showToolList();
        }
    }

    showToolList() {
        const toolList = this.container.querySelector('.cc-tool-list');
        toolList.classList.add('visible');
        // Update tool list content when showing
        this.updateToolList();
    }

    hideToolList() {
        const toolList = this.container.querySelector('.cc-tool-list');
        toolList.classList.remove('visible');
    }

    showKeybindDialog() {
      this.settings.showKeybindDialog(this.resultsContainer, (newKeybind) => {
        this.keybind = newKeybind;
      });
    }

    showSettingsDialog() {
      this.settings.showSettingsDialog(this.resultsContainer, this);
    }

    async addSystemPrompt() {
      ccLogger.group('System Prompt Generation');
      
      // Build base system prompt
      let systemPrompt = `This is a smart chat bar a popup inside ${this.currentApp}. It can be used to ask questions, get help, and perform tasks.`;
      systemPrompt += ' The current date and time is ' + new Date().toLocaleString();
      systemPrompt += '. You can use the tools to perform tasks, chain them together to build context, and perform complex tasks.';
      
      // Add custom system prompt from settings if available
      if (this.settings.systemPrompt) {
          systemPrompt += '\n\Custom User Instructions:\n' + this.settings.systemPrompt;
      }

      // Add hostname-specific prompt if available
      const currentHostname = window.location.hostname;
      if (this.settings.hostnamePrompts && this.settings.hostnamePrompts.has(currentHostname)) {
          systemPrompt += `\n\nHost-Specific Instructions: ${currentHostname} - ${this.settings.hostnamePrompts.get(currentHostname)}`;
      }

      // Get system prompts from both local and MCP tools
      ccLogger.debug('Building system prompt with tools');
      
      // First get the tool scope
      const scope = await this.toolCaller.getToolScope(this);
      
      // Then build the system prompt with the scope
      systemPrompt = await this.toolCaller.buildSystemPrompt(systemPrompt, scope);
      
      // Add MCP-specific system prompts
      for (const [serviceId, client] of this.mcpToolCaller.mcpClients.entries()) {
          try {
              if (client.getSystemPrompt) {
                  systemPrompt = await client.getSystemPrompt(systemPrompt);
              }
          } catch (error) {
              ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
          }
      }

      this.messages.push({
          role: 'system',
          content: systemPrompt
      });
      
      ccLogger.debug('Final system prompt:', systemPrompt);
      ccLogger.groupEnd();
    }

    // Modify postMessage helper method to use secure messaging
    async postMessage(message) {
      // If we don't have an auth token yet and this isn't a settings request, queue the message
      if (!this.authTokenInitialized && message.type !== 'GET_SETTINGS') {
        this.messageQueue.push(message);
        return;
      }

      // Generate a unique message ID
      const messageId = `${Date.now()}-${Math.random()}`;
      this.pendingSecureMessages.add(messageId);

      // Prefix all carbonbar messages to identify them
      const carbonMessage = {
        ...message,
        type: (message.type.startsWith('CARBON_') || message.type.startsWith('CB_')) ? message.type : 'CARBON_' + message.type,
        tabId: window.tabId,
        authToken: this.authToken,
        _messageId: messageId
      };

      ccLogger.debug('Sending message:', carbonMessage);

      // Use the secure messaging system
      const promise = window.postMessage(carbonMessage, window.location.origin);

      // Process queued messages if initialization is complete
      if (this.initializationComplete && this.messageQueue.length > 0) {
        while (this.messageQueue.length > 0) {
          const queuedMessage = this.messageQueue.shift();
          this.postMessage(queuedMessage);
        }
      }
      return promise;
    }

    // Add method to handle settings loaded
    handleSettingsLoaded(settings) {
      if (settings._authToken) {
        //this.authToken = settings._authToken;
        //this.authTokenInitialized = true;
        //ccLogger.debug('[SECURITYDEBUG] AUTH_TOKEN_INITIALIZED.settings', this.authToken);
        
        // Process any queued messages now that we have the auth token
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift();
          this.postMessage(message);
        }
        
        this.initializationComplete = true;
      }
    }

    handleAccessRequest(message) {
        ccLogger.debug('handleAccessRequest', message);
        if(message.payload?.payload) {
            message.payload = message.payload.payload;
        }
        if (!message?.payload) {
            ccLogger.error('Invalid access request message:', message);
            return;
        }

        const { requestId, prompt } = message.payload;
        if (!requestId) {
            ccLogger.error('No requestId provided in access request');
            return;
        }

        // Generate dialog HTML if not provided
        const dialogHtml = message.payload.dialogHtml || `
            <div class="cc-dialog">
                <div class="cc-dialog-content">
                    <p>${prompt || 'Allow access to this feature?'}</p>
                    <div class="cc-dialog-buttons">
                        <button class="cc-button confirm" data-action="confirm">Allow</button>
                        <button class="cc-button cancel" data-action="cancel">Deny</button>
                    </div>
                </div>
            </div>
        `;

        // Create a new result item for the dialog
        const resultContainer = document.createElement('div');
        resultContainer.classList.add('cc-result-item');
        this.resultsContainer.appendChild(resultContainer);

        // Insert the dialog HTML into the result container
        resultContainer.innerHTML = dialogHtml;
        const dialog = resultContainer.querySelector('.cc-dialog');
        if (!dialog) {
            ccLogger.error('Failed to create dialog element');
            resultContainer.remove();
            return;
        }

        // Add click handlers for buttons
        const buttons = dialog.querySelectorAll('.cc-button');
        if (!buttons || buttons.length === 0) {
            ccLogger.error('No buttons found in dialog');
            resultContainer.remove();
            return;
        }

        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.action;
                const confirmed = action === 'confirm';

                // Animate dialog out
                dialog.style.animation = 'messageAppear 0.3s ease-in-out reverse';
                
                setTimeout(() => {
                    // Remove the dialog
                    resultContainer.remove();

                    // Send response through secure messaging
                    this.postMessage({
                        type: 'ACCESS_REQUEST_RESPONSE',
                        payload: {
                            requestId: requestId,
                            confirmed: confirmed
                        }
                    });
                }, 300); // Match animation duration
            });
        });

        // Add escape key handler
        const escHandler = (e) => {
            if (e.key === 'Escape' && resultContainer.isConnected) {
                const cancelButton = Array.from(buttons).find(btn => btn.dataset.action === 'cancel');
                if (cancelButton) {
                    cancelButton.click(); // Trigger cancel button
                }
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Show results container if hidden
        this.resultsContainer.style.display = 'block';
        this.resultsContainer.classList.remove('hidden');

        // Scroll to dialog
        if (this.resultsContainer) {
            this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
        }
    }
}


function importAll(r) {
  r.keys().forEach(r);
}

importAll(require.context('../tools', true, /\.js$/));

const carbonCommander = new CarbonCommander();

window.carbonCommander = carbonCommander;