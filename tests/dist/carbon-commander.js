/******/ var __webpack_modules__ = ({

/***/ "./src/chrome-carbonbar-page/autocomplete.js":
/*!***************************************************!*\
  !*** ./src/chrome-carbonbar-page/autocomplete.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Autocomplete: () => (/* binding */ Autocomplete)
/* harmony export */ });
/* harmony import */ var _global_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../global.js */ "./src/global.js");


class Autocomplete {
    constructor(container, input, options = {}) {
        this.container = container;
        this.input = input;
        this.lastAutocompleteRequest = null;
        this.autocompleteDebounceTimer = null;
        this.autocompleteDelay = options.delay || 300;
        this.lastAutocompleteInput = '';
        this.minAutocompleteLength = options.minLength || 2;
        this.currentAutocompleteRequestId = null;
        this.setupAutocomplete();
    }

    setupAutocomplete() {
        // Create autocomplete element
        this.autocompleteEl = this.container.querySelector('.cc-autocomplete');
        if (!this.autocompleteEl) {
            this.autocompleteEl = document.createElement('div');
            this.autocompleteEl.classList.add('cc-autocomplete');
            const inputWrapper = this.container.querySelector('.cc-input-wrapper');
            inputWrapper.appendChild(this.autocompleteEl);
        }

        // Initialize state
        this._currentSuggestions = null;
        this._selectedIndex = 0;
        this._handleKeyNavigation = null;
        this._isWindowBlurred = false;

        // Add input event listener
        this.input.addEventListener('input', (e) => this.handleInputChange(e));

        // Add window blur/focus events to handle alt-tab and window switching
        window.addEventListener('blur', () => {
            this._isWindowBlurred = true;
        });

        window.addEventListener('focus', () => {
            this._isWindowBlurred = false;
        });

        // Add blur event listener with improved handling
        this.input.addEventListener('blur', (e) => {
            // Don't hide suggestions if window is blurred (alt-tab, etc)
            if (this._isWindowBlurred) {
                return;
            }

            // Longer delay and check if user is interacting with suggestions
            setTimeout(() => {
                if (!this._isWindowBlurred && 
                    !this.autocompleteEl.contains(document.activeElement) && 
                    !this.autocompleteEl.matches(':hover')) {
                    this.autocompleteEl.innerHTML = '';
                    this._currentSuggestions = null;
                }
            }, 300);
        });

        // Add mouseenter event to prevent hiding while hovering
        this.autocompleteEl.addEventListener('mouseenter', () => {
            this.autocompleteEl.setAttribute('data-hovering', 'true');
        });

        this.autocompleteEl.addEventListener('mouseleave', () => {
            this.autocompleteEl.removeAttribute('data-hovering');
            // Only hide if input is not focused
            if (!this.input.matches(':focus')) {
                this.autocompleteEl.innerHTML = '';
                this._currentSuggestions = null;
            }
        });
    }

    handleInputChange(e) {
        const value = this.input.value.trim();
        
        // Clear suggestion if input is empty or too short
        if (!value || value.length < this.minAutocompleteLength) {
            this.autocompleteEl.innerHTML = '';
            this._currentSuggestions = null;
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

        // Clear existing suggestions while waiting for new ones
        this.autocompleteEl.innerHTML = '';
        this._currentSuggestions = null;

        this.newAutocompleteRequest(value, requestId);
    }

    newAutocompleteRequest(input, requestId) {
        if (this.autocompleteDebounceTimer) {
            clearTimeout(this.autocompleteDebounceTimer);
            this.autocompleteDebounceTimer = null;
        }

        this.lastAutocompleteInput = input;
        
        this.autocompleteDebounceTimer = setTimeout(async () => {
            try {
                if (requestId === this.currentAutocompleteRequestId) {
                    this.lastAutocompleteRequest = Date.now();
                    this.onRequestAutocomplete({
                        ...this.getAutocompleteContext(input),
                        requestId: requestId
                    });
                }
            } catch (error) {
                console.error('Autocomplete error:', error);
            }
        }, this.autocompleteDelay);
    }

    getAutocompleteContext(input) {
        return {
            input: input,
            commandHistory: (this.getCommandHistory?.() || []).slice(-10),
            context: this.getToolsContext?.() || ''
        };
    }

    showSuggestion(input, suggestion) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Showing suggestion:', { input, suggestion });
        
        // For array suggestions, check the requestId of the first item
        if (Array.isArray(suggestion)) {
            if (!suggestion.length || suggestion[0].requestId !== this.currentAutocompleteRequestId) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Skipping suggestions due to requestId mismatch:', {
                    current: this.currentAutocompleteRequestId,
                    received: suggestion[0]?.requestId
                });
                return;
            }

            suggestion = suggestion[0].text;
        } else if (suggestion.requestId !== this.currentAutocompleteRequestId) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Skipping suggestion due to requestId mismatch:', {
                current: this.currentAutocompleteRequestId,
                received: suggestion.requestId
            });
            return;
        }

        // Clear any existing keyboard handlers
        this.input.removeEventListener('keydown', this._handleKeyNavigation);

        // If we have an array of suggestions
        if (Array.isArray(suggestion)) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Processing array of suggestions:', suggestion);
            this._currentSuggestions = suggestion;
            this._selectedIndex = 0;
            this._renderBreadcrumbs();

            // Add keyboard navigation
            this._handleKeyNavigation = (e) => {
                if (!this.autocompleteEl.isConnected) return;
                
                switch (e.key) {
                    case 'ArrowLeft':
                        e.preventDefault();
                        this._selectedIndex = Math.max(0, this._selectedIndex - 1);
                        this._renderBreadcrumbs();
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        this._selectedIndex = Math.min(this._currentSuggestions.length - 1, this._selectedIndex + 1);
                        this._renderBreadcrumbs();
                        break;
                    case 'Tab':
                        e.preventDefault();
                        if (this._currentSuggestions[this._selectedIndex]) {
                            const selectedSuggestion = this._currentSuggestions[this._selectedIndex];
                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Selected suggestion:', selectedSuggestion);
                            this.input.value = selectedSuggestion.text;
                            this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
                            this.autocompleteEl.innerHTML = '';
                            this._currentSuggestions = null;
                        }
                        break;
                }
            };

            this.input.addEventListener('keydown', this._handleKeyNavigation);
        } else {
            this.autocompleteEl.innerHTML = '';
            this._currentSuggestions = null;
        }
    }

    _renderBreadcrumbs() {
        if (!this._currentSuggestions || !this._currentSuggestions.length) {
            this.autocompleteEl.innerHTML = '';
            return;
        }

        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Rendering breadcrumbs for suggestions:', this._currentSuggestions);

        const breadcrumbsHtml = this._currentSuggestions.map((suggestion, index) => {
            // Ensure we're getting the text property from the suggestion object
            const suggestionText = suggestion.text || suggestion.toString();
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Suggestion ${index}:`, { suggestion, suggestionText });
            return `
                <span class="cc-suggestion-breadcrumb ${index === this._selectedIndex ? 'selected' : ''}" 
                      data-index="${index}">
                    ${suggestionText}
                </span>
            `;
        }).join('<span class="cc-suggestion-separator">›</span>');

        this.autocompleteEl.innerHTML = `<div class="cc-suggestion-breadcrumbs">${breadcrumbsHtml}</div>`;

        // Add click handlers for the breadcrumbs
        const breadcrumbs = this.autocompleteEl.querySelectorAll('.cc-suggestion-breadcrumb');
        breadcrumbs.forEach((breadcrumb, index) => {
            breadcrumb.addEventListener('click', () => {
                this._selectedIndex = index;
                this._renderBreadcrumbs();
                // Simulate Tab press to select the suggestion
                this._handleKeyNavigation({ key: 'Tab', preventDefault: () => {} });
            });
        });
    }

    // Method to be overridden by parent class
    onRequestAutocomplete(context) {
        // This should be implemented by the parent class
        console.warn('onRequestAutocomplete not implemented');
    }

    // Methods that can be set by parent class
    setCommandHistoryGetter(fn) {
        this.getCommandHistory = fn;
    }

    setToolsContextGetter(fn) {
        this.getToolsContext = fn;
    }
} 

/***/ }),

/***/ "./src/chrome-carbonbar-page/mcp-tool-caller.js":
/*!******************************************************!*\
  !*** ./src/chrome-carbonbar-page/mcp-tool-caller.js ***!
  \******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _global_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../global.js */ "./src/global.js");
/* harmony import */ var _settings_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./settings.js */ "./src/chrome-carbonbar-page/settings.js");



class MCPToolCaller {
    constructor() {
        this.currentPageTools = null;
        this.mcpClients = new Map(); // Map of MCP client connections
        this.mcpConfig = new Map(); // Map of MCP service configurations
        this.mcpToolsets = new Map(); // Map of MCP-provided toolsets
        this.reconnectInterval = null;
        this.refreshInProgress = false; // Flag to prevent concurrent refresh operations
        this.startReconnectInterval();
        
        // Load saved configurations on startup
        this.loadSavedConfigurations().catch(error => {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Failed to load saved MCP configurations:', error);
        });
    }

    startReconnectInterval() {
        // Check connections every 30 seconds
        this.reconnectInterval = setInterval(async () => {
            // Skip if a refresh operation is already in progress
            if (this.refreshInProgress) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Skipping MCP connection refresh - another refresh operation is in progress');
                return;
            }
            
            try {
                this.refreshInProgress = true;
                await this.refreshMCPConnections();
            } catch (error) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error during MCP connection refresh:', error);
            } finally {
                this.refreshInProgress = false;
            }
        }, 30000);
    }

    stopReconnectInterval() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
    }

    // MCP-specific methods
    async configureMCPService(serviceConfig) {
        const { serviceId, endpoint, apiKey, options = {} } = serviceConfig;
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Configuring MCP service: ${serviceId}`);
        
        try {
            const config = {
                endpoint,
                apiKey,
                options,
                status: 'configured',
                toolsets: [] // Will store toolsets provided by this service
            };

            this.mcpConfig.set(serviceId, config);
            
            // Save configuration to settings
            _settings_js__WEBPACK_IMPORTED_MODULE_1__["default"].mcpConfigurations.set(serviceId, {
                endpoint,
                apiKey,
                options
            });
            await _settings_js__WEBPACK_IMPORTED_MODULE_1__["default"].save();
            
            // Initialize client connection if autoConnect is true
            if (options.autoConnect) {
                await this.connectMCPService(serviceId);
            }
            
            return true;
        } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error configuring MCP service ${serviceId}:`, error);
            return false;
        }
    }

    async loadSavedConfigurations() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Loading saved MCP configurations');
        for (const [serviceId, config] of _settings_js__WEBPACK_IMPORTED_MODULE_1__["default"].mcpConfigurations.entries()) {
            try {
                await this.configureMCPService({
                    serviceId,
                    ...config
                });
            } catch (error) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error loading saved MCP configuration for ${serviceId}:`, error);
            }
        }
    }

    async connectMCPService(serviceId, retryCount = 3, retryDelay = 1000) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Connecting to MCP service: ${serviceId}`);
        
        const config = this.mcpConfig.get(serviceId);
        if (!config) {
            throw new Error(`MCP service ${serviceId} not configured`);
        }

        let lastError = null;
        for (let attempt = 1; attempt <= retryCount; attempt++) {
            try {
                // Initialize MCP client connection with enhanced capabilities
                const client = {
                    serviceId,
                    endpoint: config.endpoint,
                    connected: true,
                    // Enhanced client methods
                    callFunction: async (functionName, args) => {
                        return await this.mcpCallFunction(serviceId, functionName, args);
                    },
                    discoverTools: async () => {
                        return await this.discoverMCPTools(serviceId);
                    },
                    getSystemPrompt: async (basePrompt, scope) => {
                        return await this.getMCPSystemPrompt(serviceId, basePrompt, scope);
                    }
                };

                this.mcpClients.set(serviceId, client);
                config.status = 'connected';

                // Discover available tools after connection
                await this.discoverMCPTools(serviceId);
                
                return true;
            } catch (error) {
                lastError = error;
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.warn(`Connection attempt ${attempt} failed for MCP service ${serviceId}:`, error);
                
                if (attempt < retryCount) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Retrying in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }

        // If all retries failed, update status and throw error
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Failed to connect to MCP service ${serviceId} after ${retryCount} attempts:`, lastError);
        config.status = 'error';
        config.lastError = lastError.message;
        return false;
    }

    async discoverMCPTools(serviceId) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            throw new Error(`MCP client ${serviceId} not connected`);
        }

        try {
            // Call the MCP service's tool discovery endpoint
            const response = await fetch(`${client.endpoint}/discover-tools`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`Tool discovery failed: ${response.statusText}`);
            }

            const toolsets = await response.json();
            
            // Process and store discovered toolsets
            toolsets.forEach(toolset => {
                // Add MCP-specific wrapper around toolset
                const wrappedToolset = this.wrapMCPToolset(serviceId, toolset);
                this.mcpToolsets.set(`${serviceId}:${toolset.name}`, wrappedToolset);
            });

            return toolsets;
        } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error discovering tools for ${serviceId}:`, error);
            throw error;
        }
    }

    wrapMCPToolset(serviceId, toolset) {
        // Create a wrapper that maintains compatibility with local toolsets
        return {
            name: `${serviceId}:${toolset.name}`,
            toolSet: {
                ...toolset,
                _CarbonBarPageLoadFilter: toolset.pageLoadFilter || (() => true),
                _CarbonBarBuildScope: async (scope) => {
                    // Call MCP service for scope building if supported
                    try {
                        const client = this.mcpClients.get(serviceId);
                        const response = await fetch(`${client.endpoint}/build-scope`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                            },
                            body: JSON.stringify({ scope })
                        });
                        
                        if (response.ok) {
                            const customScope = await response.json();
                            return { ...scope, ...customScope };
                        }
                    } catch (error) {
                        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error building MCP scope for ${serviceId}:`, error);
                    }
                    return scope;
                },
                _CarbonBarSystemPrompt: async (basePrompt, scope) => {
                    // Call MCP service for system prompt customization if supported
                    try {
                        const client = this.mcpClients.get(serviceId);
                        const response = await fetch(`${client.endpoint}/system-prompt`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                            },
                            body: JSON.stringify({ basePrompt, scope })
                        });
                        
                        if (response.ok) {
                            const { customPrompt } = await response.json();
                            return customPrompt || basePrompt;
                        }
                    } catch (error) {
                        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
                    }
                    return basePrompt;
                }
            },
            tools: toolset.tools.map(tool => ({
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                },
                execute: async (scope, args) => {
                    return await this.mcpCallFunction(serviceId, tool.name, args);
                }
            }))
        };
    }

    async disconnectMCPService(serviceId, permanent = false) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Disconnecting from MCP service: ${serviceId}${permanent ? ' (permanent)' : ' (temporary)'}`);
        
        const client = this.mcpClients.get(serviceId);
        if (client) {
            try {
                // Remove all toolsets from this service
                for (const [toolsetId, toolset] of this.mcpToolsets.entries()) {
                    if (toolsetId.startsWith(`${serviceId}:`)) {
                        this.mcpToolsets.delete(toolsetId);
                    }
                }

                // Cleanup client connection
                this.mcpClients.delete(serviceId);
                const config = this.mcpConfig.get(serviceId);
                if (config) {
                    config.status = 'disconnected';
                }

                // Remove from settings only if permanent
                if (permanent) {
                    _settings_js__WEBPACK_IMPORTED_MODULE_1__["default"].mcpConfigurations.delete(serviceId);
                    await _settings_js__WEBPACK_IMPORTED_MODULE_1__["default"].save();
                }

                return true;
            } catch (error) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error disconnecting from MCP service ${serviceId}:`, error);
                return false;
            }
        }
        return false;
    }

    async mcpCallFunction(serviceId, functionName, args, timeout = 30000) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            throw new Error(`MCP client ${serviceId} not connected`);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${client.endpoint}/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                },
                body: JSON.stringify({
                    function: functionName,
                    arguments: args
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`MCP call failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`MCP function call timed out after ${timeout}ms:`, { serviceId, functionName });
                throw new Error(`MCP function call timed out: ${functionName}`);
            }
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error calling MCP function ${functionName}:`, error);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // Tool management methods with MCP support
    reset() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Resetting MCP tool caller state');
        this.currentPageTools = null;
        // Don't reset MCP configurations/connections unless explicitly requested
    }

    getToolSets() {
        return [...this.getAllToolsets(), ...Array.from(this.mcpToolsets.values())];
    }

    getTools(onlyFunctionInfo = false) {        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Getting Tools');
        let allTools = [];
        
        // Get local tools
        let pageTools = this.getAllToolSetsForPage();
        pageTools.forEach(toolSet => {
            toolSet.tools.forEach(prop => {
                allTools.push(onlyFunctionInfo ? prop.function : prop);
            });
        });
        
        // Add MCP tools
        this.mcpToolsets.forEach(toolset => {
            if (toolset.toolSet._CarbonBarPageLoadFilter(window)) {
                toolset.tools.forEach(tool => {
                    allTools.push(onlyFunctionInfo ? tool.function : tool);
                });
            }
        });
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Found ${allTools.length} tools (including MCP tools)`);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return allTools;
    }

    getTool(toolName, onlyFunctionInfo = false) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Getting tool:', toolName);
        const allTools = this.getTools(onlyFunctionInfo);
        const tool = allTools.find(tool => onlyFunctionInfo ? tool.name == toolName : tool.function.name == toolName);
        if (!tool) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.warn(`Tool not found: ${toolName}`);
        }
        return tool;
    }

    async getToolScope(bar) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Building Tool Scope');
        var scope = {
            bar: bar,
            logMessage: (message, important = false) => {
                if(important) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.info('[ToolScope] ' + message);
                } else {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('[ToolScope] ' + message);
                }
            },
            logError: (message) => {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('[ToolScope] ' + message);
            }
        }

        // Add MCP-specific scope items
        scope.mcpServices = Array.from(this.mcpConfig.entries()).map(([id, config]) => ({
            id,
            status: config.status,
            endpoint: config.endpoint
        }));

        // Apply local toolsets scope functions
        for(let toolSet of this.getAllToolSetsForPage()) {
            try {
                if(toolSet.toolSet._CarbonBarBuildScope) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Building scope for toolset: ${toolSet.name}`);
                    scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                }
            } catch (e) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error building scope:', e);
            }
        }

        // Apply MCP toolsets scope functions
        for(let [_, toolset] of this.mcpToolsets) {
            try {
                if(toolset.toolSet._CarbonBarPageLoadFilter(window) && toolset.toolSet._CarbonBarBuildScope) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Building scope for MCP toolset: ${toolset.name}`);
                    scope = await toolset.toolSet._CarbonBarBuildScope(scope);
                }
            } catch (e) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error building MCP scope:', e);
            }
        }

        if(!scope.appName) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.warn('No app name found in scope, using default');
            scope.appName = 'CarbonCommander [MCP Mode]';
        }
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return scope;
    }

    getAllToolSetsForPage() {
        if(this.currentPageTools) {
            return this.currentPageTools;
        }
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Getting Tool Sets for Page');
        this.currentPageTools = this.getAllToolsets().filter(toolSet => 
            (toolSet.tools && toolSet.tools.length > 0) &&
            (toolSet.toolSet._CarbonBarPageLoadFilter && toolSet.toolSet._CarbonBarPageLoadFilter(window))
        );
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Found ${this.currentPageTools.length} tool sets for current page`);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return this.currentPageTools;
    }

    getAllToolsets() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Getting All Tool Sets');
        const allTools = [];
        if (window.sbaiTools) {
            Object.entries(window.sbaiTools).forEach(([_, toolSet]) => {
                try {
                    let toolset = {
                        name: toolSet.name,
                        toolSet: toolSet,
                        tools: Object.getOwnPropertyNames(toolSet)
                            .filter(prop => typeof toolSet[prop] === 'object' && toolSet[prop]?.function)
                            .map(prop => toolSet[prop])
                    };

                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Processing toolset:', { 
                        name: toolset.name, 
                        toolCount: toolset.tools.length 
                    });

                    if(toolset.tools && toolset.tools.length > 0) {
                        allTools.push(toolset);
                    }
                } catch (e) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error getting tools from ${toolSet.name}:`, e);
                }
            });
        }
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Total tool sets found: ${allTools.length}`);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return allTools;
    }

    // MCP Service management methods
    getMCPServices() {
        return Array.from(this.mcpConfig.entries()).map(([id, config]) => ({
            id,
            status: config.status,
            endpoint: config.endpoint,
            connected: this.mcpClients.has(id),
            toolsets: Array.from(this.mcpToolsets.values())
                .filter(ts => ts.name.startsWith(`${id}:`))
                .map(ts => ts.name.substring(id.length + 1))
        }));
    }

    getMCPServiceStatus(serviceId) {
        const config = this.mcpConfig.get(serviceId);
        return config ? {
            status: config.status,
            connected: this.mcpClients.has(serviceId),
            lastError: config.lastError,
            toolsets: Array.from(this.mcpToolsets.values())
                .filter(ts => ts.name.startsWith(`${serviceId}:`))
                .map(ts => ts.name.substring(serviceId.length + 1))
        } : null;
    }

    async checkMCPHealth(serviceId) {
        const client = this.mcpClients.get(serviceId);
        if (!client) {
            return false;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(`${client.endpoint}/status`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.mcpConfig.get(serviceId).apiKey}`
                },
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`Health check failed: ${response.statusText}`);
            }

            const status = await response.json();
            return status.healthy === true;
        } catch (error) {
            if (error.name === 'AbortError') {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Health check timed out after 5000ms for MCP service ${serviceId}`);
            } else {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Health check failed for MCP service ${serviceId}:`, error);
            }
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async refreshMCPConnections() {
        if (this.refreshInProgress) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Skipping MCP connection refresh - another refresh operation is in progress');
            return [];
        }

        try {
            this.refreshInProgress = true;
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Refreshing all MCP connections');
            const results = [];
            for (const [serviceId, config] of this.mcpConfig.entries()) {
                // First check health of existing connection
                if (this.mcpClients.has(serviceId)) {
                    const isHealthy = await this.checkMCPHealth(serviceId);
                    if (!isHealthy) {
                        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.warn(`Unhealthy MCP service detected: ${serviceId}, attempting reconnect`);
                        await this.disconnectMCPService(serviceId, false); // Use temporary disconnection
                    }
                }

                // Reconnect if needed
                if (config.status === 'connected' || config.options.autoReconnect) {
                    results.push({
                        serviceId,
                        success: await this.connectMCPService(serviceId)
                    });
                }
            }
            return results;
        } finally {
            this.refreshInProgress = false;
        }
    }

    cleanup() {
        this.stopReconnectInterval();
        this.refreshInProgress = false; // Reset the flag during cleanup
        // Disconnect all services
        for (const [serviceId] of this.mcpClients) {
            this.disconnectMCPService(serviceId);
        }
    }
}

const mcpToolCaller = new MCPToolCaller();
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (mcpToolCaller); 

/***/ }),

/***/ "./src/chrome-carbonbar-page/settings.js":
/*!***********************************************!*\
  !*** ./src/chrome-carbonbar-page/settings.js ***!
  \***********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Settings: () => (/* binding */ Settings),
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _global_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../global.js */ "./src/global.js");
/*
 * CarbonCommander - A command palette interface for quick actions
 * Copyright (C) 2025 Carbonitex
 */



class Settings {
    constructor() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Settings constructor');
        this._postMessageHandler = null;
        this.systemPrompt = '';
        this.hostnamePrompts = new Map(); // Add storage for hostname-specific prompts
        this.keyValuePairs = new Map();
        this.encryptedKeys = new Map(); // Track which keys are encrypted and if they have a non-empty value
        this.keybind = _global_js__WEBPACK_IMPORTED_MODULE_0__.ccDefaultKeybind; // Default keybind
        this.mcpConfigurations = new Map(); // Store MCP service configurations
        this.refreshInProgress = false; // Flag to prevent concurrent refresh operations
        
        // Add event listener for settings loaded
        window.addEventListener('message', this.handleSettingsMessage.bind(this));
    }

    setPostMessageHandler(handler) {
        this._postMessageHandler = handler;
        this.load();
    }

    handleSettingsMessage(event) {
        if (event.source !== window) return;

        if (event.data.type === 'CARBON_GET_SETTINGS_RESPONSE') {
            const settings = event.data.payload;
            if (settings) {
                this.systemPrompt = settings.systemPrompt || '';
                this.keyValuePairs = settings.keyValuePairs || new Map();
                this.hostnamePrompts = settings.hostnamePrompts || new Map();
                this.mcpConfigurations = settings.mcpConfigurations || new Map();

                if (settings.encryptedKeys) {
                    this.encryptedKeys = new Map();
                    for (const [key, value] of settings.encryptedKeys) {
                        this.encryptedKeys.set(key, value);
                    }
                    // Ensure openai-key is always encrypted and exists, mark as empty by default
                    if (!this.encryptedKeys.has('openai-key'))
                        this.encryptedKeys.set('openai-key', false);
                }
            }
        }

        if (event.data.type === 'SET_KEYBIND') {
            this.keybind = event.data.payload || _global_js__WEBPACK_IMPORTED_MODULE_0__.ccDefaultKeybind;
        }
    }

    async load() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Settings: load');
        if (!this._postMessageHandler) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Settings: postMessage handler not initialized');
            return;
        }

        try {
            // Request settings from service.js
            this._postMessageHandler({
                type: 'GET_SETTINGS',
                payload: {
                    init: true
                }
            });
        } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error loading settings:', error);
        }
    }

    async testOpenAIKey(key) {
        const response = await new Promise(resolve => {
            window.postMessage({
                type: 'CARBON_SET_OPENAI_KEY',
                payload: { key: key, test: true }
            }, window.location.origin);

            const listener = (event) => {
                if (event.data.type === 'SET_OPENAI_KEY_RESPONSE') {
                    window.removeEventListener('message', listener);
                    resolve(event.data.payload);
                }
            };
            window.addEventListener('message', listener);
        });
        return response;
    }

    async save() {
        if (!this._postMessageHandler) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Settings: postMessage handler not initialized');
            return;
        }

        try {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Saving settings');
            // Convert Map to object for storage
            const settingsToSave = {
                systemPrompt: this.systemPrompt,
                keyValuePairs: this.keyValuePairs,
                encryptedKeys: this.encryptedKeys,
                hostnamePrompts: this.hostnamePrompts,
                mcpConfigurations: this.mcpConfigurations
            };
            
            // Save encrypted values first
            for (const [key, value] of this.keyValuePairs.entries()) {
                if (this.encryptedKeys.has(key)) {
                    const isEncryptedSet = this.encryptedKeys.get(key);
                    if(isEncryptedSet){
                        const hasValue = value !== null && value !== undefined && value !== '';
                        if(hasValue){
                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Saving encrypted value:', key);
                            await this._postMessageHandler({
                                type: 'SAVE_ENCRYPTED_VALUE',
                                payload: {
                                    key: key,
                                    value: value
                                }
                            });
                            if(key === 'openai-key') {
                                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Setting OpenAI key:', value);
                                window.postMessage({
                                    type: 'CARBON_SET_OPENAI_KEY',
                                    payload: { key: value, save: true }
                                }, window.location.origin);
                            }
                        } else {
                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Deleting encrypted value:', key);
                            await this._postMessageHandler({
                                type: 'DELETE_ENCRYPTED_VALUE',
                                payload: {
                                    key: key
                                }
                            });
                        }
                    }
                }
            }

            // Save MCP configurations with encrypted API keys
            for (const [serviceId, config] of this.mcpConfigurations.entries()) {
                if (config.apiKey) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Saving encrypted API key for MCP service: ${serviceId}`);
                    await this._postMessageHandler({
                        type: 'SAVE_ENCRYPTED_VALUE',
                        payload: {
                            key: `mcp-key-${serviceId}`,
                            value: config.apiKey
                        }
                    });
                    // Remove API key from the configuration before saving
                    const configCopy = { ...config };
                    delete configCopy.apiKey;
                    this.mcpConfigurations.set(serviceId, configCopy);
                }
            }

            //remove all encrypted keys from the keyValuePairs map
            for(const [key, value] of this.encryptedKeys.entries()) {
                this.keyValuePairs.delete(key);
            }
            
            // Send settings to service.js for storage
            this._postMessageHandler({
                type: 'SAVE_SETTINGS',
                payload: settingsToSave
            });
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error saving settings:', error);
        }
    }

    getKeybindDisplay(kb = this.keybind) {
        const parts = [];
        if (kb.ctrl) parts.push('Ctrl');
        if (kb.meta) parts.push('⌘');
        parts.push(kb.key.toUpperCase());
        return parts.join(' + ');
    }

    setKeybind(newKeybind) {
        if (!this._postMessageHandler) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Settings: postMessage handler not initialized');
            return;
        }

        this.keybind = newKeybind;
        this._postMessageHandler({
            type: 'SAVE_KEYBIND',
            payload: newKeybind
        });
    }

    showKeybindDialog(container, onKeybindChange) {
        const dialogHTML = `
            <div class="cc-dialog">
                <div class="cc-dialog-content">
                    <h3>Change Keybind</h3>
                    <p>Press the key combination you want to use to open Carbon Commander.</p>
                    <p>Current keybind: ${this.getKeybindDisplay()}</p>
                    <div class="cc-keybind-input" tabindex="0">Press a key...</div>
                    <div class="cc-dialog-buttons">
                        <button class="cc-button cancel">Cancel</button>
                        <button class="cc-button confirm">Save</button>
                    </div>
                </div>
            </div>
        `;

        const dialogElement = document.createElement('div');
        dialogElement.innerHTML = dialogHTML;
        container.appendChild(dialogElement);

        const keybindInput = dialogElement.querySelector('.cc-keybind-input');
        let newKeybind = null;

        keybindInput.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Only allow modifier keys with a regular key
            if (e.key.length === 1 || e.key.match(/^[a-zA-Z0-9]$/)) {
                newKeybind = {
                    key: e.key.toLowerCase(),
                    ctrl: e.ctrlKey,
                    meta: e.metaKey
                };
                keybindInput.textContent = this.getKeybindDisplay(newKeybind);
            }
        });

        const confirmBtn = dialogElement.querySelector('.confirm');
        const cancelBtn = dialogElement.querySelector('.cancel');

        confirmBtn.addEventListener('click', () => {
            if (newKeybind) {
                this.setKeybind(newKeybind);
                if (onKeybindChange) {
                    onKeybindChange(newKeybind);
                }
            }
            dialogElement.remove();
        });

        cancelBtn.addEventListener('click', () => {
            dialogElement.remove();
        });

        keybindInput.focus();
        return dialogElement;
    }

    showKeybindDialogInSettings(dialog, onKeybindChange) {
        const keybindDialog = document.createElement('div');
        keybindDialog.classList.add('cc-dialog');
        keybindDialog.innerHTML = `
            <div class="cc-dialog-content">
                <h3>Change Keybind</h3>
                <p>Press the key combination you want to use to open Carbon Commander.</p>
                <p>Current keybind: ${this.getKeybindDisplay()}</p>
                <div class="cc-keybind-input" tabindex="0">Press a key...</div>
                <div class="cc-dialog-buttons">
                    <button class="cc-button cancel">Cancel</button>
                    <button class="cc-button confirm">Save</button>
                </div>
            </div>
        `;

        dialog.appendChild(keybindDialog);

        const keybindInput = keybindDialog.querySelector('.cc-keybind-input');
        let newKeybind = null;

        keybindInput.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Only allow modifier keys with a regular key
            if (e.key.length === 1 || e.key.match(/^[a-zA-Z0-9]$/)) {
                newKeybind = {
                    key: e.key.toLowerCase(),
                    ctrl: e.ctrlKey,
                    meta: e.metaKey
                };
                keybindInput.textContent = this.getKeybindDisplay(newKeybind);
            }
        });

        const confirmKeybindBtn = keybindDialog.querySelector('.confirm');
        const cancelKeybindBtn = keybindDialog.querySelector('.cancel');

        confirmKeybindBtn.addEventListener('click', () => {
            if (newKeybind) {
                this.setKeybind(newKeybind);
                if (onKeybindChange) {
                    onKeybindChange(newKeybind);
                }
            }
            keybindDialog.remove();
        });

        cancelKeybindBtn.addEventListener('click', () => {
            keybindDialog.remove();
        });

        keybindInput.focus();
    }

    showSettingsDialog(container, carbonCommander) {
        const overlay = document.createElement('div');
        overlay.classList.add('cc-settings-overlay');
        
        const dialog = document.createElement('div');
        dialog.classList.add('cc-settings-dialog');
        
        dialog.innerHTML = `
            <h2>Settings</h2>
            
            <div class="cc-settings-section">
                <h3>System Prompt</h3>
                <div class="cc-settings-field">
                    <label>Global system prompt (applies to all hosts):</label>
                    <textarea id="system-prompt">${this.systemPrompt || ''}</textarea>
                </div>
            </div>

            <div class="cc-settings-section hostname-prompts-section">
                <h3>Host-Specific System Prompts</h3>
                <div class="cc-settings-field">
                    <table class="cc-key-value-table hostname-prompts-table">
                        <thead>
                            <tr>
                                <th>Hostname</th>
                                <th>System Prompt</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Array.from(this.hostnamePrompts || []).map(([hostname, prompt]) => `
                                <tr>
                                    <td><input type="text" value="${hostname}" class="hostname-key"></td>
                                    <td><textarea class="hostname-prompt">${prompt}</textarea></td>
                                    <td>
                                        <button class="cc-button delete-hostname-prompt">Delete</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div class="cc-key-value-actions">
                        <button class="cc-button" id="add-hostname-prompt">Add Host-Specific Prompt</button>
                    </div>
                </div>
            </div>
            
            <div class="cc-settings-section">
                <h3>Keyboard Shortcuts</h3>
                <div class="cc-settings-field-group">
                    <div class="cc-settings-field">
                        <label>Command palette shortcut:</label>
                        <div class="cc-keybind-display">${this.getKeybindDisplay()}</div>
                        <button class="cc-button" id="change-keybind">Change Shortcut</button>
                    </div>

                    <div class="cc-settings-field command-history-section">
                        <label>Command History Management:</label>
                        <div class="cc-command-history-list">
                            <select id="hostname-select" class="cc-select">
                                <option value="">Select hostname...</option>
                            </select>
                            <button class="cc-button" id="clear-history">Clear History</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="cc-settings-section">
                <h3>MCP Services</h3>
                <div class="cc-settings-field">
                    <table class="cc-key-value-table mcp-services-table">
                        <thead>
                            <tr>
                                <th>Service ID</th>
                                <th>Endpoint</th>
                                <th>API Key</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Array.from(this.mcpConfigurations || []).map(([serviceId, config]) => `
                                <tr>
                                    <td><input type="text" value="${serviceId}" class="mcp-service-id" readonly></td>
                                    <td><input type="text" value="${config.endpoint}" class="mcp-endpoint"></td>
                                    <td>
                                        <div class="encrypted-value">
                                            ${config.apiKey ? '••••••••' : '<span style="color: #ff9999; font-style: italic;">Not Set</span>'}
                                        </div>
                                        <button class="cc-button update-mcp-key">Update Key</button>
                                    </td>
                                    <td>
                                        <span class="mcp-status ${config.status || 'disconnected'}">${config.status || 'disconnected'}</span>
                                    </td>
                                    <td>
                                        <button class="cc-button delete-mcp-service">Delete</button>
                                        <button class="cc-button toggle-mcp-service">${config.status === 'connected' ? 'Disconnect' : 'Connect'}</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div class="cc-key-value-actions">
                        <button class="cc-button" id="add-mcp-service">Add MCP Service</button>
                    </div>
                </div>
            </div>
            
            <div class="cc-settings-section key-value-pairs-section">
                <h3>Configuration Key-Value Pairs</h3>
                <div class="cc-settings-field">
                    <table class="cc-key-value-table key-value-pairs-table">
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Value</th>
                                <th>Encrypted</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Array.from(this.encryptedKeys).map(([key, hasValue]) => `
                                <tr>
                                    <td><input type="text" value="${key}" class="kv-key" readonly></td>
                                    <td>
                                        <div class="encrypted-value">
                                            ${!hasValue ? '<span style="color: #ff9999; font-style: italic;">Not Set</span>' : '••••••••'}
                                        </div>
                                    </td>
                                    <td>
                                        <span class="encrypted-badge">🔒</span>
                                    </td>
                                    <td>
                                        <button class="cc-button delete-row">Delete</button>
                                        <button class="cc-button update-encrypted">Update</button>
                                    </td>
                                </tr>
                            `).join('')}

                            ${Array.from(this.keyValuePairs || []).map(([key, value]) => `
                                <tr>
                                    <td><input type="text" value="${key}" class="kv-key"></td>
                                    <td>
                                        <input type="text" value="${value}" class="kv-value">
                                    </td>
                                    <td>
                                        <input type="checkbox" class="encrypt-toggle">
                                    </td>
                                    <td>
                                        <button class="cc-button delete-row">Delete</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div class="cc-key-value-actions">
                        <button class="cc-button" id="add-kv-pair">Add New Pair</button>
                    </div>
                </div>
            </div>
            
            <div class="cc-settings-buttons">
                <button class="cc-button cancel">Cancel</button>
                <button class="cc-button confirm">Save</button>
            </div>
        `;

        // Add event listeners
        const changeKeybindBtn = dialog.querySelector('#change-keybind');
        changeKeybindBtn.addEventListener('click', () => {
            this.showKeybindDialogInSettings(dialog, (newKeybind) => {
                carbonCommander.keybind = newKeybind;
                dialog.querySelector('.cc-keybind-display').textContent = this.getKeybindDisplay();
            });
        });
        
        const addKVPairBtn = dialog.querySelector('#add-kv-pair');
        addKVPairBtn.addEventListener('click', () => {
            const tbody = dialog.querySelector('.key-value-pairs-table tbody');
            const newRow = document.createElement('tr');
            newRow.innerHTML = `
                <td><input type="text" class="kv-key"></td>
                <td><input type="text" class="kv-value"></td>
                <td><input type="checkbox" class="encrypt-toggle"></td>
                <td>
                    <button class="cc-button delete-row">Delete</button>
                </td>
            `;
            tbody.appendChild(newRow);
        });
        
        // Add hostname prompt handlers
        const addHostnamePromptBtn = dialog.querySelector('#add-hostname-prompt');
        addHostnamePromptBtn.addEventListener('click', () => {
            const tbody = dialog.querySelector('.hostname-prompts-table tbody');
            
            // Get current hostname and check if it's already configured
            const currentHostname = window.location.hostname;
            if (currentHostname && !this.hostnamePrompts.has(currentHostname)) {
                const newRow = document.createElement('tr');
                newRow.innerHTML = `
                    <td><input type="text" class="hostname-key" value="${currentHostname}"></td>
                    <td><textarea class="hostname-prompt" placeholder="Enter host-specific system prompt..."></textarea></td>
                    <td>
                        <button class="cc-button delete-hostname-prompt">Delete</button>
                    </td>
                `;
                tbody.appendChild(newRow);
                // Focus the prompt textarea
                newRow.querySelector('.hostname-prompt').focus();
            } else {
                const newRow = document.createElement('tr');
                newRow.innerHTML = `
                    <td><input type="text" class="hostname-key" placeholder="example.com"></td>
                    <td><textarea class="hostname-prompt" placeholder="Enter host-specific system prompt..."></textarea></td>
                    <td>
                        <button class="cc-button delete-hostname-prompt">Delete</button>
                    </td>
                `;
                tbody.appendChild(newRow);
                // Focus the hostname input since we don't have a pre-filled value
                newRow.querySelector('.hostname-key').focus();
            }
        });
        
        // Add MCP service management handlers
        const addMCPServiceBtn = dialog.querySelector('#add-mcp-service');
        addMCPServiceBtn.addEventListener('click', () => {
            const tbody = dialog.querySelector('.mcp-services-table tbody');
            const newRow = document.createElement('tr');
            newRow.innerHTML = `
                <td><input type="text" class="mcp-service-id" placeholder="service-id"></td>
                <td><input type="text" class="mcp-endpoint" placeholder="https://example.com"></td>
                <td>
                    <div class="encrypted-value">
                        <span style="color: #ff9999; font-style: italic;">Not Set</span>
                    </div>
                    <button class="cc-button update-mcp-key">Set Key</button>
                </td>
                <td>
                    <span class="mcp-status disconnected">disconnected</span>
                </td>
                <td>
                    <button class="cc-button delete-mcp-service">Delete</button>
                    <button class="cc-button toggle-mcp-service">Connect</button>
                </td>
            `;
            tbody.appendChild(newRow);
        });
        
        dialog.addEventListener('click', async (e) => {
            if (e.target.classList.contains('delete-hostname-prompt')) {
                const row = e.target.closest('tr');
                const hostname = row.querySelector('.hostname-key').value;
                this.hostnamePrompts.delete(hostname);
                row.remove();
            }
            
            if (e.target.classList.contains('delete-row')) {
                const row = e.target.closest('tr');
                const key = row.querySelector('.kv-key').value;
                
                if (this.encryptedKeys.has(key)) {
                    this.encryptedKeys.set(key, true);
                    this.keyValuePairs.set(key, ''); 
                } else {
                    this.keyValuePairs.delete(key);
                }

                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Deleted key:', key, 'new keyValuePairs:', this.keyValuePairs);

                row.remove();
            }
            
            if (e.target.classList.contains('update-encrypted')) {
                const row = e.target.closest('tr');
                const key = row.querySelector('.kv-key').value;
                
                // Show input dialog for new encrypted value
                const inputDialog = document.createElement('div');
                inputDialog.classList.add('cc-dialog');
                inputDialog.innerHTML = `
                    <div class="cc-dialog-content">
                        <h3>Update Encrypted Value</h3>
                        <div class="cc-input-group">
                            <label>New value for ${key}:</label>
                            <input type="password" class="cc-dialog-input">
                        </div>
                        <div class="cc-dialog-buttons">
                            <button class="cc-button cancel">Cancel</button>
                            <button class="cc-button confirm">Update</button>
                        </div>
                    </div>
                `;
                
                dialog.appendChild(inputDialog);
                
                const input = inputDialog.querySelector('.cc-dialog-input');
                input.focus();
                
                inputDialog.querySelector('.cancel').addEventListener('click', () => {
                    inputDialog.remove();
                });
                
                inputDialog.querySelector('.confirm').addEventListener('click', async () => {
                    const newValue = input.value.trim();


                    if(key === 'openai-key') {
                        const response = await this.testOpenAIKey(newValue);
                        if(!response.success) {
                            alert('Invalid OpenAI key, test failed');
                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Failed to set OpenAI key');
                            return;
                        }
                    }

                    this.encryptedKeys.set(key, true);
                    this.keyValuePairs.set(key, newValue);
                    //Update the UI with encrypted 'hasValue' status, for kv-value row
                    const encryptedValue = row.querySelector('.encrypted-value');
                    const hasValue = newValue !== null && newValue !== undefined && newValue !== '';
                    encryptedValue.innerHTML = hasValue ? '<span style="color: lime; font-style: italic;">Updated</span>' : '<span style="color: red; font-style: italic;">Empty</span>';
                        
                    inputDialog.remove();
                });
            }

            if (e.target.classList.contains('delete-mcp-service')) {
                const row = e.target.closest('tr');
                const serviceId = row.querySelector('.mcp-service-id').value;
                await this.removeMCPService(serviceId);
                row.remove();
            }

            if (e.target.classList.contains('update-mcp-key')) {
                const row = e.target.closest('tr');
                const serviceId = row.querySelector('.mcp-service-id').value;
                
                // Show input dialog for new API key
                const inputDialog = document.createElement('div');
                inputDialog.classList.add('cc-dialog');
                inputDialog.innerHTML = `
                    <div class="cc-dialog-content">
                        <h3>Update MCP API Key</h3>
                        <div class="cc-input-group">
                            <label>New API key for ${serviceId}:</label>
                            <input type="password" class="cc-dialog-input">
                        </div>
                        <div class="cc-dialog-buttons">
                            <button class="cc-button cancel">Cancel</button>
                            <button class="cc-button confirm">Update</button>
                        </div>
                    </div>
                `;
                
                dialog.appendChild(inputDialog);
                
                const input = inputDialog.querySelector('.cc-dialog-input');
                input.focus();
                
                inputDialog.querySelector('.cancel').addEventListener('click', () => {
                    inputDialog.remove();
                });
                
                inputDialog.querySelector('.confirm').addEventListener('click', async () => {
                    const newValue = input.value.trim();
                    if (newValue) {
                        const config = this.mcpConfigurations.get(serviceId) || {};
                        config.apiKey = newValue;
                        await this.configureMCPService({
                            serviceId,
                            endpoint: config.endpoint,
                            apiKey: newValue,
                            options: config.options
                        });
                        
                        const encryptedValue = row.querySelector('.encrypted-value');
                        encryptedValue.innerHTML = '••••••••';
                    }
                    inputDialog.remove();
                });
            }

            if (e.target.classList.contains('toggle-mcp-service')) {
                const row = e.target.closest('tr');
                const serviceId = row.querySelector('.mcp-service-id').value;
                const endpoint = row.querySelector('.mcp-endpoint').value;
                const statusSpan = row.querySelector('.mcp-status');
                const toggleBtn = e.target;

                if (statusSpan.textContent === 'connected') {
                    // Disconnect
                    await carbonCommander.mcpToolCaller.disconnectMCPService(serviceId);
                    statusSpan.textContent = 'disconnected';
                    statusSpan.className = 'mcp-status disconnected';
                    toggleBtn.textContent = 'Connect';
                } else {
                    // Connect
                    const config = this.mcpConfigurations.get(serviceId);
                    if (config) {
                        const success = await carbonCommander.mcpToolCaller.connectMCPService(serviceId);
                        if (success) {
                            statusSpan.textContent = 'connected';
                            statusSpan.className = 'mcp-status connected';
                            toggleBtn.textContent = 'Disconnect';
                        }
                    }
                }
            }
        });
        
        // Set up command history management
        const hostnameSelect = dialog.querySelector('#hostname-select');
        const clearHistoryBtn = dialog.querySelector('#clear-history');

        // Function to load hostnames with command history
        const loadHistoryHostnames = async () => {
            const historyKeys = await this._postMessageHandler({
                type: 'GET_HISTORY_HOSTNAMES'
            });
            
            hostnameSelect.innerHTML = '<option value="">Select hostname...</option>';
            if (historyKeys && historyKeys.payload) {
                historyKeys.payload.forEach(hostname => {
                    const option = document.createElement('option');
                    option.value = hostname;
                    option.textContent = hostname;
                    hostnameSelect.appendChild(option);
                });
            }
        };

        loadHistoryHostnames();

        clearHistoryBtn.addEventListener('click', async () => {
            const selectedHostname = hostnameSelect.value;
            if (!selectedHostname) {
                alert('Please select a hostname first');
                return;
            }

            if (confirm(`Are you sure you want to clear command history for ${selectedHostname}?`)) {
                await this._postMessageHandler({
                    type: 'CLEAR_COMMAND_HISTORY',
                    payload: {
                        hostname: selectedHostname
                    }
                });
                
                // Refresh the hostname list
                await loadHistoryHostnames();
                hostnameSelect.value = '';
            }
        });
        
        const confirmBtn = dialog.querySelector('.confirm');
        confirmBtn.addEventListener('click', async () => {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Saving settings from confirm click');
            try
            {
                // Save system prompt
                this.systemPrompt = dialog.querySelector('#system-prompt').value.trim();
                
                // Save hostname prompts using the specific hostname-prompts-table class
                const newHostnamePrompts = new Map();
                const hostnameRows = dialog.querySelector('.hostname-prompts-table tbody').querySelectorAll('tr');
                for (const row of hostnameRows) {
                    const hostnameKey = row.querySelector('.hostname-key');
                    const hostnamePrompt = row.querySelector('.hostname-prompt');
                    if (hostnameKey && hostnamePrompt) {
                        const hostname = hostnameKey.value.trim();
                        const prompt = hostnamePrompt.value.trim();
                        if (hostname && prompt) {
                            newHostnamePrompts.set(hostname, prompt);
                        }
                    }
                }
                this.hostnamePrompts = newHostnamePrompts;
                            
                // Save key-value pairs using the specific key-value-pairs-table class
                const newPairs = new Map();
                const newEncryptedKeys = this.encryptedKeys;

                const kvRows = dialog.querySelector('.key-value-pairs-table tbody').querySelectorAll('tr');
                for (const row of kvRows) {
                    const key = row.querySelector('.kv-key')?.value.trim();
                    const valueInput = row.querySelector('.kv-value');
                    const encryptToggle = row.querySelector('.encrypt-toggle');
                    
                    if (key) {
                        if (this.encryptedKeys.has(key) && this.keyValuePairs.has(key)) {
                            //do nothing but eat this logic, we do this again below
                        } else if (valueInput) {
                            const value = valueInput.value;
                            if (value !== undefined && value !== null) {
                                const trimmedValue = typeof value === 'string' ? value.trim() : value;
                                if (trimmedValue !== '') {
                                    // If this is the OpenAI key and it's being encrypted, test it first
                                    if(key === 'openai-key') {
                                        const response = await this.testOpenAIKey(trimmedValue);
                                        if(!response.success) {
                                            alert('Invalid OpenAI key, test failed');
                                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Failed to set OpenAI key');
                                            return;
                                        }
                                    }

                                    newPairs.set(key, trimmedValue);
                                    // Check if this should be encrypted
                                    if (encryptToggle && encryptToggle.checked)
                                        newEncryptedKeys.set(key, true);
                                }
                            }
                        }
                    }
                }
                
                for(const [key, value] of this.keyValuePairs.entries()) {
                    if(this.encryptedKeys.has(key)) {
                        const newValue = this.keyValuePairs.get(key);
                        typeof newValue === 'string' ? newValue.trim() : newValue;
                        newPairs.set(key, newValue);
                        newEncryptedKeys.set(key, true);
                    }
                }

                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Old keyValuePairs:', this.keyValuePairs);
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Old encryptedKeys:', this.encryptedKeys);

                this.keyValuePairs = newPairs;
                this.encryptedKeys = newEncryptedKeys;

                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('New keyValuePairs:', this.keyValuePairs);
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('New encryptedKeys:', this.encryptedKeys);

                await this.save();
                overlay.remove();
            }catch(error)
            {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error saving settings:', error);
            }finally
            {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
            }
            
        });
        
        const cancelBtn = dialog.querySelector('.cancel');
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
        });
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // New method to handle MCP configuration
    async configureMCPService(serviceConfig) {
        const { serviceId, endpoint, apiKey, options = {} } = serviceConfig;
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Configuring MCP service: ${serviceId}`);
        
        try {
            const config = {
                endpoint,
                apiKey,
                options,
                status: 'configured'
            };

            this.mcpConfigurations.set(serviceId, config);
            await this.save();
            return true;
        } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error configuring MCP service ${serviceId}:`, error);
            return false;
        }
    }

    // New method to remove MCP configuration
    async removeMCPService(serviceId) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Removing MCP service: ${serviceId}`);
        
        try {
            // Remove from configurations
            this.mcpConfigurations.delete(serviceId);
            
            // Remove encrypted API key
            await this._postMessageHandler({
                type: 'DELETE_ENCRYPTED_VALUE',
                payload: {
                    key: `mcp-key-${serviceId}`
                }
            });
            
            await this.save();
            return true;
        } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error removing MCP service ${serviceId}:`, error);
            return false;
        }
    }

    // New method to get MCP service configuration
    getMCPServiceConfig(serviceId) {
        return this.mcpConfigurations.get(serviceId);
    }

    // New method to list all MCP services
    getMCPServices() {
        return Array.from(this.mcpConfigurations.entries()).map(([id, config]) => ({
            id,
            endpoint: config.endpoint,
            options: config.options
        }));
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (new Settings()); 

/***/ }),

/***/ "./src/chrome-carbonbar-page/tool-caller.js":
/*!**************************************************!*\
  !*** ./src/chrome-carbonbar-page/tool-caller.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _global_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../global.js */ "./src/global.js");


class ToolCaller {
    currentPageTools = null;

    reset() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Resetting tool caller state');
        this.currentPageTools = null;
    }

    getToolSets() {
        return this.getAllToolsets();
    }

    getTools(onlyFunctionInfo = false) {        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Getting Tools');
        let allTools = [];
        let pageTools = this.getAllToolSetsForPage();
        pageTools.forEach(toolSet => {
            toolSet.tools.forEach(prop => {
                allTools.push(onlyFunctionInfo ? prop.function : prop);
            });
        });
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Found ${allTools.length} tools`);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return allTools;
    }

    getTool(toolName, onlyFunctionInfo = false) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Getting tool:', toolName);
        const allTools = this.getTools(onlyFunctionInfo);
        const tool = allTools.find(tool => onlyFunctionInfo ? tool.name == toolName : tool.function.name == toolName);
        if (!tool) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.warn(`Tool not found: ${toolName}`);
        }
        return tool;
    }

    async getToolScope(bar) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Building Tool Scope', "bar.settings:", bar.settings, "bar:", bar);
        var scope = {
            bar: bar,
            settings: {
                keyValuePairs: bar.settings?.keyValuePairs || new Map(),
                encryptedKeys: bar.settings?.encryptedKeys || new Map()
            },
            requestIdMap: new Map(),
            logMessage: (...args) => {
                let important = false;
                if(typeof args[0] === 'boolean') {
                    important = args[0];
                    args = args.slice(1);
                }
                if(important) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.info('[ToolScope]', ...args);
                } else {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('[ToolScope]', ...args);
                }
            },
            logError: (...args) => {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('[ToolScope]', ...args);
            },
            promptAccessRequest: async (args) => {
                const { prompt, default_value } = args;
                const promise = new Promise(async (resolve) => {
                    // Generate a unique ID for this request
                    const requestId = Math.random().toString(36).substr(2, 9);

                    const messageHandler = (event) => {
                        // ick, I dont really like how this looks.
                        
                        if(event.data.type && event.data.type === 'CARBON_ACCESS_REQUEST_RESPONSE_RESPONSE' && event.data.payload.payload.requestId === requestId) {
                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('CARBON_ACCESS_REQUEST_RESPONSE_RESPONSE2', event, "payload:", event.data.payload.payload);
                            window.removeEventListener('message', messageHandler);
                            const response = event.data.payload.payload;
                            if(response.confirmed) {
                                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('CONFIRMATION_DIALOG_RESPONSE', 'granted', response);
                                resolve(response);
                            } else {
                                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('CONFIRMATION_DIALOG_RESPONSE', 'denied', response);
                                resolve(response);
                            }

                        } else {
                            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('CARBON_ACCESS_REQUEST_RESPONSE_RESPONSE1', requestId, event);
                        }
                    };
                    window.addEventListener('message', messageHandler);

                    // Send message to command bar to show confirmation dialog
                    bar.postMessage({
                        type: 'SHOW_ACCESS_REQUEST',
                        payload: {
                            requestId: requestId,
                            prompt: prompt
                        }
                    });

                });
                var result = await promise;
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('CONFIRMATION_DIALOG_RESPONSE2', 'result:', result);
                return result;
            }
        }
        //Apply the current toolsets scope functions
        for(let toolSet of this.getAllToolSetsForPage()) {
            try {
                if(toolSet.toolSet._CarbonBarBuildScope) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Building scope for toolset: ${toolSet.name}`);
                    scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('App name after scope build:', scope.appName);
                }
            } catch (e) {
                _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error('Error building scope:', e);
            }
        }

        if(!scope.appName) {
            _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.warn('No app name found in scope, using default');
            scope.appName = 'CarbonCommander [Unknown App (2)]';
        }
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Final app name:', scope.appName);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return scope;
    }

    getAllToolSetsForPage() {
        if(this.currentPageTools) {
            return this.currentPageTools;
        }
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Getting Tool Sets for Page');
        this.currentPageTools = this.getAllToolsets().filter(toolSet => 
            (toolSet.tools && toolSet.tools.length > 0) &&
            (toolSet.toolSet._CarbonBarPageLoadFilter && toolSet.toolSet._CarbonBarPageLoadFilter(window))
        );
        
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Found ${this.currentPageTools.length} tool sets for current page`);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return this.currentPageTools;
    }

    getAllToolsets() {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Getting All Tool Sets');
        const allTools = [];
        if (window.sbaiTools) {
            Object.entries(window.sbaiTools).forEach(([_, toolSet]) => {
                try {
                    let toolset = {
                        name: toolSet.name,
                        toolSet: toolSet,
                        tools: Object.getOwnPropertyNames(toolSet)
                            .filter(prop => typeof toolSet[prop] === 'object' && toolSet[prop]?.function)
                            .map(prop => toolSet[prop])
                    };

                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Processing toolset:', { 
                        name: toolset.name, 
                        toolCount: toolset.tools.length 
                    });

                    if(toolset.tools && toolset.tools.length > 0) {
                        allTools.push(toolset);
                    }
                } catch (e) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.error(`Error getting tools from ${toolSet.name}:`, e);
                }
            });
        }
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Total tool sets found: ${allTools.length}`);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return allTools;
    }


    async buildSystemPrompt(basePrompt, scope) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Building System Prompt');
        let toolSets = this.getAllToolSetsForPage();
        if(toolSets.length > 0) {
            for(let toolSet of toolSets) { 
                if(toolSet.toolSet._CarbonBarSystemPrompt) {
                    _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug(`Adding system prompt from toolSet: ${toolSet.name || 'unnamed'}`);
                    if(toolSet.toolSet._CarbonBarBuildScope) {
                        scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                    }
                    basePrompt = await toolSet.toolSet._CarbonBarSystemPrompt(basePrompt, scope);
                }
            }
        }
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return basePrompt;
    }

    getToolHtml(chunk) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.group('Generating Tool HTML');
        const toolName = chunk.name;
        const toolArgs = chunk.arguments;
        let toolResult = chunk.result;
        const toolCallIndex = chunk.index;
        const toolCallStarted = chunk.callStarted;
        const toolCallFinished = chunk.callFinished;
        const tool = this.getTool(toolName, true);

        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Tool chunk info:', {
            name: toolName,
            hasArgs: !!toolArgs,
            started: toolCallStarted,
            finished: toolCallFinished
        });

        try {
            if(toolResult && typeof toolResult === 'string') {
                toolResult = JSON.parse(toolResult);
                if(toolResult.startsWith('ERROR: ')) {
                    toolResult = JSON.parse(toolResult.substring(7));
                }
            }
        } catch(e) {
            
        }

        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Tool result status:', {
            hasResult: !!toolResult,
            hasError: !!toolResult?.error
        });

        let status = 'pending';
        let statusText = 'Preparing...';
        
        if (toolCallStarted && !toolCallFinished) {
            status = 'running';
            statusText = 'Running';
        } else if (toolCallFinished) {
            status = toolResult?.error ? 'error' : 'completed';
            statusText = toolResult?.error ? 'Error' : 'Completed';
        }

        // Generate parameters documentation HTML
        let parametersHtml = '';
        if (tool.parameters?.properties) {
            parametersHtml = `
                <div class="tool-parameters">
                    <h4>Parameters:</h4>
                    <table class="tool-params-table">
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Required</th>
                            <th>Description</th>
                        </tr>
                        ${Object.entries(tool.parameters.properties).map(([name, param]) => `
                            <tr>
                                <td>${name}</td>
                                <td>${param.type}</td>
                                <td>${tool.parameters.required?.includes(name) ? '✓' : ''}</td>
                                <td>${param.description || ''}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            `;
        }

        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('parametersHtmlTest', toolResult?.result ? toolResult.result : 'No result');

        // Generate advanced view HTML
        const advancedHtml = `
            <div class="tool-advanced-container">
                <button class="tool-view-toggle">Show Simple</button>
                <div class="tool-header">
                    <span class="tool-name">${toolName}</span>
                    <span class="tool-status ${status}">${statusText}</span>
                </div>
                ${tool.description ? `<div class="tool-description">${tool.description}</div>` : ''}
                ${parametersHtml}
                ${toolArgs ? `
                    <div class="tool-arguments-section">
                        <h4>Current Call Arguments:</h4>
                        <div class="tool-arguments">${ (toolArgs instanceof Object) ? JSON.stringify(toolArgs) : toolArgs}</div>
                    </div>
                ` : ''}
                ${toolResult?.error ? `<div class="cc-error">${toolResult.error}</div>` : ''}
                ${toolResult ? `
                    <div class="tool-result-section">
                        <h4>Result:</h4>
                        <div class="tool-result-content">${ (toolResult instanceof Object) ? JSON.stringify(toolResult) : toolResult}</div>
                    </div>
                ` : ''}
            </div>
        `;

        // Generate simple view HTML
        const simpleHtml = `
            <div class="tool-simple-container ${status}">
                <div class="tool-simple-content">
                    <div class="tool-simple-icon ${status}">🔧</div>
                    <div class="tool-simple-info">
                        <div class="tool-simple-name">${toolName}</div>
                        ${toolResult?.error ? 
                            `<div class="cc-error">${toolResult.error}</div>` :
                            toolResult ? 
                                `<div class="tool-simple-progress">
                                    <div class="progress-bar" style="width: 100%"></div>
                                </div>` :
                                `<div class="tool-simple-progress">
                                    <div class="progress-bar" style="width: ${toolCallFinished ? '100%' : toolCallStarted ? '50%' : '20%'}"></div>
                                </div>`
                        }
                    </div>
                </div>
            </div>
        `;

        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Generated HTML with status:', status);
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.groupEnd();
        return { simpleHtml, advancedHtml };
    }

    static getService(serviceName) {
        _global_js__WEBPACK_IMPORTED_MODULE_0__.ccLogger.debug('Getting service:', serviceName);
        return angular.element(document).injector().get(serviceName);
    }
}
const toolCaller = new ToolCaller();
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (toolCaller);

/***/ }),

/***/ "./src/global.js":
/*!***********************!*\
  !*** ./src/global.js ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AICallerModels: () => (/* binding */ AICallerModels),
/* harmony export */   ccDefaultKeybind: () => (/* binding */ ccDefaultKeybind),
/* harmony export */   ccLogger: () => (/* binding */ ccLogger),
/* harmony export */   ccOneTimeMessageHandler: () => (/* binding */ ccOneTimeMessageHandler)
/* harmony export */ });
/**
 * Global logger implementation for Carbon Commander
 */
let ccLoggerPrefix = '';

const ccDefaultKeybind = {
    key: 'k',
    ctrl: true,
    meta: false
};


const ccOneTimeMessageHandler = async (requestId) => {
    return new Promise((resolve) => {
        const messageHandler = (event) => {
            window.removeEventListener('message', messageHandler);
            resolve(event);
        };
        window.addEventListener(`${requestId}_RESPONSE`, messageHandler);
    });
}

const ccLogger = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    group: console.group,
    groupEnd: console.groupEnd,
    time: console.time,
    timeEnd: console.timeEnd,
    setPrefix: (prefix) => {
        ccLoggerPrefix = prefix;
        // Wrap console methods to include prefix
        ccLogger.log = (...args) => console.log(ccLoggerPrefix, ...args);
        ccLogger.info = (...args) => console.info(ccLoggerPrefix, ...args);
        ccLogger.warn = (...args) => console.warn(ccLoggerPrefix, ...args);
        ccLogger.error = (...args) => console.error(ccLoggerPrefix, ...args);
        ccLogger.debug = (...args) => console.debug(ccLoggerPrefix, ...args);
    }
};

const AICallerModels = {
    ['FAST']: {
        ollama: 'qwen2.5:14b',
        openai: 'gpt-4o-mini'
    },
    ['REASON']: {
        ollama: "deepseek-r1:70b",
        openai: "o3-mini"
    },
    ['VISION']: {
        ollama: "llama3.2-vision",
        openai: "gpt-4o"
    },
    ['AUTOCOMPLETE']: {
        ollama: 'mistral-small',//"qwen2.5:1.5b",
        openai: "gpt-4o-mini"
    }
}

/***/ }),

/***/ "./src/tools/CarbonBarHelpTools.js":
/*!*****************************************!*\
  !*** ./src/tools/CarbonBarHelpTools.js ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CarbonBarHelpTools: () => (/* binding */ CarbonBarHelpTools)
/* harmony export */ });
class CarbonBarHelpTools {
    static name = "CarbonBarHelpTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return true; //manually get injected as needed
    }

    static GetNoAIModeToolInfo() {
        return [
            CarbonBarHelpTools.SetOpenAIKey.function,
            CarbonBarHelpTools.CheckOllamaStatus.function,
            CarbonBarHelpTools.GetSetupGuide.function,
            CarbonBarHelpTools.GetUsageGuide.function,
            CarbonBarHelpTools.ChangeKeybind.function,
            CarbonBarHelpTools.ListGuides.function
        ];
    }

    static ListGuides = {
        function: {
            name: 'list_guides',
            description: 'List all available guides and documentation',
            parameters: {}
        },
        execute: async function(scope, args) {
            const guide = `# Available Guides in Carbon Commander

## Setup Guides
Use \`get_setup_guide [topic]\` with:
- \`openai\` - OpenAI API setup and configuration
- \`ollama\` - Ollama local AI setup and configuration
- \`mcp\` - MCP service setup and integration
- \`general\` - General setup and configuration overview

## Usage Guides
Use \`get_usage_guide [topic]\` with:
- \`keybinds\` - Keyboard shortcuts and customization
- \`commands\` - Available commands and usage
- \`tools\` - Tool system and functionality
- \`general\` - Quick start and overview

## Examples
1. Get OpenAI setup instructions:
   \`get_setup_guide openai\`

2. Learn about keyboard shortcuts:
   \`get_usage_guide keybinds\`

3. Set up MCP services:
   \`get_setup_guide mcp\`

4. Get general usage overview:
   \`get_usage_guide general\`

## Additional Help
- Type \`help\` for general assistance
- Type \`change-keybind\` to customize shortcuts
- Click the ⚡ icon to see all available tools
- Use \`mcp connect\` to add services

## Quick Links
- [OpenAI Platform](https://platform.openai.com)
- [Ollama Website](https://ollama.ai)
- [Chrome Extensions](chrome://extensions)`;

            return { success: true, result: guide };
        }
    };

    static GetSetupGuide = {
        function: {
            name: 'get_setup_guide',
            description: 'Get detailed setup instructions for OpenAI, Ollama, and MCP',
            parameters: {
                properties: {
                    topic: {
                        type: 'string',
                        description: 'The specific setup topic (openai, ollama, mcp, or general). Use list_guides to see all available guides.'
                    }
                },
                required: ['topic']
            }
        },
        execute: async function(scope, args) {
            const { topic } = args;
            let guide = '';

            switch(topic.toLowerCase()) {
                case 'openai':
                    guide = `# Setting up OpenAI

1. Visit [OpenAI's platform](https://platform.openai.com/signup)
2. Create an account or sign in
3. Go to [API Keys](https://platform.openai.com/api-keys)
4. Click "Create new secret key"
5. Copy your API key
6. Use the command: \`set openai-key YOUR_API_KEY\`

## Additional Configuration
- API key is stored securely and encrypted
- Key can be updated any time with the same command
- Use \`disconnect openai\` to remove the key

## Troubleshooting
- Ensure your API key is valid and has sufficient credits
- Check connection status in the status badges
- If issues persist, try disconnecting and reconnecting

## Tips
- Keep your API key secure and never share it
- Regularly rotate your API keys for security
- Monitor your API usage on OpenAI's platform

Need more help? Try:
- \`get_usage_guide general\` for general usage
- \`list_guides\` to see all available guides
- \`check-ollama\` to verify Ollama status`;
                    break;

                case 'ollama':
                    guide = `# Setting up Ollama

1. Visit [Ollama.ai](https://ollama.ai)
2. Download the installer for your system
3. Install and run Ollama
4. For macOS users, enable external connections:
   \`\`\`bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
   \`\`\`
5. Restart Ollama after setting OLLAMA_ORIGINS

## Configuration
- No API key required
- Runs completely locally
- Automatic model management
- Supports multiple AI models

## Verification
Use \`check-ollama\` to verify:
- Connection status
- Available models
- Service health

## Troubleshooting
1. If Ollama is not detected:
   - Check if Ollama is running
   - Verify OLLAMA_ORIGINS setting (macOS)
   - Restart Ollama service

2. For connection issues:
   - Check firewall settings
   - Verify port 11434 is available
   - Ensure no conflicts with other services

## Tips
- Keep Ollama updated for best performance
- Use lightweight models for faster responses
- Configure resource limits as needed

Need more help? Try:
- \`get_usage_guide general\` for general usage
- \`list_guides\` to see all available guides
- \`check-ollama\` for status check`;
                    break;

                case 'mcp':
                    guide = `# Setting up MCP (Model Context Protocol)

## Overview
MCP allows you to extend Carbon Commander with external AI services and tools.

## Basic Setup
1. **Simple Connection**
   \`\`\`
   mcp connect my-service https://my-mcp-service.example.com
   \`\`\`

2. **With Authentication**
   \`\`\`javascript
   window.carbonCommander.mcpToolCaller.configureMCPService({
     serviceId: 'my-service',
     endpoint: 'https://my-mcp-service.example.com',
     apiKey: 'your-api-key',
     options: {
       autoConnect: true,
       autoReconnect: true
     }
   });
   \`\`\`

## Service Management
1. **View Status**:
   - Check status badges in UI
   - Look for "MCP:" prefix in tools list

2. **Disconnect Service**:
   \`mcp disconnect my-service\`

## Creating an MCP Service
Required endpoints:
\`\`\`javascript
GET  /discover-tools    // List available tools
POST /execute          // Execute tool function
GET  /status           // Service status

// Optional endpoints
POST /build-scope      // Custom tool scope
POST /system-prompt    // Enhance prompts
\`\`\`

## Example Service Definition
\`\`\`javascript
{
  name: "email-tools",
  tools: [{
    name: "send-email",
    description: "Send email via MCP",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  }]
}
\`\`\`

## Security Best Practices
1. Use HTTPS for all connections
2. Implement proper authentication
3. Validate all requests
4. Use rate limiting
5. Monitor service usage

## Troubleshooting
1. **Connection Issues**:
   - Verify endpoint URL
   - Check authentication
   - Ensure service is running

2. **Tool Discovery**:
   - Verify /discover-tools endpoint
   - Check tool definitions
   - Monitor browser console

3. **Execution Problems**:
   - Validate parameters
   - Check error responses
   - Verify tool implementation

## Tips
- Use autoConnect for reliability
- Implement error handling
- Monitor tool performance
- Keep services updated

Need more help? Try:
- \`get_usage_guide tools\` for tool usage
- \`list_guides\` for all guides
- Check service documentation`;
                    break;

                case 'general':
                    guide = `# General Setup Guide

## Quick Start
1. Install the extension
2. Configure providers:
   - OpenAI for advanced features (\`get_setup_guide openai\`)
   - Ollama for local processing (\`get_setup_guide ollama\`)
   - MCP for external services (\`get_setup_guide mcp\`)
3. Customize keyboard shortcuts
4. Start using commands

## AI Provider Setup
1. **OpenAI (Recommended)**
   - Get API key: \`get_setup_guide openai\`
   - Set key: \`set openai-key YOUR_KEY\`
   - Check status in badges

2. **Ollama (Optional)**
   - Install locally: \`get_setup_guide ollama\`
   - Runs automatically when detected
   - Provides faster local processing

3. **MCP Services (Optional)**
   - Connect services: \`mcp connect [service-id] [endpoint]\`
   - View status in badges
   - Use service-specific tools

## Keyboard Setup
1. Default: \`Ctrl/⌘ + K\`
2. Customize:
   - Use \`change-keybind\` command
   - Or click extension icon
   - Or use Chrome settings

## Verification
1. Check OpenAI:
   - Look for green status badge
   - Try a simple command
   
2. Check Ollama:
   - Use \`check-ollama\` command
   - Verify status badge

3. Check MCP:
   - Look for service badges
   - Try service-specific tools

## Next Steps
1. Try basic commands
2. Explore available tools
3. Set up keyboard shortcuts
4. Configure AI providers

Need more details? Try:
- \`get_setup_guide openai\` for OpenAI setup
- \`get_setup_guide ollama\` for Ollama setup
- \`get_setup_guide mcp\` for MCP setup
- \`get_usage_guide general\` for usage help
- \`list_guides\` to see all guides`;
                    break;

                default:
                    return { 
                        success: false, 
                        result: "Invalid topic. Available guides:\n\n" +
                               "1. Setup Guides (use get_setup_guide):\n" +
                               "   - openai: OpenAI configuration\n" +
                               "   - ollama: Ollama setup\n" +
                               "   - mcp: MCP service setup\n" +
                               "   - general: Overall setup\n\n" +
                               "2. Usage Guides (use get_usage_guide):\n" +
                               "   - keybinds: Keyboard shortcuts\n" +
                               "   - commands: Available commands\n" +
                               "   - tools: Tool system\n" +
                               "   - general: Quick start\n\n" +
                               "Use list_guides to see all available guides."
                    };
            }

            return { success: true, result: guide };
        }
    };

    static CheckOllamaStatus = {
        function: {
            name: 'check_ollama_status',
            description: 'Check if Ollama is running and accessible',
            parameters: {}
        },
        execute: async function(scope, args) {
            try {
                const response = await fetch('http://localhost:11434/api/tags');
                const data = await response.json();
                
                if (data) {
                    return { 
                        success: true, 
                        result: "✅ Ollama is running and accessible.\n\nAvailable models:\n" + 
                               data.models?.map(m => `- ${m.name}`).join('\n') 
                    };
                }
            } catch (error) {
                return { 
                    success: false, 
                    result: "❌ Ollama is not accessible. Common issues:\n\n" +
                           "1. Ollama is not installed\n" +
                           "2. Ollama service is not running\n" +
                           "3. OLLAMA_ORIGINS is not set (macOS)\n\n" +
                           "Use 'get_setup_guide ollama' for installation instructions."
                };
            }
        }
    };

    static SetOpenAIKey = {
        function: {
            name: 'set_openai_key',
            description: 'Set the OpenAI key',
            parameters: {
                properties: {
                    key: {
                        type: 'string',
                        description: 'The OpenAI key'
                    }
                },
                required: ['key']
            }
        },
        execute: async function(scope, args) {
            const { key } = args;
            scope.logMessage('set_openai_key', key);
            return new Promise((resolve, reject) => {
                window.postMessage({
                    type: 'CARBON_SET_OPENAI_KEY',
                    payload: {
                        key: key,
                        save: true
                    }
                }, window.location.origin);

                const listener = (event) => {   
                    if (event.data.type === 'CARBON_SET_OPENAI_KEY_RESPONSE') {
                        const payload = event.data.payload?.payload || event.data.payload;
                        scope.logMessage('CARBON_SET_OPENAI_KEY_RESPONSE', event.data, payload);
                        if(payload.success === true){
                            window.postMessage({
                                type: 'PROVIDER_STATUS_UPDATE',
                                provider: 'openai',
                                status: true
                            }, window.location.origin);
                            resolve({success: true, content: 'OpenAI key set successfully'});
                        }else{
                            resolve({success: false, content: 'Failed to set OpenAI key'});
                        }
                        window.removeEventListener('message', listener);
                    }
                };
                window.addEventListener('message', listener);
            });
        }
    };

    static GetUsageGuide = {
        function: {
            name: 'get_usage_guide',
            description: 'Get detailed usage instructions for Carbon Commander features',
            parameters: {
                properties: {
                    topic: {
                        type: 'string',
                        description: 'The specific usage topic (keybinds, commands, tools, or general)'
                    }
                },
                required: ['topic']
            }
        },
        execute: async function(scope, args) {
            const { topic } = args;
            let guide = '';

            switch(topic.toLowerCase()) {
                case 'keybinds':
                    guide = `# Keyboard Shortcuts Guide

## Default Shortcuts
- Open/Close: \`Ctrl + K\` (Windows/Linux) or \`⌘ + K\` (Mac)
- Close: \`Esc\`
- Command History: \`↑\` and \`↓\` arrow keys
- Autocomplete: \`Tab\`

## Customizing Shortcuts
1. **Through Extension Icon**:
   - Click Carbon Commander icon
   - Select "Change Keybind"
   - Press desired key combination
   - Click "Save"

2. **Through Chrome Settings**:
   - Go to \`chrome://extensions/shortcuts\`
   - Find Carbon Commander
   - Click the pencil icon
   - Set your shortcut

3. **Using Command**:
   - Type \`change-keybind\` in Carbon Commander
   - Follow the prompts

## Tips
- Combine with \`Ctrl\` or \`⌘\` for better shortcuts
- Avoid system-reserved shortcuts
- Use single letter keys for quick access`;
                    break;

                case 'commands':
                    guide = `# Available Commands Guide

## Basic Commands
- \`help\`: Show general help
- \`get_usage_guide [topic]\`: Get detailed usage instructions
- \`change-keybind\`: Change keyboard shortcut
- \`set openai-key [key]\`: Set OpenAI API key
- \`check-ollama\`: Check Ollama status

## Navigation
- Use arrow keys (↑/↓) for command history
- Press Tab for autocomplete suggestions
- Type partial command name to search

## Tool Commands
- Click the ⚡ icon to see all available tools
- Tools are grouped by source (Local/MCP)
- Each tool has a description and parameters

## Tips
- Commands are case-insensitive
- Use autocomplete for faster input
- Check tool descriptions for parameter info`;
                    break;

                case 'tools':
                    guide = `# Tools Usage Guide

## Tool Categories
1. **Local Tools**
   - Built-in functionality
   - No external dependencies
   - Fast execution

2. **MCP Tools**
   - External service integration
   - Additional capabilities
   - Network-dependent

## Using Tools
1. Click the ⚡ icon to view all tools
2. Select a tool to auto-fill command
3. Provide required parameters
4. View results in the response area

## Tool Features
- Real-time execution feedback
- Error handling and recovery
- Parameter validation
- Result formatting

## Tips
- Use tool descriptions for guidance
- Check parameter requirements
- Monitor tool status indicators
- Use command history for repeated tasks`;
                    break;

                case 'general':
                    guide = `# Carbon Commander Quick Start Guide

## Getting Started
1. Open with \`Ctrl/⌘ + K\` or click extension icon
2. Type your command or question
3. Use Tab for autocomplete
4. Press Enter to execute

## Key Features
1. **AI Integration**
   - OpenAI for advanced processing
   - Ollama for local operations
   - Real-time responses

2. **Tool System**
   - Built-in tools
   - MCP service integration
   - Custom tool support

3. **Command History**
   - Arrow keys navigation
   - Persistent storage
   - Quick access to recent commands

4. **Autocomplete**
   - Smart suggestions
   - Tab completion
   - Context-aware

## Best Practices
- Start with simple commands
- Use help guides for specific topics
- Customize shortcuts for efficiency
- Check tool documentation

Need more help? Try:
- \`get_usage_guide keybinds\`
- \`get_usage_guide commands\`
- \`get_usage_guide tools\``;
                    break;

                default:
                    return { success: false, error: 'Invalid topic. Use "keybinds", "commands", "tools", or "general".' };
            }

            return { success: true, result: guide };
        }
    };

    static ChangeKeybind = {
        function: {
            name: 'change-keybind',
            description: 'Change the keyboard shortcut for opening Carbon Commander',
            parameters: {}
        },
        execute: async function(scope, args) {
            window.postMessage({ type: 'SHOW_KEYBIND_DIALOG' }, window.location.origin);
            return { 
                success: true, 
                result: "Opening keybind configuration dialog..." 
            };
        }
    };
}

(window.sbaiTools ??= {}).CarbonBarHelpTools = CarbonBarHelpTools;



/***/ }),

/***/ "./src/tools/GeneralTools.js":
/*!***********************************!*\
  !*** ./src/tools/GeneralTools.js ***!
  \***********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GeneralTools: () => (/* binding */ GeneralTools)
/* harmony export */ });
class GeneralTools {
    static _CarbonBarPageLoadFilter = (window) => {
        return true; //Always available
    }

    static SearchWeb = {
        function: {
            name: 'search_web',
            description: 'Search the web using DuckDuckGo',
            parameters: {
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query'
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 5)'
                    }
                },
                required: ['query']
            }
        },
        execute: async function(scope, args) {
            const { query, max_results = 5 } = args;
            try {
                const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
                const data = await response.json();
                
                const results = data.RelatedTopics
                    .slice(0, max_results)
                    .map(topic => ({
                        title: topic.Text?.split(' - ')[0] || topic.Text,
                        description: topic.Text,
                        url: topic.FirstURL
                    }));
                
                return { success: true, result: results };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static SecurityCheck = {
        function: {
            name: 'security_check',
            description: 'Perform a basic security analysis of the current website',
            parameters: {
                type: 'object',
                properties: {
                    include_headers: {
                        type: 'boolean',
                        description: 'Whether to include security header analysis',
                        default: true
                    },
                    check_ssl: {
                        type: 'boolean',
                        description: 'Whether to check SSL certificate details',
                        default: true
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { include_headers = true, check_ssl = true } = args;
            try {
                const securityReport = {
                    url: window.location.href,
                    protocol: window.location.protocol,
                    isSecure: window.location.protocol === 'https:',
                    timestamp: new Date().toISOString()
                };

                // Check security headers if requested
                if (include_headers) {
                    const headers = await fetch(window.location.href, { method: 'HEAD' })
                        .then(response => {
                            const headerData = {};
                            response.headers.forEach((value, key) => {
                                if (key.toLowerCase().includes('security') || 
                                    ['content-security-policy', 'x-frame-options', 'x-xss-protection',
                                     'strict-transport-security', 'x-content-type-options'].includes(key.toLowerCase())) {
                                    headerData[key] = value;
                                }
                            });
                            return headerData;
                        });
                    securityReport.securityHeaders = headers;
                }

                // Check SSL certificate if requested and available
                if (check_ssl && window.location.protocol === 'https:') {
                    const certificateInfo = {
                        issuer: document.querySelector('meta[name="ssl-issuer"]')?.content || 'Not available in client',
                        validFrom: document.querySelector('meta[name="ssl-valid-from"]')?.content || 'Not available in client',
                        validTo: document.querySelector('meta[name="ssl-valid-to"]')?.content || 'Not available in client'
                    };
                    securityReport.sslCertificate = certificateInfo;
                }

                // Check for common security issues
                securityReport.securityIssues = [];
                
                // Check if site uses HTTPS
                if (!securityReport.isSecure) {
                    securityReport.securityIssues.push({
                        severity: 'high',
                        issue: 'Site does not use HTTPS',
                        recommendation: 'Enable HTTPS to secure data transmission'
                    });
                }

                // Check for mixed content
                const mixedContent = Array.from(document.querySelectorAll('img, script, link, iframe'))
                    .filter(el => {
                        const src = el.src || el.href;
                        return src && src.startsWith('http:');
                    });
                if (mixedContent.length > 0) {
                    securityReport.securityIssues.push({
                        severity: 'medium',
                        issue: 'Mixed content detected',
                        details: `${mixedContent.length} resources loaded over insecure HTTP`,
                        recommendation: 'Update resource URLs to use HTTPS'
                    });
                }

                // Check for vulnerable input fields
                const passwordFields = Array.from(document.querySelectorAll('input[type="password"]'));
                const insecurePasswordFields = passwordFields.filter(field => !field.closest('form')?.hasAttribute('autocomplete'));
                if (insecurePasswordFields.length > 0) {
                    securityReport.securityIssues.push({
                        severity: 'medium',
                        issue: 'Insecure password fields detected',
                        details: `${insecurePasswordFields.length} password fields without proper autocomplete attributes`,
                        recommendation: 'Add autocomplete attributes to password fields'
                    });
                }

                return { success: true, result: securityReport };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static GenerateImage = {
        function: {
            name: 'generate_image',
            description: 'Generate an image using DALL-E',
            parameters: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The image generation prompt'
                    },
                    size: {
                        type: 'string',
                        description: 'Image size (256x256, 512x512, or 1024x1024)',
                        enum: ['256x256', '512x512', '1024x1024'],
                        default: '1024x1024'
                    },
                    style: {
                        type: 'string',
                        description: 'Image style (vivid or natural)',
                        enum: ['vivid', 'natural'],
                        default: 'vivid'
                    },
                    openai_key: {
                        type: 'string',
                        description: 'The OpenAI API key to use for image generation',
                    }
                },
                required: ['prompt', 'openai_key']
            }
        },
        execute: async function(scope, args) {
            const { prompt, size = '1024x1024', style = 'vivid', openai_key } = args;
            
            // Get OpenAI key from settings
            const openaiKey = openai_key;
            if (!openaiKey) {
                return { 
                    success: false, 
                    error: 'OpenAI API key not set. Please set it using the set-openai-key command.' 
                };
            }

            try {
                const response = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiKey}`
                    },
                    body: JSON.stringify({
                        prompt,
                        n: 1,
                        size,
                        style
                    })
                });

                const data = await response.json();
                if (data.error) {
                    return { success: false, error: data.error.message };
                }

                return { success: true, result: data.data[0].url };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static GetPageMetadata = {
        function: {
            name: 'get_page_metadata',
            description: 'Get metadata about the current webpage',
            parameters: {
                type: 'object',
                properties: {}  // No parameters needed
            }
        },
        execute: async function(scope, args) {
            try {
                const metadata = {
                    title: document.title,
                    description: document.querySelector('meta[name="description"]')?.content,
                    keywords: document.querySelector('meta[name="keywords"]')?.content,
                    author: document.querySelector('meta[name="author"]')?.content,
                    url: window.location.href,
                    domain: window.location.hostname,
                    lastModified: document.lastModified,
                    language: document.documentElement.lang,
                    charset: document.characterSet,
                    viewport: document.querySelector('meta[name="viewport"]')?.content
                };

                return { success: true, result: metadata };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static ExtractPageContent = {
        function: {
            name: 'extract_page_content',
            description: 'Extract main content from the current webpage',
            parameters: {
                type: 'object',
                properties: {
                    include_images: {
                        type: 'boolean',
                        description: 'Whether to include image information',
                        default: false
                    },
                    include_links: {
                        type: 'boolean',
                        description: 'Whether to include link information',
                        default: false
                    },
                    include_html: {
                        type: 'boolean',
                        description: 'Whether to include HTML (for complex queries)',
                        default: false
                    },
                    body_query_selector: {
                        type: 'string',
                        description: 'The query selector to use to extract the body content (optional)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { include_images = false, include_links = false, include_html = false, body_query_selector } = args;
            try {
                // Get main content (prioritize article or main content areas)
                let mainContent = document.querySelector('article, [role="main"], main, .main-content, #main-content') || document.body;
                if (body_query_selector) {
                    mainContent = document.querySelector(body_query_selector);
                }
                
                const wordLimit = 10000;
                const charLimit = wordLimit * 5;
                const chatCount = mainContent.textContent.trim().length;
                const wordCount = mainContent.textContent.trim().split(/\s+/).length;

                if(chatCount > charLimit || wordCount > wordLimit) {

                    const trimmedContent = mainContent.textContent.trim().slice(0, 5000);
                    const trimmedWordCount = trimmedContent.split(/\s+/).length;
                    const trimmedChatCount = trimmedContent.length;

                    const content = `
${trimmedContent}


Content is too long. The output has been limited. Try again with a more specific query or use the body_query_selector to target a specific part of the page.
Chat count: ${trimmedChatCount} / ${chatCount}, Word count: ${trimmedWordCount} / ${wordCount}
                    `.trim();

                    return {
                        success: true,
                        content: content
                    };
                }


                const content = {
                    text: mainContent.textContent.trim(),
                    wordCount: wordCount,
                    html: include_html ? mainContent.innerHTML : null
                };

                if (include_images) {
                    content.images = Array.from(mainContent.querySelectorAll('img')).map(img => ({
                        src: img.src,
                        alt: img.alt,
                        width: img.width,
                        height: img.height
                    }));
                }

                if (include_links) {
                    content.links = Array.from(mainContent.querySelectorAll('a')).map(link => ({
                        text: link.textContent.trim(),
                        href: link.href,
                        title: link.title
                    }));
                }

                return { success: true, result: content };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static PromptUserForConfirmation = {
        function: {
            name: 'prompt_user_for_confirmation',
            description: 'Prompt the user for confirmation',
            parameters: {
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The prompt to show the user'
                    }
                },
                required: ['prompt']
            }
        },
        execute: async function(scope, args) {
            const { prompt } = args;
            return new Promise((resolve) => {
                // Generate a unique ID for this request
                const requestId = 'confirm_' + Math.random().toString(36).substr(2, 9);
                
                // Create a one-time message handler for this specific request
                const messageHandler = (event) => {
                    const payload = event.data.payload?.payload || event.data.payload;
                    scope.logMessage('CB_DIALOG_RETURN', payload);
                    if (event.data.type === 'CB_DIALOG_RETURN' && payload.requestId === requestId) {
                        window.removeEventListener('message', messageHandler);
                        scope.logMessage('CB_DIALOG_RETURN', event.data);
                        if (payload.confirmed) {
                            resolve({
                                success: true,
                                result: 'User granted permission'
                            });
                        } else {
                            resolve({
                                success: false,
                                error: 'User denied permission'
                            });
                        }
                    }
                };
                
                // Add the message listener
                window.addEventListener('message', messageHandler);

                // Create dialog HTML with animations
                const dialogHtml = `
                    <div class="cc-dialog" style="animation: messageAppear 0.3s ease-in-out forwards;">
                        <div class="cc-dialog-content">
                            <p>${prompt}</p>
                            <div class="cc-dialog-buttons">
                                <button class="cc-button confirm" data-action="confirm">Confirm</button>
                                <button class="cc-button cancel" data-action="cancel">Cancel</button>
                            </div>
                        </div>
                    </div>
                `;

                // Send message to command bar to show confirmation dialog
                window.postMessage({
                    type: 'CB_SHOW_CONFIRMATION_DIALOG',
                    payload: {
                        requestId: requestId,
                        prompt: prompt,
                        dialogHtml: dialogHtml
                    }
                }, window.location.origin);
            });
        }
    };

    static PromptUserForInput = {
        function: {
            name: 'prompt_user_for_input',
            description: 'Prompt the user for input, you can spawn multiple prompts at once if needed',
            parameters: {
                properties: {
                    type: {
                        type: 'string',
                        description: 'Input type (text, number, date, etc)'
                    },
                    name: {
                        type: 'string',
                        description: 'The name of the input'
                    },
                    default_value: {
                        type: 'string',
                        description: 'The default value of the input'
                    },
                    prompt: {
                        type: 'string',
                        description: 'The prompt to show the user, optional'
                    }
                },
                required: ['type', 'name']
            }
        },
        execute: async function(scope, args) {
            const { type, name, default_value, prompt } = args;
            return new Promise((resolve) => {
                // Generate a unique ID for this request
                const requestId = 'input_' + Math.random().toString(36).substr(2, 9);
                
                // Create a one-time message handler for this specific request
                const messageHandler = (event) => {
                    const payload = event.data.payload?.payload || event.data.payload;
                    scope.logMessage('CB_DIALOG_RETURN', payload);
                    if (event.data.type === 'CB_DIALOG_RETURN' && payload.requestId === requestId) {
                        
                        window.removeEventListener('message', messageHandler);
                        const input = payload.input;
                        if (input !== null) {
                            resolve({
                                success: true,
                                result: input
                            });
                        } else {
                            resolve({
                                success: false,
                                error: 'User did not provide input'
                            });
                        }
                    }
                };
                
                // Add the message listener
                window.addEventListener('message', messageHandler);

                // Send message to command bar to show input dialog
                window.postMessage({
                    type: 'CB_SHOW_INPUT_DIALOG',
                    payload: {
                        requestId: requestId,
                        type: type,
                        name: name,
                        defaultValue: default_value,
                        prompt: prompt
                    }
                }, window.location.origin);
            });
        }
    };

    static ColorPicker = {
        function: {
            name: 'color_picker',
            description: 'Pick colors from the current webpage or get color suggestions',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        description: 'Mode of operation (pick, suggest, extract)',
                        enum: ['pick', 'suggest', 'extract'],
                        default: 'pick'
                    },
                    theme: {
                        type: 'string',
                        description: 'Color theme for suggestions (warm, cool, monochrome, complementary)',
                        default: 'warm'
                    },
                    format: {
                        type: 'string',
                        description: 'Color format to return (hex, rgb, hsl)',
                        enum: ['hex', 'rgb', 'hsl'],
                        default: 'hex'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const { mode = 'pick', theme = 'warm', format = 'hex' } = args;
            try {
                let result = {};

                // Helper function to convert colors between formats
                const convertColor = (color, targetFormat) => {
                    // Create a temporary div to use the browser's color parsing
                    const div = document.createElement('div');
                    div.style.color = color;
                    document.body.appendChild(div);
                    const computed = window.getComputedStyle(div).color;
                    document.body.removeChild(div);

                    // Parse RGB values
                    const [r, g, b] = computed.match(/\d+/g).map(Number);

                    switch (targetFormat) {
                        case 'hex':
                            return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
                        case 'rgb':
                            return `rgb(${r}, ${g}, ${b})`;
                        case 'hsl':
                            // Convert RGB to HSL
                            const rr = r / 255;
                            const gg = g / 255;
                            const bb = b / 255;
                            const max = Math.max(rr, gg, bb);
                            const min = Math.min(rr, gg, bb);
                            let h, s, l = (max + min) / 2;

                            if (max === min) {
                                h = s = 0;
                            } else {
                                const d = max - min;
                                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                                switch (max) {
                                    case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
                                    case gg: h = (bb - rr) / d + 2; break;
                                    case bb: h = (rr - gg) / d + 4; break;
                                }
                                h /= 6;
                            }

                            return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
                    }
                };

                switch (mode) {
                    case 'pick':
                        // Create a message handler for the color picker
                        return new Promise((resolve) => {
                            const requestId = 'colorpick_' + Math.random().toString(36).substr(2, 9);
                            
                            // Create one-time message handler
                            const messageHandler = (event) => {
                                if (event.data.type === 'COLOR_PICKED' && event.data.requestId === requestId) {
                                    window.removeEventListener('message', messageHandler);
                                    const color = convertColor(event.data.color, format);
                                    resolve({
                                        success: true,
                                        result: {
                                            color,
                                            element: event.data.elementInfo,
                                            originalFormat: event.data.originalFormat
                                        }
                                    });
                                }
                            };
                            
                            window.addEventListener('message', messageHandler);

                            // Send message to activate color picker
                            window.postMessage({
                                type: 'ACTIVATE_COLOR_PICKER',
                                payload: {
                                    requestId: requestId
                                }
                            }, window.location.origin);
                        });

                    case 'suggest':
                        // Generate color suggestions based on theme
                        const suggestions = {
                            warm: ['#FF6B6B', '#FFA07A', '#FFD93D', '#FF8C42', '#FF4E50'],
                            cool: ['#4A90E2', '#67B26F', '#4CA1AF', '#5D4157', '#2F80ED'],
                            monochrome: ['#2C3E50', '#34495E', '#547891', '#95A5A6', '#BDC3C7'],
                            complementary: ['#2ECC71', '#E74C3C', '#3498DB', '#F1C40F', '#9B59B6']
                        };

                        result = {
                            theme,
                            colors: suggestions[theme].map(color => ({
                                [format]: convertColor(color, format),
                                hex: color
                            }))
                        };
                        break;

                    case 'extract':
                        // Extract dominant colors from the page
                        const elements = document.querySelectorAll('*');
                        const colors = new Set();
                        
                        elements.forEach(el => {
                            const style = window.getComputedStyle(el);
                            ['color', 'backgroundColor', 'borderColor'].forEach(prop => {
                                const color = style[prop];
                                if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
                                    colors.add(color);
                                }
                            });
                        });

                        result = {
                            colors: Array.from(colors)
                                .slice(0, 10) // Limit to top 10 colors
                                .map(color => ({
                                    [format]: convertColor(color, format),
                                    original: color
                                }))
                        };
                        break;
                }

                return { success: true, result };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    static ManageAPIKey = {
        function: {
            name: 'manage_api_key',
            description: 'Get or set API keys for various services. Use this to manage API keys for OpenAI and other services.',
            parameters: {
                properties: {
                    action: {
                        type: 'string',
                        description: 'The action to perform: "get" or "set"',
                        enum: ['get', 'set']
                    },
                    key_name: {
                        type: 'string',
                        description: 'The name of the API key to manage (e.g., "openai-key")',
                        enum: ['openai-key']
                    },
                    value: {
                        type: 'string',
                        description: 'The API key value to set (only required for "set" action)'
                    },
                    reason: {
                        type: 'string',
                        description: 'The reason for the action, recipient of the key'
                    }
                },
                required: ['action', 'key_name', 'reason']
            }
        },
        execute: async function(scope, args) {
            let { action, key_name, value, reason } = args;
            
            if (action === 'get') {
                const is_encrypted = scope.settings?.encryptedKeys?.get(key_name);
                let keyExists = is_encrypted || (scope.settings?.keyValuePairs?.has(key_name) && 
                                scope.settings?.keyValuePairs?.get(key_name)?.length > 0);

                scope.logMessage('ManageAPIKeyDEBUG: ' + JSON.stringify({
                    scope,
                    settings: scope.settings,
                    is_encrypted,
                    keyExists,
                    key_name,
                    value,
                    reason
                }));
                
                if(is_encrypted) {
                    const response = await scope.promptAccessRequest({
                        prompt: `Allow ${reason} (and this page) access to ${key_name}?`,
                        default_value: 'yes'
                    });
                    if(!response.confirmed ){
                        return response;
                    }

                    const promise = new Promise((resolve, reject) => {
                                            
                        window.addEventListener('message', (event) => {
                            if(event.data.type === 'CARBON_GET_ENCRYPTED_VALUE_RESPONSE' && event.data.payload.key === key_name) {
                                resolve(event.data.payload.value);
                            }
                        });
                        scope.bar.postMessage({
                            type: 'GET_ENCRYPTED_VALUE',
                            payload: {
                                key: key_name
                            }
                        });
                    });

                    value = await promise;
                }
                
                return {
                    success: true,
                    result: {
                        key_name,
                        is_set: keyExists,
                        is_encrypted: is_encrypted,
                        value: value
                    }
                };
            } else if (action === 'set') {
                if (!value) {
                    return {
                        success: false,
                        error: 'Value is required for set action'
                    };
                }

                if (key_name === 'openai-key') {
                    // Use the existing SetOpenAIKey tool's functionality
                    return await CarbonBarHelpTools.SetOpenAIKey.execute(scope, { key: value });
                }

                // For future key types, add handling here
                return {
                    success: false,
                    error: `Unsupported key_name: ${key_name}`
                };
            }

            return {
                success: false,
                error: `Invalid action: ${action}`
            };
        }
    };
}
if(window.sbaiTools) {
    window.sbaiTools['GeneralTools'] = GeneralTools;
} else {
    window.sbaiTools = {
        'GeneralTools': GeneralTools
    };
}



/***/ }),

/***/ "./src/tools/external/BitbucketTools.js":
/*!**********************************************!*\
  !*** ./src/tools/external/BitbucketTools.js ***!
  \**********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BitbucketTools: () => (/* binding */ BitbucketTools)
/* harmony export */ });
class BitbucketTools {
    static name = "BitbucketTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('bitbucket.org');
    }

    static CreatePullRequest = {
        function: {
            name: 'create_pullrequest',
            description: 'Create a new pull request',
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'Title of the pull request'
                    },
                    source_branch: {
                        type: 'string',
                        description: 'Source branch name'
                    },
                    target_branch: {
                        type: 'string',
                        description: 'Target branch name (default: main/master)'
                    },
                    description: {
                        type: 'string',
                        description: 'Description of the changes'
                    },
                    reviewers: {
                        type: 'string',
                        description: 'Comma-separated list of reviewer usernames'
                    }
                },
                required: ['title', 'source_branch']
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                const prData = {
                    title: args.title,
                    source: {
                        branch: { name: args.source_branch }
                    },
                    target: {
                        branch: { name: args.target_branch || 'main' }
                    },
                    description: args.description || '',
                    reviewers: args.reviewers ? 
                        args.reviewers.split(',').map(username => ({ username: username.trim() })) 
                        : []
                };

                const response = await scope.$http.post(
                    `/api/2.0/repositories/${workspace}/${repo}/pullrequests`,
                    prData
                );

                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error creating pull request:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetPullRequests = {
        function: {
            name: 'get_pullrequests',
            description: 'Get list of pull requests',
            parameters: {
                properties: {
                    state: {
                        type: 'string',
                        description: 'Filter by PR state (OPEN, MERGED, DECLINED, SUPERSEDED)'
                    },
                    author: {
                        type: 'string',
                        description: 'Filter by author username'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                let endpoint = `/api/2.0/repositories/${workspace}/${repo}/pullrequests`;
                const params = new URLSearchParams();
                
                if (args.state) params.append('state', args.state);
                if (args.author) params.append('q', `author.username="${args.author}"`);
                
                if (params.toString()) {
                    endpoint += `?${params.toString()}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error getting pull requests:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetRecentCommits = {
        function: {
            name: 'get_recent_commits',
            description: 'Get recent commits for a branch',
            parameters: {
                properties: {
                    branch: {
                        type: 'string',
                        description: 'Branch name (default: main/master)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of commits to return (default: 10)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                // Get repository info from current URL
                const [workspace, repo] = window.location.pathname.split('/').filter(Boolean);
                
                const branch = args.branch || 'main';
                const limit = args.limit || 10;
                
                const endpoint = `/api/2.0/repositories/${workspace}/${repo}/commits/${branch}?limit=${limit}`;
                
                const response = await scope.$http.get(endpoint);
                
                // Format the commit data
                const commits = response.data.values.map(commit => ({
                    hash: commit.hash,
                    message: commit.message,
                    author: commit.author.raw,
                    date: commit.date,
                    links: commit.links
                }));

                return { success: true, result: commits };
            } catch (error) {
                scope.logError('Error getting recent commits:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['BitbucketTools'] = BitbucketTools;
} else {
    window.sbaiTools = {
        'BitbucketTools': BitbucketTools
    };
}

 

/***/ }),

/***/ "./src/tools/external/HackerNewsTools.js":
/*!***********************************************!*\
  !*** ./src/tools/external/HackerNewsTools.js ***!
  \***********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HackerNewsTools: () => (/* binding */ HackerNewsTools)
/* harmony export */ });
class HackerNewsTools {
    static name = "HackerNewsTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('news.ycombinator.com');
    }

    static _CarbonBarBuildScope = async (scope) => {
        try{
            var articleName = document.querySelector('.titleline a');
            scope.appName = `HackerNews [${articleName}]`;
        } catch (error) {
            scope.logError('Error building scope', error);
            scope.appName = 'HackerNews [Unknown Article]';
        }

        return scope;
    }

    static ReadPage = {
        function: {
            name: 'read_hn_page',
            description: 'Read a specific page from Hacker News',
            parameters: {
                properties: {
                    page_number: {
                        type: 'number',
                        description: 'The page number to read (defaults to 1)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const pageNum = args.page_number || 1;
                const response = await scope.$http.get(`https://news.ycombinator.com/news?p=${pageNum}`);
                
                // Parse the HTML response
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.data, 'text/html');
                
                // Extract stories
                const stories = [];
                const storyRows = doc.querySelectorAll('.athing');
                
                storyRows.forEach(row => {
                    const subtext = row.nextElementSibling;
                    const title = row.querySelector('.titleline a');
                    const score = subtext?.querySelector('.score');
                    const age = subtext?.querySelector('.age');
                    const comments = subtext?.querySelectorAll('a')[3]; // Last link is usually comments
                    
                    stories.push({
                        id: row.id,
                        title: title?.textContent,
                        url: title?.href,
                        score: score?.textContent,
                        age: age?.textContent,
                        comments: comments?.textContent,
                        commentsUrl: comments?.href ? `https://news.ycombinator.com/${comments.href}` : null
                    });
                });

                return { 
                    success: true, 
                    result: {
                        page: pageNum,
                        stories: stories
                    }
                };
            } catch (error) {
                scope.logError('Error reading HN page:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['HackerNewsTools'] = HackerNewsTools;
} else {
    window.sbaiTools = {
        'HackerNewsTools': HackerNewsTools
    };
}

 

/***/ }),

/***/ "./src/tools/external/JiraTools.js":
/*!*****************************************!*\
  !*** ./src/tools/external/JiraTools.js ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   JiraTools: () => (/* binding */ JiraTools)
/* harmony export */ });
class JiraTools {
    static name = "JiraTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Match Jira Cloud or Server URLs
        return window.location.hostname.includes('atlassian.net') || 
               window.location.pathname.includes('/jira/');
    }

    static GetSprints = {
        function: {
            name: 'get_sprints',
            description: 'Get list of sprints for a board',
            parameters: {
                properties: {
                    board_id: {
                        type: 'string',
                        description: 'The ID of the board to get sprints from'
                    },
                    state: {
                        type: 'string',
                        description: 'Filter sprints by state (active, future, closed)'
                    }
                },
                required: ['board_id']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = `/rest/agile/1.0/board/${args.board_id}/sprint`;
                if (args.state) {
                    endpoint += `?state=${args.state}`;
                }
                
                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error getting sprints:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadSprintBoard = {
        function: {
            name: 'read_sprint_board',
            description: 'Get all issues in a sprint board',
            parameters: {
                properties: {
                    board_id: {
                        type: 'string',
                        description: 'The ID of the board to read'
                    },
                    sprint_id: {
                        type: 'string',
                        description: 'The ID of the sprint to read (optional)'
                    }
                },
                required: ['board_id']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = `/rest/agile/1.0/board/${args.board_id}/issue`;
                if (args.sprint_id) {
                    endpoint += `?sprint=${args.sprint_id}`;
                }
                
                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading sprint board:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static CreateIssue = {
        function: {
            name: 'create_issue',
            description: 'Create a new issue (bug or task)',
            parameters: {
                properties: {
                    project_key: {
                        type: 'string',
                        description: 'The project key (e.g., "PROJ")'
                    },
                    issue_type: {
                        type: 'string',
                        description: 'Type of issue (bug, task)'
                    },
                    summary: {
                        type: 'string',
                        description: 'Issue summary/title'
                    },
                    description: {
                        type: 'string',
                        description: 'Detailed description of the issue'
                    },
                    priority: {
                        type: 'string',
                        description: 'Issue priority (Highest, High, Medium, Low, Lowest)'
                    },
                    assignee: {
                        type: 'string',
                        description: 'Username of the assignee'
                    },
                    sprint_id: {
                        type: 'string',
                        description: 'ID of the sprint to add the issue to'
                    }
                },
                required: ['project_key', 'issue_type', 'summary']
            }
        },
        execute: async function(scope, args) {
            try {
                const issueData = {
                    fields: {
                        project: { key: args.project_key },
                        issuetype: { name: args.issue_type },
                        summary: args.summary,
                        description: args.description,
                        priority: args.priority ? { name: args.priority } : undefined,
                        assignee: args.assignee ? { name: args.assignee } : undefined
                    }
                };

                // Create the issue
                const response = await scope.$http.post('/rest/api/2/issue', issueData);
                
                // If sprint_id is provided, add issue to sprint
                if (args.sprint_id && response.data.id) {
                    await scope.$http.post(`/rest/agile/1.0/sprint/${args.sprint_id}/issue`, {
                        issues: [response.data.id]
                    });
                }

                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error creating issue:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ChangeIssueStatus = {
        function: {
            name: 'change_issue_status',
            description: 'Change the status of an issue',
            parameters: {
                properties: {
                    issue_key: {
                        type: 'string',
                        description: 'The issue key (e.g., "PROJ-123")'
                    },
                    status: {
                        type: 'string',
                        description: 'The new status to set'
                    }
                },
                required: ['issue_key', 'status']
            }
        },
        execute: async function(scope, args) {
            try {
                // First get available transitions
                const transitionsResponse = await scope.$http.get(
                    `/rest/api/2/issue/${args.issue_key}/transitions`
                );
                
                // Find the transition ID that matches the requested status
                const transition = transitionsResponse.data.transitions.find(
                    t => t.name.toLowerCase() === args.status.toLowerCase()
                );

                if (!transition) {
                    throw new Error(`Status transition to "${args.status}" not available`);
                }

                // Perform the transition
                const response = await scope.$http.post(
                    `/rest/api/2/issue/${args.issue_key}/transitions`,
                    { transition: { id: transition.id } }
                );

                return { success: true, result: `Issue ${args.issue_key} status changed to ${args.status}` };
            } catch (error) {
                scope.logError('Error changing issue status:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['JiraTools'] = JiraTools;
} else {
    window.sbaiTools = {
        'JiraTools': JiraTools
    };
}

 

/***/ }),

/***/ "./src/tools/external/RocketChatTools.js":
/*!***********************************************!*\
  !*** ./src/tools/external/RocketChatTools.js ***!
  \***********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   RocketChatTools: () => (/* binding */ RocketChatTools)
/* harmony export */ });
class RocketChatTools {
    static name = "RocketChatTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Match Rocket.Chat URLs - both cloud and self-hosted instances
        return window.location.hostname.includes('rocket.chat') || 
               document.querySelector('meta[name="application-name"][content="Rocket.Chat"]') !== null;
    }

    static ReadChannel = {
        function: {
            name: 'read_channel',
            description: 'Read messages from a Rocket.Chat channel',
            parameters: {
                properties: {
                    channel_name: {
                        type: 'string',
                        description: 'Name of the channel to read'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of messages to return (default: 50)'
                    },
                    include_threads: {
                        type: 'boolean',
                        description: 'Whether to include thread messages (default: false)'
                    }
                },
                required: ['channel_name']
            }
        },
        execute: async function(scope, args) {
            try {
                const limit = args.limit || 50;
                const includeThreads = args.include_threads || false;

                // Get the Meteor instance from window
                const Meteor = window.Meteor;
                if (!Meteor) {
                    throw new Error('Rocket.Chat Meteor instance not found');
                }

                // Get room ID from channel name
                const room = await new Promise((resolve, reject) => {
                    Meteor.call('getRoomByName', args.channel_name, (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    });
                });

                if (!room) {
                    throw new Error(`Channel "${args.channel_name}" not found`);
                }

                // Get messages
                const messages = await new Promise((resolve, reject) => {
                    Meteor.call('loadHistory', room._id, null, limit, null, (error, result) => {
                        if (error) reject(error);
                        else resolve(result.messages);
                    });
                });

                // Format messages
                let formattedMessages = messages.map(msg => ({
                    id: msg._id,
                    text: msg.msg,
                    sender: msg.u.username,
                    timestamp: msg.ts,
                    attachments: msg.attachments,
                    reactions: msg.reactions,
                    threadCount: msg.tcount || 0,
                    threadMainMessage: msg.tmid ? true : false
                }));

                // Get thread messages if requested
                if (includeThreads) {
                    const threadMainMessages = formattedMessages.filter(msg => msg.threadCount > 0);
                    for (const mainMsg of threadMainMessages) {
                        const threadMessages = await new Promise((resolve, reject) => {
                            Meteor.call('getThreadMessages', mainMsg.id, (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            });
                        });

                        mainMsg.thread = threadMessages.map(msg => ({
                            id: msg._id,
                            text: msg.msg,
                            sender: msg.u.username,
                            timestamp: msg.ts,
                            attachments: msg.attachments,
                            reactions: msg.reactions
                        }));
                    }
                }

                return { 
                    success: true, 
                    result: {
                        channel: {
                            id: room._id,
                            name: room.name,
                            type: room.t,
                            topic: room.topic,
                            memberCount: room.usersCount
                        },
                        messages: formattedMessages
                    }
                };
            } catch (error) {
                scope.logError('Error reading channel:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['RocketChatTools'] = RocketChatTools;
} else {
    window.sbaiTools = {
        'RocketChatTools': RocketChatTools
    };
}

 

/***/ }),

/***/ "./src/tools/external/SmarterMailTools.js":
/*!************************************************!*\
  !*** ./src/tools/external/SmarterMailTools.js ***!
  \************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmarterMailTools: () => (/* binding */ SmarterMailTools)
/* harmony export */ });

//TODO: Reduce size of SM content returns

class SmarterMailTools {
    static name = "SmarterMailTools";

    static _CarbonBarPageLoadFilter = (window) => {
        try{
            const user = angular.element(document).injector().get('coreData').user;
            if(user.username != null && user.username != '') {
                //If system admin, don't allow tools to be called they have a seperate list of tools
                if(user.isSysAdmin) {
                    return false;
                }
                //smartermail user logged in
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    static _CarbonBarBuildScope = async (scope) => {
        scope.getService = (serviceName) => {
            return angular.element(document).injector().get(serviceName);
        }
        scope.$http = scope.getService('$http');
        scope.$rootScope = window.smRsHook.$root;
        scope.getUserInfo = () => 
        {
            return new Promise(async (resolve, reject) => {
              try {
                const userService = await scope.getService('userDataService');
                const timeService = await scope.getService('userTimeService');
                
                resolve({
                  displayName: userService.user.displayName,
                  username: userService.user.username,
                  emailAddress: userService.user.emailAddress,
                  locale: userService.user.settings.userMailSettings.localeId,
                  categories: userService.user.categories,
                  tzid: timeService.userTimeZone.id
                });
              } catch (error) {
                reject(error);
              }
            });
        }

        try{
            var userInfo = await scope.getUserInfo();
            scope.appName = `SmarterMail [${userInfo.emailAddress}]`;
        } catch (error) {
            scope.logError('Error building scope', error);
            scope.appName = 'SmarterMail [Unknown User]';
        }

        return scope;
    }

    static _CarbonBarSystemPrompt = async (basePrompt, scope) => {
        var systemPrompt = basePrompt + '\n';
        try {
            var userInfo = await scope.getUserInfo();
            //include the user info
            systemPrompt += `The user is "${userInfo.displayName}" with email "${userInfo.emailAddress}" and timezone "${userInfo.tzid}" and locale "${userInfo.locale}"`;
    
            //include the categories
            if (userInfo.categories) {
              systemPrompt += `. User categories: ${userInfo.categories.map(category => category.name).join(', ')}`;
            }
          } catch (error) {
            scope.logError('Error getting user info:', error);
            systemPrompt += '. Unable to get user info.';
          }

        return systemPrompt;
    }


    static GetHelp = {
        function: {
            name: 'get_help',
            description: 'User is asking for help with something',
            parameters: {
                properties: {
                    topic: {
                        type: 'string'
                    },
                    command: {
                        type: 'string'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            scope.logMessage(`GetHelp: ${JSON.stringify(args, null, 2)}`);
            const { topic, command } = args;
            const result = await scope.$http.get(`https://api.openai.com/v1/chat/completions`, {
                headers: {
                    'Authorization': `Bearer ${scope.apiKey}`
                }
            });
            scope.logMessage(`GetHelp result: ${JSON.stringify(result, null, 2)}`);
            var response = result.data.choices[0].message.content;
            return { success: true, result: response };
        }
    };

    
    static GetCategoriesAndOtherFolders = {
        function: {
            name: 'get_categories_and_other_folders',
            description: "Get user's categories and folders for non-email sources",
        },
        execute: async function(scope, args) {
            const catService = scope.getService('coreDataCategories');
            const coreDataCalendar = scope.getService('coreDataCalendar');
            const coreDataNotes = scope.getService('coreDataNotes');
            const coreDataTasks = scope.getService('coreDataTasks');
            const coreDataContacts = scope.getService('coreDataContacts');
            await catService.loadUsersCategories();           
            const categories = await catService.getUsersCategories();
            //const folderList = await coreMailService.getFolderList();
            var folderList = [];

            coreDataCalendar.loadSources().then(function () {
                var calendars = coreDataCalendar.getCalendars();
                var calItems = [];
                for (var i = 0; i < calendars.length; i++) {
                    if (calendars[i].isSharedItem)
                        continue;
                    calItems.push({ translation: calendars[i].untranslatedName ? $translate.instant(calendars[i].untranslatedName) : calendars[i].name, value: calendars[i].id });
                }
                folderList['calendar'] = calItems;
            });
            coreDataNotes.ensureSourcesLoadedPromise().then(function () {
                var notes = coreDataNotes.getSources();
                notes = notes.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['notes'] = notes;
            });

            coreDataTasks.ensureSourcesLoadedPromise().then(function () {
                var tasks = coreDataTasks.getSources();
                tasks = tasks.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['tasks'] = tasks;
            });

            coreDataContacts.ensureSourcesLoadedPromise().then(function () {
                $scope.contactFolders = coreDataContacts.getSources();
                var contacts = coreDataContacts.getSources();
                contacts = contacts.filter((f) => {
                    return !f.isSharedItem;
                });
                folderList['contacts'] = contacts;
            });
            
            return { success: true, result: { categories, folderList } };
        }
    };

    static UpdateCategory = {
        function: {
            name: 'update_category',
            description: "Update or create a category for the user's account.",
            parameters: {
                properties: {
                    guid: {
                        type: 'string',
                        description: 'The guid of the category to update (only for updating)'
                    },
                    name: {
                        type: 'string'
                    },
                    color_index: {
                        type: 'number',
                        description: 'The color index (-1 = none/default, 0 = red, 1 = orange, 3 = yellow, 4 = green, 7 = blue, 8 = purple)'
                    },
                    is_default: {
                        type: 'boolean',
                        description: 'Whether this category is the default category'
                    }
                },
                required: ['name']
            }
        },
        execute: async function(scope, args) {
            const { guid, name, color_index, is_default } = args;
            var catResult = await scope.$http.get("~/api/v1/categories/user-category-settings");
            var catSettings = catResult.categorySettings;

            if(is_default) {
                catSettings.defaultCategory = name;
            }

            if(guid) {
                catSettings.categories = catSettings.categories.filter(cat => cat.guid !== guid);
            }
            catSettings.categories.push({ guid, name, colorIndex: color_index });
            try {
                await scope.$http.post("~/api/v1/categories/user-category-settings", catSettings);
                return { success: true, result: "Categories set" };
            } catch (error) {
                scope.logError('Error setting categories:', error);
                return { success: false, error: error.message };
            }
        }
    };

    //TODO: Newsfeeds?
    //TODO: basic user settings, contents filters, etc

    //TODO: (later) domain and system admin tools 
    //TODO: force user verification based on tool property



    static GetEmailFolders = {
        function: {
            name: 'get_email_folders',
            description: "Get folders for the user's emails"
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');
            const folderList = await coreMailService.getFolderList();
            return { success: true, result: folderList };
        }
    };

    static RemoveFolders = {
        function: {
            name: 'remove_folders',
            description: 'Remove folders for the user.',
            parameters: {
                properties: {
                    folder_ids: {
                        type: 'string',
                        description: "The id's of the folders to remove. Child folders are also removed. (comma separated)"
                    }
                },
                required: ['folder_ids']
            }
        },
        execute: async function(scope, args) {
            let folderIds = args.folder_ids.split(',').map(f => f.trim());
            const coreMailService = scope.getService('coreDataMail');
            await coreMailService.loadMailTree();

            const tasksService = scope.getService('coreDataTasks');
            await tasksService.ensureSourcesLoadedPromise();

            const notesService = scope.getService('coreDataNotes');
            await notesService.ensureSourcesLoadedPromise();

            const contactService = scope.getService('coreDataContacts');
            await contactService.ensureSourcesLoadedPromise();

            const calendarService = scope.getService('coreDataCalendar');
            await calendarService.loadSources();

            let totalRemovedFolders = 0;
            let removedFolders = [];
            let aiOutput = '';

            for(var i = 0; i < folderIds.length; i++) {
                //email folders
                const emailFolders = await coreMailService.getFolderList();
                var emailFolder = null;
                for(var j = 0; j < emailFolders.length; j++) { 
                    scope.logMessage(`Checking email folder: ${emailFolders[j].name} (${emailFolders[j].id})`, `Match: ${emailFolders[j].id} == ${folderIds[i]}`);
                    if(emailFolders[j].id == folderIds[i]) {
                        emailFolder = emailFolders[j];
                        break;
                    }
                }
                if(emailFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/folders/delete-folder', { 
                            folder: emailFolder.path,
                            parentFolder: ""
                        });
                        scope.logMessage('RemoveEmailFolder result:', result);
                        if(result.data.success) {
                            removedFolders.push({name: emailFolder.name, id: emailFolder.id});
                        } else {
                            aiOutput += `Error removing email folder: ${folderIds[i]} - ${result.data.message}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing email folder:', error);
                        aiOutput += `Error removing email folder: ${folderIds[i]} - ${error.data?.message}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed email folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const taskFolders = await tasksService.getSources();
                var taskFolder = null;
                for(var j = 0; j < taskFolders.length; j++) { 
                    scope.logMessage(`Checking task folder: ${taskFolders[j].name} (${taskFolders[j].folderId})`, `Match: ${taskFolders[j].folderId} == ${folderIds[i]}`);
                    if(taskFolders[j].folderId == folderIds[i]) {
                        taskFolder = taskFolders[j];
                        break;
                    }
                }
                if(taskFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/tasks/sources/delete', { 
                            folder: taskFolder.name,
                            uid: taskFolder.id
                        });
                        scope.logMessage('RemoveTaskFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: taskFolder.name, id: taskFolder.id});
                        } else {
                            aiOutput += `Error removing task folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing task folder:', error);
                        aiOutput += `Error removing task folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed task folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const noteFolders = await notesService.getSources();
                var noteFolder = null;
                for(var j = 0; j < noteFolders.length; j++) { 
                    scope.logMessage(`Checking note folder: ${noteFolders[j].displayName} (${noteFolders[j].folderId})`, `Match: ${noteFolders[j].folderId} == ${folderIds[i]}`);
                    if(noteFolders[j].folderId == folderIds[i]) {
                        noteFolder = noteFolders[j];
                        break;
                    }
                }
                if(noteFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/notes/sources/delete', { 
                            uid: noteFolder.itemID,
                            folder: noteFolder.displayName
                        });
                        scope.logMessage('RemoveNoteFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: noteFolder.displayName, id: noteFolder.itemID});
                        } else {
                            aiOutput += `Error removing note folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing note folder:', error);
                        aiOutput += `Error removing note folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed note folders: ${removedFolders.map(rf => rf.displayName).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }

            for(var i = 0; i < folderIds.length; i++) {
                const contactFolders = await contactService.getSources();
                var contactFolder = null;
                for(var j = 0; j < contactFolders.length; j++) { 
                    scope.logMessage(`Checking contact folder: ${contactFolders[j].displayName} (${contactFolders[j].folderId})`, `Match: ${contactFolders[j].folderId} == ${folderIds[i]}`);
                    if(contactFolders[j].folderId == folderIds[i]) {
                        contactFolder = contactFolders[j];
                        break;
                    }
                }
                if(contactFolder) {
                    try {
                        var result = await scope.$http.post('~/api/v1/contacts/address-book/delete', { 
                            uid: contactFolder.itemID,
                            //folder: contactFolder.displayName //not needed
                        });
                        scope.logMessage('RemoveContactFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: contactFolder.displayName, id: contactFolder.itemID});
                        } else {
                            aiOutput += `Error removing contact folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing contact folder:', error);
                        aiOutput += `Error removing contact folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed contact folders: ${removedFolders.map(rf => rf.displayName).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];
            }


            for(var i = 0; i < folderIds.length; i++) {
                const calendarFolders = await calendarService.getCalendars();
                var calendarFolder = null;
                for(var j = 0; j < calendarFolders.length; j++) { 
                    scope.logMessage(`Checking calendar folder: ${calendarFolders[j].name} (${calendarFolders[j].folderId})`, `Match: ${calendarFolders[j].folderId} == ${folderIds[i]}`);
                    if(calendarFolders[j].folderId == folderIds[i]) {
                        calendarFolder = calendarFolders[j];
                        break;
                    }
                }
                if(calendarFolder) {
                    try {
                        var result = await scope.$http.post(`~/api/v1/calendars/calendar-delete/${calendarFolder.id}`);
                        scope.logMessage('RemoveCalendarFolder result:', result);
                        if(result.success) {
                            removedFolders.push({name: calendarFolder.name, id: calendarFolder.id});
                        } else {
                            aiOutput += `Error removing calendar folder: ${folderIds[i]}\n`;
                        }
                    } catch (error) {
                        scope.logError('Error removing calendar folder:', error);
                        aiOutput += `Error removing calendar folder: ${folderIds[i]}\n`;
                    }
                }
            }
            if(removedFolders.length > 0) {
                aiOutput += `Removed calendar folders: ${removedFolders.map(rf => rf.name).join(', ')}\n`;
                folderIds = folderIds.filter(f => !removedFolders.some(rf => rf.id == f));
                totalRemovedFolders += removedFolders.length;
                removedFolders = [];    
            }

            if(totalRemovedFolders > 0) {
                return { success: true, result: aiOutput };
            } else {
                aiOutput += "\nNo folders removed";
                return { success: false, error: aiOutput };
            }
        }
    };

    static UpdateFolder = {
        function: {
            name: 'update_folder',
            description: 'Update or create a folder for the user.',
            parameters: {
                properties: {
                    type: {
                        type: 'string',
                        description: 'The type of the folder to update (email, calendar, notes, tasks, contacts)'
                    },
                    name: {
                        type: 'string',
                        description: 'The name of the folder to update'
                    },
                    parent_folder_id: {
                        type: 'string',
                        description: 'The parent folder_id to nest the folder in (optional, only for email)'
                    },
                    folder_id: {
                        type: 'string',
                        description: 'The id of the folder to update (only for updating)'
                    },
                    color: {
                        type: 'string',
                        description: 'The hex color of the calendar to update (only for calendars and tasks)'
                    }
                },
                required: ['type', 'name']
            }
        },
        execute: async function(scope, args) {
            const { type, name, parent_folder_id, folder_id, color } = args;

            if(type == 'email') {
                const coreMailService = scope.getService('coreDataMail');
                await coreMailService.loadMailTree();
                const folderList = await coreMailService.getFolderList();
                if(folder_id) {
                    //update in place
                    var folder = folderList.find(f => f.id == folder_id);
                    var parentFolder = parent_folder_id ? folderList.find(f => f.id == parent_folder_id) : null;
                    
                    if(parent_folder_id && !parentFolder) {
                        scope.logMessage(`Parent folder not found: ${parent_folder_id}`, folderList.map(f => `(${f.id} - ${f.path})`));
                        return { success: false, error: `Parent folder not found: ${parent_folder_id}, folderList: ${folderList.map(f => ` (${f.id} - ${f.path})`)}` };
                    }

                    if(folder) {
                        //This uses the folder names so we need to get the folders by id first
                        try {
                            var result = await scope.$http.post("~/api/v1/folders/folder-put", {
                                folder: name,
                                parentFolder: parentFolder?.path,
                                //ownerEmailAddress: ""
                            });
                            return { success: true, result: result.data };
                        } catch (error) {
                            scope.logError('Error updating folder:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Folder to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    var parentFolder = parent_folder_id ? folderList.find(f => f.id == parent_folder_id) : null;
                    try {
                        var result = await scope.$http.post("~/api/v1/folders/folder-put", {
                            folder: name,
                            parentFolder: parentFolder?.path,
                        });
                        return { success: true, result: result.data };
                    } catch (error) {
                        scope.logError('Error creating folder:', error);
                        return { success: false, error: error.message };
                    }
                }

            } else if(type == 'calendar') {
                var calendarService = scope.getService('coreDataCalendar');
                await calendarService.loadSources();
                var calendars = await calendarService.getCalendars();

                if(folder_id) {
                    var calendar = calendars.find(c => c.folderId == folder_id);
                    if(calendar) {
                        try {
                            let request = await scope.$http.post('~/api/v1/calendars/calendar', {
                                setting: {
                                    id: calendar.id,
                                    friendlyName: name || calendar.friendlyName,
                                    calendarViewColor: color || calendar.calendarViewColor,
                                    isPrimary: calendar.isPrimary
                                }
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                if(request.data)
                                    request.data.success = false; //Fixes an issue with calendar api
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            if(error.data)
                                error.data.success = false; //Fixes an issue with calendar api
                            scope.logError('Error updating calendar:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Calendar to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/calendars/calendar-put', {
                            setting: {
                                friendlyName: name,
                                calendarViewColor: color || "#7FC56F",
                                isPrimary: false
                            }
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            if(request.data)
                                request.data.success = false; //Fixes an issue with calendar api
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        if(error.data)
                            error.data.success = false; //Fixes an issue with calendar api
                        scope.logError('Error adding calendar:', error);
                        return { success: false, error: error.data };
                    }
                }
                
            } else if(type == 'notes') {
                var notesService = scope.getService('coreDataNotes');
                await notesService.ensureSourcesLoadedPromise();
                var noteFolders = await notesService.getSources();

                if(folder_id) {
                    var noteFolder = noteFolders.find(n => n.folderId == folder_id);
                    if(noteFolder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/notes/sources/edit', {
                                folder: name,
                                uid: noteFolder.itemID
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating note:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Note to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/notes/sources/add', {
                            folder: name
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding note:', error);
                        return { success: false, error: error.data };
                    }
                }

            } else if(type == 'tasks') {

                var tasksService = scope.getService('coreDataTasks');
                await tasksService.ensureSourcesLoadedPromise();
                var taskFolders = await tasksService.getSources();

                if(folder_id) {
                    var taskFolder = taskFolders.find(t => t.folderId == folder_id);
                    if(taskFolder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/tasks/sources/edit', {
                                folder: name,
                                uid: taskFolder.id,
                                color: color || "#7FC56F"
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating task:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Task to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/tasks/sources/add', {
                            folder: name,
                            color: color || "#7FC56F"
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding task:', error);
                        return { success: false, error: error.data };
                    }
                }
                
            } else if(type == 'contacts') {
                var contactService = scope.getService('coreDataContacts');
                var contactFolders = await contactService.getSources();
                
                if(folder_id) {
                    var folder = contactFolders.find(f => f.folderId == folder_id);
                    if(folder) {
                        try {
                            let request = await scope.$http.post('~/api/v1/contacts/address-book/edit', {
                                folder: name,
                                uid: folder.itemID,
                                //ownerEmailAddress: ""
                            });
                            if(request.data.success) {
                                return { success: true, result: request.data };
                            } else {
                                return { success: false, error: request.data };
                            }
                        } catch (error) {
                            scope.logError('Error updating folder:', error);
                            return { success: false, error: error.data };
                        }
                    } else {
                        return { success: false, error: `Folder to update not found: folder_id = ${folder_id}` };
                    }
                } else {
                    try {
                        let request = await scope.$http.post('~/api/v1/contacts/address-book/add', {
                            folder: name,
                            //ownerEmailAddress: ""
                        });
                        if(request.data.success) {
                            return { success: true, result: request.data };
                        } else {
                            return { success: false, error: request.data };
                        }
                    } catch (error) {
                        scope.logError('Error adding folder:', error);
                        return { success: false, error: error.data };
                    }
                }
            }
            
            return { success: false, error: `Folder type not supported: ${type}, supported types are: email, calendar, notes, tasks, contacts` };
        }
    }




    static ReadEmailsFast = {
        function: {
            name: 'read_emails_fast',
            description: 'Get the emails including only the subject and metadata for a given folder',
            parameters: {
                properties: {
                    message_filter: {
                        type: 'number',
                        description: '0 = most recent, 1 = unread, 2 = flagged, 3 = calendar, 4 = replied, -1 = all'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to read emails from (default = inbox)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from'
                    }
                },
                required: ['message_filter']
            }
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');
            const folder = args.folder?.toLowerCase() || 'inbox';
            const maxResults = args.max_results || 10;
            const startIndex = args.startIndex || 0;

            let searchCriteria = {
                folder: folder,
                ownerEmailAddress: '',
                sortType: 5, // internalDate
                sortAscending: false,
                startIndex: startIndex,
                maxResults: maxResults
            };

            // Add filter based on message_filter parameter
            if (args.message_filter !== -1) {
                searchCriteria.searchFlags = {};
                switch(args.message_filter) {
                    case 0: // most recent - no additional flags needed
                        break;
                    case 1: // unread
                        searchCriteria.searchFlags[0] = false; 
                        break;
                    case 2: // flagged
                        searchCriteria.searchFlags[4] = true;
                        break;
                    case 3: // calendar
                        searchCriteria.searchFlags[8] = true;
                        break;
                    case 4: // replied
                        searchCriteria.searchFlags[1] = true;
                        break;
                }
            }

            try {
                const result = await scope.$http.post("~/api/v1/mail/messages", searchCriteria);
                return { success: true, result: result.data };
            } catch (error) {
                scope.logError('Error fetching emails:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadEmail = {
        function: {
            name: 'read_email',
            description: 'Get the full email data for a given email by folder and uid',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: 'The uid of the email to read'
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to read emails from (default = inbox)'
                    },
                    include_attachments: {
                        type: 'boolean',
                        description: 'Whether to include attachments in the email data (default = false)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const parameters = {
                    'Folder': args.folder || 'inbox',
                    'UID': args.uid,
                    'OwnerEmailAddress': ""
                };

                // Get the full message data
                const messageResponse = await scope.$http.post("~/api/v1/mail/message", parameters);
                
                // If attachments are requested, get them
                if (args.include_attachments && messageResponse.data.messageData.hasAttachments) {
                    const attachmentResponse = await scope.$http.post("~/api/v1/mail/message/attachments", parameters);
                    messageResponse.data.messageData.attachments = attachmentResponse.data.attachments;
                }

                return { success: true, result: messageResponse.data.messageData };
            } catch (error) {
                scope.logError('Error fetching email:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetCalendarEvents = {
        function: {
            name: "get_calendar_events",
            description: "Get calendar events for a given date range",
            parameters: {
                properties: {
                    start_date: {
                        type: 'string',
                        description: 'The start date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_date:{ 
                        type: 'string',
                        description: 'The end date of the range to get events for (YYYY-MM-DDTHH:mm:ss)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 10)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from (default = 0)'
                    }
                },
                required: ['start_date', 'end_date']
            }
        },
        execute: async function(scope, args) {
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const maxResults = args.max_results || 10;
            const startIndex = args.startIndex || 0;
            const calendarId = args.calendar_id || (await cs.getCalendars()).filter(x=> x.isPrimary)[0].id;

            const calendar = (await cs.getCalendars()).filter(x=> x.id == calendarId)[0];
            
            const startDate = moment(args.start_date);
            const endDate = moment(args.end_date);


            var params = JSON.stringify({
                startDate: moment.utc(startDate),
                endDate: moment.utc(endDate),
            });
            var result = await scope.$http.post("~/api/v1/calendars/events/" + calendar.owner + "/" + calendar.id, params);
            var events = result.data.events;

            return { success: true, result: events };
        }
    };

    static GetNotes = {
        function: {
            name: 'get_notes',
            description: 'Get notes sorted by most recently edited',
            parameters: {
                properties: {
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 5)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from (default = 0)'
                    },
                    search_text: {
                        type: 'string',
                        description: "Text to search for in notes (default = '')"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const notesService = scope.getService('coreDataNotes');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            await notesService.ensureSourcesLoadedPromise();
            await notesService.ensureNotesLoadedPromise();
            
            const sources = notesService.getSources();
            scope.logMessage('SOURCES', sources);
            // Set search parameters if provided
            if (args.search_text) {
                notesService.parameters.searchText = args.search_text;
            }

            // Get filtered notes
            const notes = notesService.getFilteredNotes();
            
            // Apply pagination
            const paginatedNotes = notes.slice(startIndex, startIndex + maxResults);
            
            // Format the response
            const formattedNotes = paginatedNotes.map(note => ({
                id: note.id,
                title: note.subject,
                content: note.text,
                color: note.color,
                dateCreated: note.dateCreated,
                lastModified: note.lastModifiedUTC,
                categories: note.categoriesString,
                hasAttachments: note.hasAttachments
            }));

            return { success: true, result: formattedNotes };
        }
    };

    static GetTasks = {
        function: {
            name: "get_tasks",
            description: "Get tasks sorted by most recently edited",
            parameters: {
                properties: {
                    max_results: {
                        type: "number",
                        description: "The maximum number of results to return (default = 5)"
                    },
                    startIndex: {
                        type: "number",
                        description: "The index to start from"
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const tasksService = scope.getService('coreDataTasks');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            // Load sources and tasks
            await tasksService.ensureSourcesLoadedPromise();
            await tasksService.ensureTasksLoadedPromise();

            // Get filtered tasks
            const tasks = tasksService.getFilteredTasks();
            
            // Apply pagination
            const paginatedTasks = tasks.slice(startIndex, startIndex + maxResults);
            
            return { success: true, result: paginatedTasks };
        }
    };

    static GetContacts = {
        function: {
            name: 'get_contacts',
            description: 'Get contacts sorted by most recently contacted',
            parameters: {
                properties: {
                    search_query: {
                        type: 'string',
                        description: 'The search query to filter contacts by (searches all fields)'
                    },
                    max_results: {
                        type: 'number',
                        description: 'The maximum number of results to return (default = 5)'
                    },
                    startIndex: {
                        type: 'number',
                        description: 'The index to start from'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const contactsService = scope.getService('coreDataContacts');
            const maxResults = args.max_results || 5;
            const startIndex = args.startIndex || 0;

            // Set search parameters if provided
            if (args.search_query) {
                contactsService.parameters.searchText = args.search_query;
            }

            // Load sources and contacts
            await contactsService.ensureSourcesLoadedPromise();
            await contactsService.ensureContactsLoadedPromise();

            // Get filtered contacts
            const contacts = contactsService.getFilteredContacts();
            
            // Apply pagination
            const paginatedContacts = contacts.slice(startIndex, startIndex + maxResults);

            const mappedContacts = paginatedContacts.map(contact => ({  
                id: contact.id,
                name: contact.displayAs,
                email: contact.emailAddressList[0] || undefined,
                phone: contact.phoneNumberList[0]?.number || undefined,
                quick_notes: contact.additionalInfo || undefined,
                flagInfo: contact.flagInfo,
                categories: contact.categoriesString || undefined
            }));
            
            return { success: true, result: mappedContacts };
        }
    };

    //static OpenComposerWindow = {
    //    function: {
    //        name: "OpenComposerWindow",
    //        description: "Open the email composer window",
    //        parameters: {
    //            properties: {
    //                ai_prompt: {
    //                    type: "string",
    //                    description: "The prompt that will be given to the reasoning model to generate the email content once the window is opened"
    //                }
    //            }
    //        }
    //    },
    //    execute: async function(scope, args) {
    //        // Open composer window with AI prompt
    //        const composerWindow = window.open('/composer', 'composer', 'width=800,height=600');
    //        composerWindow.aiPrompt = args.ai_prompt;
    //        return { success: true, result: `Composer window opened` };
    //    }
    //};

    static NewOrUpdateNote = {
        function: {
            name: 'new_or_update_note',
            description: 'Create a new note or update an existing one',
            parameters: {
                properties: {
                    title: {
                        type: 'string',
                        description: 'The title of the note'
                    },
                    content: {
                        type: 'string', 
                        description: 'The content of the note'
                    },
                    note_id: {
                        type: 'string',
                        description: 'The id of the note to update (guid)'
                    },
                    color: {
                        type: 'string',
                        description: 'The color of the note (white, yellow, pink, green, blue)'
                    }
                },
                required: ['title', 'content']
            }
        },
        execute: async function(scope, args) {
            try {
                // First get the primary source
                const sourcesResult = await scope.$http.get("~/api/v1/notes/sources");
                const sources = sourcesResult.data.sharedLists;
                const primarySource = sources.find(s => s.isPrimary);
                
                if (!primarySource) {
                    throw new Error('No primary notes source found');
                }

                // Format note object according to API requirements
                const note = {
                    subject: args.title,
                    text: `<div>${args.content}</div>`, // Wrap content in div as expected by the API
                    color: args.color || 'white',
                    sourceOwner: primarySource.ownerUsername || "~",
                    sourceId: primarySource.itemID,
                    sourceName: primarySource.displayName,
                    sourcePermission: primarySource.access,
                    isVisible: primarySource.enabled
                };

                if (args.note_id) {
                    note.id = args.note_id;
                    // Update existing note
                    const params = JSON.stringify(note);
                    await scope.$http.post(`~/api/v1/notes/note-patch/${note.id}/${note.sourceId}/${note.sourceOwner}`, params);
                } else {
                    // Create new note
                    const params = JSON.stringify(note);
                    await scope.$http.post(`~/api/v1/notes/note-put/${note.sourceId}/${note.sourceOwner}/`, params);
                }

                return { success: true, result: `Note ${args.title} saved` };
            } catch (error) {
                scope.logError('Error saving note:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static NewOrUpdateContact = {
        function: {
            name: 'new_or_update_contact',
            description: 'Create a new contact or update an existing one',
            parameters: {
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the contact'
                    },
                    email: {
                        type: 'string',
                        description: 'The email address of the contact'
                    },
                    phone: {
                        type: 'string',
                        description: 'The phone number of the contact'
                    },
                    address: {
                        type: 'string',
                        description: 'The address of the contact'
                    },
                    quick_notes: {
                        type: 'string',
                        description: 'Quick notes about the contact'
                    },
                    contact_id: {
                        type: 'string',
                        description: 'The id of the contact to update (guid)'
                    }
                },
                required: ['name']
            }
        },
        execute: async function(scope, args) {
            const contactsService = scope.getService('coreDataContacts');
            
            // Load sources first
            await contactsService.ensureSourcesLoadedPromise();
            await contactsService.ensureContactsLoadedPromise();
            const sources = contactsService.getSources();
            
            // Find primary source
            const primarySource = sources.find(s => s.isPrimary);
            if (!primarySource) {
                throw new Error('No primary contacts source found');
            }

            const contact = {
                id: args.contact_id || null,
                displayAs: args.name,
                email: args.email,
                phoneNumberList: args.phone ? [{ number: args.phone }] : [],
                busStreet: args.address,
                additionalInfo: args.quick_notes,
                source: primarySource,
                sourceOwner: primarySource.ownerUsername,
                sourceId: primarySource.itemID
            };

            if (args.contact_id) {
                // Update existing contact
                await contactsService.editContact(contact);
            } else {
                // Create new contact
                await contactsService.addContact(contact);
            }

            return { success: true, result: `Contact ${args.name} saved` };
        }
    };

    static NewOrUpdateTask = {
        function: {
            name: 'new_or_update_task',
            description: 'Create a new task or update an existing one',
            parameters: {
                properties: {
                    task_id: {
                        type: 'string',
                        description: 'The id of the task to update (guid)'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the task'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the task'
                    },
                    percent_complete: {
                        type: 'number',
                        description: 'The percentage of the task that is complete (0-100)'
                    },
                    start: {
                        type: 'string',
                        description: 'The start date of the task (YYYY-MM-DD HH:mm)'
                    },
                    due: {
                        type: 'string',
                        description: 'The due date of the task (YYYY-MM-DD HH:mm)'
                    },
                    reminder: {
                        type: 'string',
                        description: 'The reminder date of the task (YYYY-MM-DD HH:mm)'
                    }
                },
                required: ['subject']
            }
        },
        execute: async function(scope, args) {
            const tasksService = scope.getService('coreDataTasks');

            await tasksService.ensureSourcesLoadedPromise();
            await tasksService.ensureTasksLoadedPromise();
            
            const sources = tasksService.getSources();
            
            // Find primary source
            const primarySource = sources.find(s => s.isPrimary);
            if (!primarySource) {
                throw new Error('No primary tasks source found');
            }

            if(args.due && !args.start) {
                args.start = moment().toDate();
            }


            const task = {
                id: args.task_id || null,
                description: args.description,
                subject: args.subject,
                percentComplete: args.percent_complete || 0,
                due: args.due ? moment(args.due).toDate() : null,
                start: args.start ? moment(args.start).toDate() : null,
                reminder: args.reminder ? moment(args.reminder).toDate() : null,
                sourceOwner: primarySource.owner,
                sourceId: primarySource.id,
                useDateTime: (args.start || args.due) ? true : false,
                reminderSet: args.reminder ? true : false
            };

            scope.logMessage('TASK', task, args.due, args.start);

            // Use saveTasks for both new and update
            await tasksService.saveTasks([task]);

            return { success: true, result: `Task ${args.subject} saved` };
        }
    };

    static NewOrUpdateCalendarEvent = {
        function: {
            name: 'new_or_update_calendar_event',
            description: 'Create a new calendar event or update an existing one',
            parameters: {
                properties: {
                    event_id: {
                        type: 'string',
                        description: 'The id of the event to update (if it exists)'
                    },
                    subject: {
                        type: 'string',
                        description: 'The title of the event'
                    },
                    start_time: {
                        type: 'string', 
                        description: 'The start time of the event (YYYY-MM-DDTHH:mm:ss)'
                    },
                    end_time: {
                        type: 'string',
                        description: 'The end time of the event (YYYY-MM-DDTHH:mm:ss)'
                    },
                    location: {
                        type: 'string',
                        description: 'The location of the event'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the event'
                    },
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to add/update the event to (default is primary calendar)'
                    }
                },
                required: ['subject', 'start_time', 'end_time']
            }
        },
        execute: async function(scope, args) {
            let responseContext = '';
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const calendars = await cs.getCalendars();
            let calendar = args.calendar_id ? calendars.find(x=> x.id == args.calendar_id) : calendars.find(x=> x.isPrimary);

            if (!calendar) {
                responseContext = `Calendar (${args.calendar_id}) not found, using primary calendar`;
                calendar = calendars.find(x=> x.isPrimary);
            }

            // Format the event object according to API requirements
            const event = {
                id: args.event_id || null,
                subject: args.subject,
                start: {
                    dt: moment(args.start_time).toISOString(),
                    tz: moment.tz.guess()
                },
                end: {
                    dt: moment(args.end_time).toISOString(), 
                    tz: moment.tz.guess()
                },
                location: args.location,
                description: args.description,
                calendarId: calendar.id,
                calendarOwner: calendar.owner || null
            };

            try {
                if (args.event_id) {
                    // Update existing event
                    await scope.$http.post(`~/api/v1/calendars/events/save/${calendar.owner}/${calendar.id}/${args.event_id}`, JSON.stringify(event));
                } else {
                    // Create new event
                    await scope.$http.post(`~/api/v1/calendars/events/save/${calendar.owner}/${calendar.id}/null`, JSON.stringify(event));
                }
                
                return { success: true, result: `Event ${args.subject} saved. ${responseContext}` };
            } catch (error) {
                scope.logError('Error saving event:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static SendMeetingInvite = {
        function: {
            name: 'send_meeting_invite',
            description: 'Send a meeting invite',
            parameters: {
                properties: {
                    to: {
                        type: 'string',
                        description: 'The email addresses to send the meeting invite to, separated by commas'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the meeting'
                    },
                    start_time: {
                        type: 'string',
                        description: 'The start time of the meeting'
                    },
                    end_time: {
                        type: 'string',
                        description: 'The end time of the meeting'
                    },
                    location: {
                        type: 'string',
                        description: 'The location of the meeting'
                    },
                    description: {
                        type: 'string',
                        description: 'The description of the meeting'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const calendarService = scope.getService('coreDataCalendar');
            const emailService = scope.getService('coreDataMail');

            // Create calendar event
            const event = {
                title: args.subject,
                start: moment(args.start_time).toDate(),
                end: moment(args.end_time).toDate(),
                location: args.location,
                description: args.description
            };

            // Add event to calendar
            await calendarService.addEvents([event]);

            // Send email invite
            const emailData = {
                to: args.to,
                subject: args.subject,
                body: `You are invited to: ${args.subject}\n\nWhen: ${args.start_time} - ${args.end_time}\nWhere: ${args.location}\n\n${args.description}`,
                isHtml: false
            };

            await emailService.sendEmail(emailData);
            return { success: true, result: `Meeting invite sent to ${args.to}` };
        }
    };

    static RemoveItems = {
        function: {
            name: 'remove_items',
            description: 'Remove items from the system',
            parameters: {
                properties: {
                    item_id: {
                        type: 'string',
                        description: "The id's of the items to remove, comma separated. (id/guid only)"
                    },
                    item_type: {
                        type: 'string',
                        description: 'The type of the item to remove - note, task, contact, event'
                    },
                    calendar_id: {
                        type: 'string',
                        description: 'The id of the calendar to remove the event from'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const ids = args.item_id.split(',').map(id => id.trim());
            const type = args.item_type.toLowerCase();
            const calendarId = args.calendar_id;
            const cs = scope.getService('coreDataCalendar');
            await cs.loadSources();
            const calendar = (await cs.getCalendars()).filter(x=> x.id == calendarId)[0];
            try{
                let service;
                switch(type) {
                    case 'note':
                        service = scope.getService('coreDataNotes');
                        await service.removeNotes(ids);
                        break;
                    case 'task':
                        service = scope.getService('coreDataTasks');
                        await service.removeTasks(ids);
                        break;
                    case 'contact':
                        // Get contacts service to find source info for the contacts
                        service = scope.getService('coreDataContacts');
                        await service.ensureSourcesLoadedPromise();
                        await service.ensureContactsLoadedPromise();
                        
                        // Find the contacts to get their source info
                        const contacts = ids.map(id => service.getContactById(id))
                            .filter(contact => contact && contact.sourceId !== "gal") // Filter out null contacts and GAL contacts
                            .map(contact => ({
                                sourceOwner: contact.sourceOwner,
                                sourceId: contact.sourceId,
                                id: contact.id
                            }));

                        if (contacts.length === 0) {
                            throw new Error('No valid contacts found to delete');
                        }

                        // Call delete-bulk API directly
                        await scope.$http.post('~/api/v1/contacts/delete-bulk', JSON.stringify(contacts));
                        break;
                    case 'event':
                        var deleteMetaData = [];
                        for(var i = 0; i < ids.length; i++){
                            deleteMetaData.push({ "owner": calendar.owner, "calendarId": calendar.id, "eventId": ids[i] });
                        }

                        scope.logMessage('DELETE METADATA', deleteMetaData);
                        const params = JSON.stringify(deleteMetaData);
                        var result = await scope.$http.post('~/api/v1/calendars/events/delete-bulk/', params);
                        scope.logMessage('DELETE RESULT', result);

                        await cs.removeCalendarEvents(ids);
                        break;
                    default:
                        throw new Error('Invalid item type');
                }
            }catch(e){
                scope.logError('Error removing items', e);
                return { success: false, error: e.message };
            }

            return { success: true, result: `Items removed` };
        }
    };

    static RemoveEmails = {
        function: {
            name: 'remove_emails',
            description: 'Remove emails from the system',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The id's of the emails to remove, comma separated."
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder to remove the emails from.'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const mailService = scope.getService('coreDataMail');
            const uids = args.uid.split(',').map(id => id.trim());

            const parameters = {
                'UID': uids,
                'folder': args.folder,
                'ownerEmailAddress': '',
                'moveToDeleted': true
            };

            await scope.$http.post("~/api/v1/mail/delete-messages", parameters);
            return { success: true, result: `Emails removed` };
        }
    };

    static MoveEmails = {
        function: {
            name: 'move_emails',
            description: 'Move emails to a different folder',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The uid's of the emails to move, comma separated (get uids with read_emails_fast tool)."
                    },
                    src_folder: {
                        type: 'string',
                        description: 'The folder the emails are in.'
                    },
                    dest_folder: {
                        type: 'string',
                        description: 'The folder to move the emails to.'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const coreMailService = scope.getService('coreDataMail');

            //uids need to not be strings
            const uids = args.uid.split(',').map(id => id.trim()).map(id => parseInt(id));

            //if src_folder is an integer, its a folder_id, fetch email folders and get the path
            if(typeof args.src_folder === 'number'){
                await coreMailService.loadMailTree();
                const folders = await coreMailService.getFolderList();
                const folder = folders.find(x => x.id == args.src_folder);
                args.src_folder = folder.path;
            }

            //if dest_folder is an integer, its a folder_id, fetch email folders and get the path
            if(typeof args.dest_folder === 'number'){
                await coreMailService.loadMailTree();
                const folders = await coreMailService.getFolderList();
                const folder = folders.find(x => x.id == args.dest_folder);
                args.dest_folder = folder.path;
            }


            const parameters = {
                'UID': uids,
                'folder': args.src_folder,
                'ownerEmailAddress': '',
                'destinationFolder': args.dest_folder,
                'destinationOwnerEmailAddress': ''
            };

            await scope.$http.post("~/api/v1/mail/move-messages", parameters);
            return { success: true, result: `Emails moved to ${args.dest_folder}` };
        }
    };

    static SetEmailProperties = {
        function: {
            name: 'set_email_properties',
            description: 'Mark emails as read/unread, flagged/unflagged, or add tags',
            parameters: {
                properties: {
                    uid: {
                        type: 'string',
                        description: "The id's of the emails to mark, comma separated."
                    },
                    folder: {
                        type: 'string',
                        description: 'The folder the emails are in.'
                    },
                    read: {
                        type: 'boolean',
                        description: 'Whether to mark the emails as read or unread'
                    },
                    flagged: {
                        type: 'boolean',
                        description: 'Whether to mark the emails as flagged or unflagged'
                    },
                    tags: {
                        type: 'string',
                        description: 'The tags to add to the emails, comma separated'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            const mailService = scope.getService('coreDataMail');
            const uids = args.uid.split(',').map(id => id.trim());

            const parameters = {
                'UID': uids,
                'folder': args.folder,
                'ownerEmailAddress': ''
            };

            if (args.read !== undefined) {
                parameters.markRead = args.read;
            }

            if (args.flagged !== undefined) {
                parameters.flagAction = {
                    type: args.flagged ? 'SetBasic' : 'Clear'
                };
            }

            if (args.tags) {
                parameters.categories = args.tags.split(',').map(tag => tag.trim());
            }

            await scope.$http.post("~/api/v1/mail/messages-patch", parameters);
            return { success: true, result: `Emails marked as ${args.read ? 'read' : 'unread'}, ${args.flagged ? 'flagged' : 'unflagged'}, and tagged with ${args.tags}` };
        }
    };

    static SendEmail = {
        function: {
            name: "send_email",
            description: "Send a simple email",
            parameters: {
                properties: {
                    to: {
                        type: 'string',
                        description: 'The email addresses to send the email to, separated by commas'
                    },
                    subject: {
                        type: 'string',
                        description: 'The subject of the email'
                    },
                    body: {
                        type: 'string',
                        description: 'The body of the email'
                    },
                    cc: {
                        type: 'string',
                        description: 'The email address to cc'
                    },
                    bcc: {
                        type: 'string',
                        description: 'The email address to bcc'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {

                var userInfo = scope.getUserInfo();

                const emailData = {
                    to: args.to,
                    subject: args.subject,
                    body: args.body,
                    cc: args.cc,
                    bcc: args.bcc,
                    isHtml: false
                };


                // Check if the to field is empty
                if(!emailData.to || emailData.to.length == 0 || emailData.to == 'undefined' || emailData.to == 'null'){
                    emailData.to = userInfo.emailAddress;
                }

                if(!emailData.subject || emailData.subject.length == 0 || emailData.subject == 'undefined' || emailData.subject == 'null'){
                    emailData.subject = 'No subject';
                }

                if(!emailData.body || emailData.body.length == 0 || emailData.body == 'undefined' || emailData.body == 'null'){
                    emailData.body = 'No body';
                }

                // Post directly to the mail API endpoint
                await scope.$http.post('~/api/v1/mail/message-put', {
                    to: emailData.to,
                    cc: emailData.cc || '',
                    bcc: emailData.bcc || '',
                    date: new Date(),
                    from: userInfo.emailAddress,
                    replyTo: userInfo.emailAddress,
                    subject: emailData.subject,
                    messageHTML: `<div>${emailData.body}</div>`,
                    priority: 1,
                    selectedFrom: `default:${userInfo.emailAddress}`
                });

                return { success: true, result: 'Email sent successfully' };
            } catch (error) {
                scope.logError('Error sending email:', error);
                return { success: false, error: error.message };
            }
        }
    };
} 

(window.sbaiTools ??= {}).SmarterMailTools = SmarterMailTools;



/***/ }),

/***/ "./src/tools/external/SmarterTrackPortalTools.js":
/*!*******************************************************!*\
  !*** ./src/tools/external/SmarterTrackPortalTools.js ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmarterTrackPortalTools: () => (/* binding */ SmarterTrackPortalTools)
/* harmony export */ });
class SmarterTrackPortalTools {
    static name = "SmarterTrackPortalTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('portal.smartertools.com');
    }

    static ReadCommunitySection = {
        function: {
            name: 'read_community_section',
            description: 'Read a section of the SmarterTrack community portal',
            parameters: {
                properties: {
                    section: {
                        type: 'string',
                        description: 'The section to read (recent, unread, votes, my_activity)'
                    }
                },
                required: ['section']
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint;
                switch(args.section.toLowerCase()) {
                    case 'recent':
                        endpoint = '/community/recent';
                        break;
                    case 'unread':
                        endpoint = '/community/unread';
                        break;
                    case 'votes':
                        endpoint = '/community/votes';
                        break;
                    case 'my_activity':
                        endpoint = '/community/my-activity';
                        break;
                    default:
                        throw new Error('Invalid section specified');
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading community section:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadCommunityPost = {
        function: {
            name: 'read_community_post',
            description: 'Read a specific community post',
            parameters: {
                properties: {
                    post_id: {
                        type: 'string',
                        description: 'The ID of the post to read'
                    }
                },
                required: ['post_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const response = await scope.$http.get(`/community/post/${args.post_id}`);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading community post:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadKnowledgeBase = {
        function: {
            name: 'read_kb',
            description: 'Search or browse the knowledge base',
            parameters: {
                properties: {
                    search_query: {
                        type: 'string',
                        description: 'Search query for the knowledge base'
                    },
                    category: {
                        type: 'string',
                        description: 'Category to browse'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = '/kb';
                if (args.search_query) {
                    endpoint = `/kb/search?q=${encodeURIComponent(args.search_query)}`;
                } else if (args.category) {
                    endpoint = `/kb/category/${encodeURIComponent(args.category)}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading knowledge base:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadTicketQueue = {
        function: {
            name: 'read_ticket_queue',
            description: 'Read tickets from a specific queue',
            parameters: {
                properties: {
                    queue_id: {
                        type: 'string',
                        description: 'The ID of the queue to read'
                    }
                },
                required: ['queue_id']
            }
        },
        execute: async function(scope, args) {
            try {
                const response = await scope.$http.get(`/tickets/queue/${args.queue_id}`);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading ticket queue:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static ReadAllTickets = {
        function: {
            name: 'read_all_tickets',
            description: 'Read all tickets with optional filtering',
            parameters: {
                properties: {
                    status: {
                        type: 'string',
                        description: 'Filter by ticket status (open, closed, etc.)'
                    },
                    priority: {
                        type: 'string',
                        description: 'Filter by priority (low, medium, high)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                let endpoint = '/tickets/all';
                const params = new URLSearchParams();
                
                if (args.status) params.append('status', args.status);
                if (args.priority) params.append('priority', args.priority);

                if (params.toString()) {
                    endpoint += `?${params.toString()}`;
                }

                const response = await scope.$http.get(endpoint);
                return { success: true, result: response.data };
            } catch (error) {
                scope.logError('Error reading all tickets:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['SmarterTrackPortalTools'] = SmarterTrackPortalTools;
} else {
    window.sbaiTools = {
        'SmarterTrackPortalTools': SmarterTrackPortalTools
    };
}

 

/***/ }),

/***/ "./src/tools/external/StackOverflowTools.js":
/*!**************************************************!*\
  !*** ./src/tools/external/StackOverflowTools.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   StackOverflowTools: () => (/* binding */ StackOverflowTools)
/* harmony export */ });
class StackOverflowTools {
    static name = "StackOverflowTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('stackoverflow.com');
    }

    static GetPageInfo = {
        function: {
            name: 'get_so_page_info',
            description: 'Get information about the current Stack Overflow page',
            parameters: {}
        },
        execute: async function(scope, args) {
            try {
                // Get page type and relevant information
                const url = window.location.href;
                const pageInfo = {
                    type: 'unknown',
                    data: {}
                };

                // Question page
                if (url.includes('/questions/')) {
                    pageInfo.type = 'question';
                    const questionEl = document.querySelector('.question');
                    if (questionEl) {
                        pageInfo.data = {
                            title: document.querySelector('#question-header h1')?.textContent?.trim(),
                            votes: questionEl.querySelector('.js-vote-count')?.textContent?.trim(),
                            views: document.querySelector('.js-view-count')?.textContent?.trim(),
                            tags: Array.from(questionEl.querySelectorAll('.post-tag')).map(tag => tag.textContent),
                            answers: Array.from(document.querySelectorAll('.answer')).map(answer => ({
                                votes: answer.querySelector('.js-vote-count')?.textContent?.trim(),
                                isAccepted: answer.classList.contains('accepted-answer'),
                                answerId: answer.getAttribute('data-answerid')
                            }))
                        };
                    }
                }
                // Search results page
                else if (url.includes('/search')) {
                    pageInfo.type = 'search';
                    pageInfo.data = {
                        query: new URLSearchParams(window.location.search).get('q'),
                        results: Array.from(document.querySelectorAll('.question-summary')).map(result => ({
                            title: result.querySelector('.question-hyperlink')?.textContent?.trim(),
                            url: result.querySelector('.question-hyperlink')?.href,
                            votes: result.querySelector('.vote-count-post')?.textContent?.trim(),
                            answers: result.querySelector('.status strong')?.textContent?.trim(),
                            tags: Array.from(result.querySelectorAll('.post-tag')).map(tag => tag.textContent)
                        }))
                    };
                }
                // Tag page
                else if (url.includes('/tags/')) {
                    pageInfo.type = 'tag';
                    pageInfo.data = {
                        tag: document.querySelector('.post-tag')?.textContent?.trim(),
                        description: document.querySelector('.tag-wiki')?.textContent?.trim(),
                        questionCount: document.querySelector('.fs-body3')?.textContent?.trim()
                    };
                }
                // User profile page
                else if (url.includes('/users/')) {
                    pageInfo.type = 'user';
                    pageInfo.data = {
                        name: document.querySelector('[itemprop="name"]')?.textContent?.trim(),
                        reputation: document.querySelector('.reputation')?.textContent?.trim(),
                        badges: {
                            gold: document.querySelector('.badge1')?.title,
                            silver: document.querySelector('.badge2')?.title,
                            bronze: document.querySelector('.badge3')?.title
                        }
                    };
                }
                // Home page
                else if (url === 'https://stackoverflow.com/' || url === 'https://stackoverflow.com') {
                    pageInfo.type = 'home';
                    pageInfo.data = {
                        questions: Array.from(document.querySelectorAll('.question-summary')).map(question => ({
                            title: question.querySelector('.question-hyperlink')?.textContent?.trim(),
                            url: question.querySelector('.question-hyperlink')?.href,
                            votes: question.querySelector('.vote-count-post')?.textContent?.trim(),
                            answers: question.querySelector('.status strong')?.textContent?.trim(),
                            tags: Array.from(question.querySelectorAll('.post-tag')).map(tag => tag.textContent)
                        }))
                    };
                }

                return { success: true, result: pageInfo };
            } catch (error) {
                scope.logError('Error getting Stack Overflow page info:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['StackOverflowTools'] = StackOverflowTools;
} else {
    window.sbaiTools = {
        'StackOverflowTools': StackOverflowTools
    };
}

 

/***/ }),

/***/ "./src/tools/external/TwitchTools.js":
/*!*******************************************!*\
  !*** ./src/tools/external/TwitchTools.js ***!
  \*******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TwitchTools: () => (/* binding */ TwitchTools)
/* harmony export */ });
class TwitchTools {
    static name = "TwitchTools";

    static _CarbonBarPageLoadFilter = (window) => {
        return window.location.hostname.includes('twitch.tv');
    }

    static ListLiveStreams = {
        function: {
            name: 'list_live_streams',
            description: 'List live streams based on category',
            parameters: {
                properties: {
                    category: {
                        type: 'string',
                        description: 'Category to list streams from (following, front_page, game)'
                    },
                    game_name: {
                        type: 'string',
                        description: 'Name of the game to list streams for (required if category is "game")'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of streams to return (default: 20)'
                    }
                },
                required: ['category']
            }
        },
        execute: async function(scope, args) {
            try {
                let streams = [];
                const limit = args.limit || 20;

                // Get the GQL client from window
                const gqlClient = window.__twilightBuildID;
                if (!gqlClient) {
                    throw new Error('Twitch GQL client not found');
                }

                switch(args.category.toLowerCase()) {
                    case 'following':
                        // Get followed streams
                        const followingResponse = await scope.$http.post('/gql', {
                            operationName: 'FollowedStreams',
                            variables: {
                                limit: limit
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        streams = followingResponse.data.data.followedStreams;
                        break;

                    case 'front_page':
                        // Get front page streams
                        const frontPageResponse = await scope.$http.post('/gql', {
                            operationName: 'BrowsePage_Popular',
                            variables: {
                                limit: limit
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        streams = frontPageResponse.data.data.streams;
                        break;

                    case 'game':
                        if (!args.game_name) {
                            throw new Error('game_name is required when category is "game"');
                        }
                        // First get game ID
                        const gameResponse = await scope.$http.post('/gql', {
                            operationName: 'GamePage',
                            variables: {
                                name: args.game_name
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        const gameId = gameResponse.data.data.game.id;
                        
                        // Then get streams for that game
                        const gameStreamsResponse = await scope.$http.post('/gql', {
                            operationName: 'GameStreams',
                            variables: {
                                gameId: gameId,
                                limit: limit
                            },
                            extensions: {
                                persistedQuery: {
                                    version: 1,
                                    sha256Hash: gqlClient
                                }
                            }
                        });
                        streams = gameStreamsResponse.data.data.streams;
                        break;

                    default:
                        throw new Error('Invalid category specified');
                }

                // Format the streams data
                const formattedStreams = streams.map(stream => ({
                    id: stream.id,
                    title: stream.title,
                    broadcaster: stream.broadcaster.displayName,
                    game: stream.game?.name,
                    viewers: stream.viewersCount,
                    thumbnailUrl: stream.previewImageURL,
                    url: `https://twitch.tv/${stream.broadcaster.login}`
                }));

                return { success: true, result: formattedStreams };
            } catch (error) {
                scope.logError('Error listing streams:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static OpenStream = {
        function: {
            name: 'open_stream',
            description: 'Open a Twitch stream',
            parameters: {
                properties: {
                    username: {
                        type: 'string',
                        description: 'Username/channel name of the streamer'
                    },
                    theater_mode: {
                        type: 'boolean',
                        description: 'Whether to open in theater mode (default: false)'
                    }
                },
                required: ['username']
            }
        },
        execute: async function(scope, args) {
            try {
                let url = `https://twitch.tv/${args.username}`;
                if (args.theater_mode) {
                    url += '?mode=theater';
                }

                // Open in current window if we're already on Twitch
                if (window.location.hostname.includes('twitch.tv')) {
                    window.location.href = url;
                } else {
                    // Open in new window otherwise
                    window.open(url, '_blank');
                }

                return { 
                    success: true, 
                    result: `Opened stream: ${args.username}${args.theater_mode ? ' in theater mode' : ''}`
                };
            } catch (error) {
                scope.logError('Error opening stream:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['TwitchTools'] = TwitchTools;
} else {
    window.sbaiTools = {
        'TwitchTools': TwitchTools
    };
}

 

/***/ }),

/***/ "./src/tools sync recursive \\.js$":
/*!*******************************!*\
  !*** ./src/tools/ sync \.js$ ***!
  \*******************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var map = {
	"./CarbonBarHelpTools.js": "./src/tools/CarbonBarHelpTools.js",
	"./GeneralTools.js": "./src/tools/GeneralTools.js",
	"./external/BitbucketTools.js": "./src/tools/external/BitbucketTools.js",
	"./external/HackerNewsTools.js": "./src/tools/external/HackerNewsTools.js",
	"./external/JiraTools.js": "./src/tools/external/JiraTools.js",
	"./external/RocketChatTools.js": "./src/tools/external/RocketChatTools.js",
	"./external/SmarterMailTools.js": "./src/tools/external/SmarterMailTools.js",
	"./external/SmarterTrackPortalTools.js": "./src/tools/external/SmarterTrackPortalTools.js",
	"./external/StackOverflowTools.js": "./src/tools/external/StackOverflowTools.js",
	"./external/TwitchTools.js": "./src/tools/external/TwitchTools.js"
};


function webpackContext(req) {
	var id = webpackContextResolve(req);
	return __webpack_require__(id);
}
function webpackContextResolve(req) {
	if(!__webpack_require__.o(map, req)) {
		var e = new Error("Cannot find module '" + req + "'");
		e.code = 'MODULE_NOT_FOUND';
		throw e;
	}
	return map[req];
}
webpackContext.keys = function webpackContextKeys() {
	return Object.keys(map);
};
webpackContext.resolve = webpackContextResolve;
module.exports = webpackContext;
webpackContext.id = "./src/tools sync recursive \\.js$";

/***/ }),

/***/ "./src/chrome-carbonbar-page/carbon-commander.css":
/*!********************************************************!*\
  !*** ./src/chrome-carbonbar-page/carbon-commander.css ***!
  \********************************************************/
/***/ ((module) => {

module.exports = ".cc-container {\n    all: initial;\n    display: block;\n    padding: 7px;\n    background-color: rebeccapurple;\n    border: 1px solid mediumorchid;\n    border-radius: 8px;\n    transition: all 0.5s ease-in-out;\n    box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7);\n    animation: gentlePulse 4s ease-in-out infinite;\n    color: white;\n    font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n    font-size: 14px;\n    line-height: 1.4;\n    box-sizing: border-box;\n}\n\n\n.cc-container.waiting-input {\n    animation: inputPulse 2s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.processing {\n    animation: processingPulse 1.5s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.has-error {\n    animation: errorPulse 1s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.tool-running {\n    animation: toolPulse 2s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.success {\n    animation: successPulse 3s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n.cc-container.rainbow {\n    animation: rainbowPulse 5s ease-in-out infinite;\n    animation-play-state: running;\n}\n\n/* Add a transition class for smoother state changes */\n.cc-container.transitioning {\n    animation-play-state: paused;\n}\n\n/* Animation keyframes with smoother transitions */\n@keyframes gentlePulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7); }\n}\n\n@keyframes inputPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(52, 152, 219, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(41, 128, 185, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(52, 152, 219, 0.7); }\n}\n\n@keyframes processingPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(142, 68, 173, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n}\n\n@keyframes errorPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(192, 57, 43, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n}\n\n@keyframes toolPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(39, 174, 96, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n}\n\n@keyframes successPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(39, 174, 96, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n}\n\n/* Update rainbow animation for smoother transitions */\n@keyframes rainbowPulse {\n    0% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n    16.66% { box-shadow: 0px 0px 15px 3px rgba(241, 196, 15, 0.7); }\n    33.33% { box-shadow: 0px 0px 15px 3px rgba(46, 204, 113, 0.7); }\n    50% { box-shadow: 0px 0px 15px 3px rgba(52, 152, 219, 0.7); }\n    66.66% { box-shadow: 0px 0px 15px 3px rgba(155, 89, 182, 0.7); }\n    83.33% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n    100% { box-shadow: 0px 0px 15px 3px rgba(231, 76, 60, 0.7); }\n}\n\n/* Dialog header */\n.cc-dialog-header {\n    display: flex;\n    align-items: center;\n    margin-bottom: 8px;\n}\n\n.cc-title {\n    font-weight: 500;\n    font-size: 16px;\n}\n\n/* Input styles */\n.cc-input-wrapper {\n    position: relative;\n    width: 100%;\n    display: flex;\n    flex-direction: column;\n}\n\n.cc-input {\n    width: auto;\n    padding: 8px 12px;\n    background-color: rgba(0, 0, 0, 0.2);\n    border: 1px solid mediumorchid;\n    border-radius: 4px;\n    font-size: 16px;\n    color: white;\n    outline: none;\n    z-index: 10;\n    position: relative;\n}\n\n.cc-input:focus {\n    border-color: #9b59b6;\n    box-shadow: 0 0 0 2px rgba(155, 89, 182, 0.3);\n    border-bottom-left-radius: 0;\n    border-bottom-right-radius: 0;\n}\n\n.cc-results {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n    max-height: 480px;\n    overflow-y: auto;\n    margin-bottom: 8px;\n    padding: 4px;\n    opacity: 1;\n    transition: opacity 0.3s ease-in-out;\n}\n\n.cc-results > *:first-child {\n    margin-top: 0;\n}\n\n.cc-results.hidden {\n    opacity: 0;\n}\n\n.cc-result-item > p {\n    margin: 0;\n}\n\n/* Smooth transition for user message appearance */\n.cc-user-message {\n    padding: 8px 12px;\n    margin: 8px 0;\n    background-color: slategray;\n    border-radius: 8px;\n    font-weight: 500;\n    opacity: 0;\n    transform: translateY(10px);\n    animation: messageAppear 0.3s ease-in-out forwards;\n}\n\n@keyframes messageAppear {\n    from {\n        opacity: 0;\n        transform: translateY(10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateY(0);\n    }\n}\n\n.cc-error {\n    padding: 4px;\n    margin: 0px;\n    background-color: firebrick;\n    color: white;\n    border-radius: 4px;\n}\n\n.cc-dialog {\n    margin: 10px 0;\n    padding: 10px;\n    background-color: dodgerblue;\n    border-radius: 8px;\n    min-width: 65%;\n    box-shadow: 0 2px 4px rgba(0,0,0,0.1);\n    display: inline-block;\n}\n\n.cc-dialog-content {\n    display: flex;\n    flex-direction: column;\n    gap: unset;\n}\n\n.cc-dialog-buttons {\n    display: flex;\n    gap: 8px;\n    justify-content: flex-end;\n}\n\n.cc-button {\n    padding: 6px 12px;\n    border: none;\n    border-radius: 4px;\n    cursor: pointer;\n    font-size: 14px;\n    transition: background-color 0.2s;\n}\n\n.cc-button.confirm {\n    background-color: #2ecc71;\n    color: white;\n}\n\n.cc-button.confirm:hover {\n    background-color: #27ae60;\n}\n\n.cc-button.cancel {\n    background-color: #e74c3c;\n    color: white;\n}\n\n.cc-button.cancel:hover {\n    background-color: #c0392b;\n}\n\n.cc-input-group {\n    margin: 2px 10px;\n}\n\n.cc-dialog-content > p {\n    margin: 4px;\n}\n\n.cc-input-group label {\n    display: block;\n    margin-bottom: 5px;\n    font-weight: 500;\n}\n\n.cc-dialog-input {\n    width: 90%;\n    padding: 8px;\n    border: 1px solid var(--border-color, #ddd);\n    border-radius: 4px;\n    margin-bottom: 10px;\n}\n\n.cc-tool-call {\n    margin: 2px 1px;\n    padding: 0;\n    width: fit-content;\n}\n\n.tool-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 8px;\n}\n\n.tool-name {\n    font-weight: bold;\n    color: #79c1ff;\n}\n\n.tool-status {\n    font-size: 0.9em;\n    padding: 4px 8px;\n    border-radius: 8px;\n    position: relative;\n    transition: background-color 0.3s ease-in-out;\n}\n\n.tool-status.pending {\n    background-color: #f39c12;\n    animation: pulse 2s infinite;\n}\n\n.tool-status.running {\n    background-color: #3498db;\n    animation: pulse 1.5s infinite;\n}\n\n.tool-status.completed {\n    background-color: #2ecc71;\n}\n\n.tool-status.error {\n    background-color: #e74c3c;\n}\n\n.tool-arguments {\n    font-family: monospace;\n    background-color: rgba(0, 0, 0, 0.2);\n    padding: 8px;\n    border-radius: 4px;\n    margin: 8px 0;\n    word-break: break-all;\n    position: relative;\n    transition: border-left-color 0.3s ease-in-out, background-color 0.3s ease-in-out;\n}\n\n/* Progress states for arguments */\n.tool-arguments.arg-started {\n    border-left: 3px solid #f39c12;\n}\n\n.tool-arguments.arg-property {\n    border-left: 3px solid #e67e22;\n}\n\n.tool-arguments.arg-value {\n    border-left: 3px solid #3498db;\n}\n\n.tool-arguments.arg-multiple {\n    border-left: 3px solid #9b59b6;\n}\n\n.tool-arguments.arg-complete {\n    border-left: 3px solid #2ecc71;\n    animation: completePulse 0.5s ease;\n}\n\n@keyframes completePulse {\n    0% {\n        background-color: rgba(46, 204, 113, 0.2);\n    }\n    50% {\n        background-color: rgba(46, 204, 113, 0.3);\n    }\n    100% {\n        background-color: rgba(0, 0, 0, 0.2);\n    }\n}\n\n/* Progress indicator dots */\n.tool-arguments::before {\n    content: '';\n    position: absolute;\n    right: 8px;\n    top: 50%;\n    transform: translateY(-50%);\n    width: 6px;\n    height: 6px;\n    border-radius: 50%;\n    animation: progressDot 1s infinite;\n}\n\n.tool-arguments.arg-started::before { background-color: #f39c12; }\n.tool-arguments.arg-property::before { background-color: #e67e22; }\n.tool-arguments.arg-value::before { background-color: #3498db; }\n.tool-arguments.arg-multiple::before { background-color: #9b59b6; }\n.tool-arguments.arg-complete::before { display: none; }\n\n@keyframes progressDot {\n    0%, 100% { opacity: 0.4; }\n    50% { opacity: 1; }\n}\n\n/* Typing cursor animation for arguments */\n.tool-arguments.typing::after {\n    content: '|';\n    position: absolute;\n    margin-left: 2px;\n    animation: blink 1s step-end infinite;\n}\n\n@keyframes blink {\n    0%, 100% { opacity: 1; }\n    50% { opacity: 0; }\n}\n\n/* Status indicator animations */\n@keyframes pulse {\n    0% {\n        box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4);\n    }\n    70% {\n        box-shadow: 0 0 0 6px rgba(255, 255, 255, 0);\n    }\n    100% {\n        box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);\n    }\n}\n\n.tool-description {\n    font-size: 0.9em;\n    color: #bdc3c7;\n    margin-bottom: 8px;\n}\n\n.tool-view-toggle {\n    align-self: flex-end;\n    border: none;\n    cursor: pointer;\n    font-size: 12px;\n}\n\n.tool-view-toggle:hover {\n    background: rgba(255, 255, 255, 0.2);\n}\n\n.tool-simple-container {\n    display: inline-flex;\n    flex-direction: column;\n    width: fit-content;\n    margin: 0px;\n    padding: 1px;\n    background-color: teal;\n    vertical-align: top;\n    user-select: none;\n    cursor: pointer;\n    transition: background-color 0.3s ease-in-out, border-color 0.3s ease-in-out;\n    border-radius: 8px;\n    border-width: 1px;\n    border-style: solid;\n    border-color: mediumorchid;\n}\n\n/* Status-based background colors */\n.tool-simple-container.pending {\n    background-color: #8e44ad; /* Purple for pending/constructing */\n}\n\n.tool-simple-container.running {\n    background-color: #2980b9; /* Blue for running */\n}\n\n.tool-simple-container.completed {\n    background-color: #27ae60; /* Green for completed */\n}\n\n.tool-simple-container.error {\n    background-color: #c0392b; /* Red for error */\n}\n\n.tool-simple-icon {\n    font-size: 24px;\n    padding: 0px 4px;\n    margin: 0;\n    border-radius: 8px;\n    background: rgba(255, 255, 255, 0.1);\n}\n\n.tool-simple-icon.running {\n    animation: pulse 1.5s infinite;\n}\n\n.tool-simple-icon.error {\n    margin-top: 0px;\n    font-size: 30px;\n}\n\n.tool-simple-content {\n    display: flex;\n    align-items: flex-start;\n    margin: 2px;\n}\n\n.tool-simple-info {\n    flex: 1;\n    margin-left: 4px;\n}\n\n.tool-simple-name {\n    font-weight: normal;\n    margin-bottom: 2px;\n}\n\n.tool-simple-progress {\n    position: relative;\n    height: 4px;\n    background: rgba(255, 255, 255, 0.1);\n    border-radius: 2px;\n    margin-top: 8px;\n}\n\n.cc-ai-output {\n    background-color: slateblue;\n    border-radius: 8px;\n    margin: 2px 0px;\n    padding: 8px 12px;\n    text-indent: 0px;\n} \n\n.cc-ai-output h1,\n.cc-ai-output h2,\n.cc-ai-output h3,\n.cc-ai-output h4,\n.cc-ai-output h5,\n.cc-ai-output h6 {\n    margin: 1em 0 0.5em;\n    line-height: 1.2;\n    font-weight: 600;\n}\n\n.cc-ai-output p {\n    margin: 0.5em 0;\n    line-height: 1.5;\n}\n\n.cc-ai-output ul,\n.cc-ai-output ol {\n    margin: 0.5em 0;\n    padding-left: 2em;\n}\n\n.cc-ai-output li {\n    margin: 0.3em 0;\n}\n\n.cc-ai-output code {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 0.2em 0.4em;\n    border-radius: 3px;\n    font-family: monospace;\n    font-size: 0.9em;\n}\n\n.cc-ai-output pre {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 1em;\n    border-radius: 4px;\n    overflow-x: auto;\n    margin: 0.5em 0;\n}\n\n.cc-ai-output pre code {\n    background: none;\n    padding: 0;\n    font-size: 0.9em;\n    color: inherit;\n}\n\n.cc-ai-output a {\n    color: #79c1ff;\n    text-decoration: none;\n}\n\n.cc-ai-output a:hover {\n    text-decoration: underline;\n}\n\n.cc-ai-output blockquote {\n    margin: 0.5em 0;\n    padding-left: 1em;\n    border-left: 3px solid rgba(255, 255, 255, 0.3);\n    color: rgba(255, 255, 255, 0.8);\n}\n\n.cc-ai-output table {\n    border-collapse: collapse;\n    margin: 0.5em 0;\n    width: 100%;\n}\n\n.cc-ai-output th,\n.cc-ai-output td {\n    border: 1px solid rgba(255, 255, 255, 0.2);\n    padding: 0.4em 0.8em;\n    text-align: left;\n}\n\n.cc-ai-output th {\n    background: rgba(0, 0, 0, 0.2);\n}\n\n.progress-bar {\n    position: absolute;\n    height: 100%;\n    background: #2ecc71;\n    background-color: #2ecc71;\n    border-radius: 2px;\n    transition: width 0.3s ease-out;\n}\n\n.progress-text {\n    position: absolute;\n    right: 0;\n    top: -20px;\n    font-size: 12px;\n    color: rgba(255, 255, 255, 0.7);\n}\n\n.tool-simple-complete {\n    display: flex;\n    align-items: center;\n    color: #2ecc71;\n}\n\n.checkmark {\n    margin-right: 8px;\n    font-size: 18px;\n}\n\n.tool-advanced-container {\n    background: rgba(255, 255, 255, 0.1);\n    border-radius: 8px;\n    margin: 0px;\n    padding: 6px;\n    width: fit-content;\n}\n\n.tool-parameters {\n    margin: 12px 0;\n    padding: 8px;\n    background: rgba(0, 0, 0, 0.2);\n    border-radius: 4px;\n}\n\n.tool-parameters h4 {\n    margin: 0 0 8px 0;\n    color: #79c1ff;\n    font-size: 14px;\n}\n\n.tool-params-table {\n    width: 100%;\n    border-collapse: collapse;\n    font-size: 13px;\n}\n\n.tool-params-table th,\n.tool-params-table td {\n    padding: 6px;\n    text-align: left;\n    border-bottom: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n.tool-params-table th {\n    color: #79c1ff;\n    font-weight: 500;\n}\n\n.tool-arguments-section {\n    margin: 12px 0;\n}\n\n.tool-arguments-section h4 {\n    margin: 0 0 8px 0;\n    color: #79c1ff;\n    font-size: 14px;\n}\n\n.tool-advanced-container {\n    min-width: 500px;\n}\n\n.tool-result-section {\n    margin: 12px 0;\n}\n\n.tool-result-section h4 {\n    margin: 0 0 8px 0;\n    color: #79c1ff;\n    font-size: 14px;\n}\n\n.tool-result-content {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 8px;\n    border-radius: 4px;\n    font-family: monospace;\n    white-space: pre-wrap;\n    word-break: break-word;\n    border-left: 3px solid #2ecc71;\n}\n\n.cc-autocomplete {\n    position: absolute;\n    top: calc(100% - 4px);\n    left: 0;\n    right: 0;\n    padding: 12px 8px 8px;\n    pointer-events: auto;\n    background: rebeccapurple;\n    border: 1px solid mediumorchid;\n    border-top: none;\n    border-bottom-left-radius: 8px;\n    border-bottom-right-radius: 8px;\n    margin-top: 0;\n    z-index: 9;\n    opacity: 1;\n    transition: opacity 0.2s ease-in-out;\n    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n}\n\n.cc-autocomplete:empty {\n    opacity: 0;\n    pointer-events: none;\n}\n\n.cc-suggestion-breadcrumbs {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 4px 0;\n    flex-wrap: wrap;\n}\n\n.cc-suggestion-breadcrumb {\n    background: rgba(255, 255, 255, 0.1);\n    padding: 4px 12px;\n    border-radius: 16px;\n    color: rgba(255, 255, 255, 0.9);\n    transition: all 0.2s ease-in-out;\n    cursor: pointer;\n    white-space: nowrap;\n    user-select: none;\n}\n\n.cc-suggestion-breadcrumb:hover {\n    background: rgba(255, 255, 255, 0.2);\n    color: white;\n    transform: translateY(-1px);\n}\n\n.cc-suggestion-breadcrumb.selected {\n    background: rgba(121, 193, 255, 0.2);\n    color: white;\n    box-shadow: 0 0 8px rgba(121, 193, 255, 0.2);\n    transform: translateY(-1px) scale(1.02);\n}\n\n.cc-suggestion-separator {\n    color: rgba(255, 255, 255, 0.3);\n    font-size: 18px;\n    user-select: none;\n}\n\n.cc-tool-count {\n    color: rgba(255, 255, 255, 0.9);\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 4px;\n    font-size: xx-small;\n    padding: 2px 6px;\n    width: max-content;\n    display: flex;\n    align-items: center;\n    cursor: pointer;\n    transition: background-color 0.2s ease;\n}\n\n.cc-tool-count::before {\n    content: '⚡';\n    margin-right: 4px;\n    font-size: 8px;\n}\n\n.cc-tool-list {\n    display: none;\n    position: absolute;\n    top: 100%;\n    right: 0;\n    width: 400px;\n    max-height: 500px;\n    background-color: rebeccapurple;\n    border: 1px solid mediumorchid;\n    border-radius: 8px;\n    margin-top: 8px;\n    padding: 12px;\n    overflow-y: auto;\n    z-index: 1000;\n    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n    animation: toolListFadeIn 0.2s ease-out;\n}\n\n.cc-tool-list.visible {\n    display: block;\n}\n\n.cc-tool-list-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 12px;\n    padding-bottom: 8px;\n    border-bottom: 1px solid rgba(255, 255, 255, 0.2);\n}\n\n.cc-tool-list-title {\n    font-size: 16px;\n    font-weight: 500;\n    color: white;\n}\n\n.cc-tool-list-close {\n    background: none;\n    border: none;\n    color: rgba(255, 255, 255, 0.7);\n    cursor: pointer;\n    font-size: 18px;\n    padding: 4px;\n    border-radius: 4px;\n    transition: background-color 0.2s ease;\n}\n\n.cc-tool-list-close:hover {\n    background-color: rgba(255, 255, 255, 0.1);\n    color: white;\n}\n\n.cc-tool-list-content {\n    display: flex;\n    flex-direction: column;\n    gap: 8px;\n}\n\n.cc-tool-item {\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 6px;\n    padding: 10px;\n    cursor: pointer;\n    transition: background-color 0.2s ease;\n}\n\n.cc-tool-item:hover {\n    background-color: rgba(0, 0, 0, 0.3);\n}\n\n.cc-tool-item-name {\n    font-weight: 500;\n    color: #79c1ff;\n    margin-bottom: 4px;\n}\n\n.cc-tool-item-description {\n    font-size: 13px;\n    color: rgba(255, 255, 255, 0.8);\n    line-height: 1.4;\n}\n\n@keyframes toolListFadeIn {\n    from {\n        opacity: 0;\n        transform: translateY(-10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateY(0);\n    }\n}\n\n/* Add a subtle arrow pointing to the tool count */\n.cc-tool-list::before {\n    content: '';\n    position: absolute;\n    top: -8px;\n    right: 20px;\n    width: 0;\n    height: 0;\n    border-left: 8px solid transparent;\n    border-right: 8px solid transparent;\n    border-bottom: 8px solid rebeccapurple;\n}\n\n.cc-no-provider {\n    padding: 16px;\n    color: #fff;\n    font-size: 14px;\n}\n\n.cc-no-provider h3 {\n    margin: 0 0 12px 0;\n    color: #ff9999;\n    font-size: 18px;\n}\n\n.cc-no-provider h4 {\n    color: #79c1ff;\n    margin: 16px 0 8px 0;\n}\n\n.cc-no-provider p {\n    margin: 8px 0;\n    line-height: 1.4;\n}\n\n.provider-section {\n    background: rgba(0, 0, 0, 0.2);\n    padding: 12px;\n    margin: 12px 0;\n    border-radius: 6px;\n    border-left: 3px solid #79c1ff;\n}\n\n.provider-section ul {\n    margin: 8px 0;\n    padding-left: 20px;\n}\n\n.provider-section li {\n    margin: 4px 0;\n}\n\n.provider-section code {\n    background: rgba(0, 0, 0, 0.3);\n    padding: 2px 6px;\n    border-radius: 4px;\n    font-family: monospace;\n    font-size: 12px;\n}\n\n.provider-status {\n    margin-top: 16px;\n    padding: 12px;\n    background: rgba(0, 0, 0, 0.2);\n    border-radius: 6px;\n}\n\n.status-indicator {\n    color: #ff9999;\n    font-weight: 500;\n    transition: color 0.3s ease-in-out;\n}\n\n.status-indicator.connected {\n    color: #2ecc71;\n}\n\n.cc-no-provider a {\n    color: #79c1ff;\n    text-decoration: none;\n}\n\n.cc-no-provider a:hover {\n    text-decoration: underline;\n}\n\n.cc-status-badges {\n    display: flex;\n    gap: 6px;\n    align-items: center;\n    margin: 0px 0px 4px;\n}\n\n.cc-provider-badge {\n    color: rgba(255, 255, 255, 0.9);\n    background-color: rgba(231, 76, 60, 0.7);\n    border-radius: 4px;\n    font-size: xx-small;\n    padding: 2px 6px;\n    transition: background-color 0.3s ease, opacity 0.3s ease;\n    display: flex;\n    align-items: center;\n    cursor: pointer;\n    opacity: 0.5;\n    user-select: none;\n}\n\n.cc-provider-badge:hover {\n    opacity: 0.8;\n}\n\n.cc-provider-badge::before {\n    content: '●';\n    margin-right: 4px;\n    font-size: 8px;\n    transition: color 0.3s ease;\n}\n\n.cc-provider-badge[data-status=\"connected\"] {\n    background-color: rgba(46, 204, 113, 0.7);\n    opacity: 1;\n}\n\n.cc-provider-badge[data-status=\"connected\"]:hover {\n    opacity: 0.8;\n}\n\n.cc-provider-badge[data-status=\"disabled\"] {\n    background-color: rgba(149, 165, 166, 0.7);\n    opacity: 0.6;\n    text-decoration: line-through;\n}\n\n.cc-provider-badge[data-status=\"disabled\"]:hover {\n    opacity: 0.8;\n    text-decoration: line-through;\n}\n\n.cc-model-download-progress {\n    margin: 8px 0;\n    padding: 8px;\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 8px;\n    transition: opacity 0.3s ease-out;\n}\n\n.cc-model-download-progress.fade-out {\n    opacity: 0;\n}\n\n.cc-download-item {\n    margin: 4px 0;\n    padding: 8px;\n    background-color: rgba(255, 255, 255, 0.1);\n    border-radius: 4px;\n    animation: slideIn 0.3s ease-out;\n}\n\n.cc-download-item[data-phase=\"manifest\"] {\n    border-left: 3px solid #3498db;\n}\n\n.cc-download-item[data-phase=\"download\"] {\n    border-left: 3px solid #f1c40f;\n}\n\n.cc-download-item[data-phase=\"verify\"] {\n    border-left: 3px solid #9b59b6;\n}\n\n.cc-download-item[data-phase=\"write\"] {\n    border-left: 3px solid #e67e22;\n}\n\n.cc-download-item[data-phase=\"cleanup\"] {\n    border-left: 3px solid #1abc9c;\n}\n\n.cc-download-item[data-phase=\"complete\"] {\n    border-left: 3px solid #2ecc71;\n}\n\n.download-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 8px;\n}\n\n.status-text {\n    font-weight: 500;\n    color: rgba(255, 255, 255, 0.9);\n}\n\n.progress-text {\n    font-size: 0.9em;\n    color: rgba(255, 255, 255, 0.7);\n}\n\n.progress-bar-container {\n    height: 4px;\n    background-color: rgba(0, 0, 0, 0.2);\n    border-radius: 2px;\n    overflow: hidden;\n}\n\n@keyframes slideIn {\n    from {\n        opacity: 0;\n        transform: translateY(-10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateY(0);\n    }\n}\n\n.cc-settings-icon {\n    cursor: pointer;\n    line-height: 10px;\n    position: relative;\n    font-size: 21px;\n    top: -2px;\n    margin-left: 8px;\n    border-radius: 4px;\n    transition: background-color 0.2sease;\n}\n\n.cc-settings-icon:hover {\n    background-color: rgba(255, 255, 255, 0.1);\n}\n\n/* Social Metadata Styles */\n.social-metadata-container {\n    background: rgba(0, 0, 0, 0.2);\n    border-radius: 8px;\n    padding: 16px;\n    margin: 8px 0;\n    font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n}\n\n.social-metadata-section {\n    background: rgba(255, 255, 255, 0.1);\n    border-radius: 6px;\n    padding: 12px;\n    margin: 8px 0;\n}\n\n.social-metadata-section h3 {\n    margin: 0 0 12px 0;\n    font-size: 16px;\n    color: #79c1ff;\n    font-weight: 500;\n}\n\n.metadata-content {\n    display: flex;\n    flex-direction: column;\n    gap: 8px;\n}\n\n.metadata-image {\n    margin: 8px 0;\n    border-radius: 6px;\n    overflow: hidden;\n    max-width: 100%;\n}\n\n.metadata-image img {\n    max-width: 100%;\n    height: auto;\n    display: block;\n}\n\n.metadata-title {\n    font-size: 18px;\n    font-weight: 500;\n    color: white;\n}\n\n.metadata-description {\n    color: rgba(255, 255, 255, 0.8);\n    font-size: 14px;\n    line-height: 1.4;\n}\n\n.metadata-author,\n.metadata-site,\n.metadata-creator,\n.metadata-type {\n    font-size: 13px;\n    color: rgba(255, 255, 255, 0.7);\n}\n\n.metadata-canonical a {\n    color: #79c1ff;\n    text-decoration: none;\n    font-size: 13px;\n}\n\n.metadata-canonical a:hover {\n    text-decoration: underline;\n}\n\n/* Platform-specific styling */\n.social-metadata-section.facebook {\n    border-left: 3px solid #1877f2;\n}\n\n.social-metadata-section.twitter {\n    border-left: 3px solid #1da1f2;\n}\n\n.social-metadata-section.linkedin {\n    border-left: 3px solid #0a66c2;\n}\n\n.social-links {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n}\n\n.social-link {\n    display: inline-flex;\n    align-items: center;\n    padding: 6px 12px;\n    background: rgba(255, 255, 255, 0.1);\n    border-radius: 4px;\n    color: white;\n    text-decoration: none;\n    font-size: 13px;\n    transition: background-color 0.2s ease;\n}\n\n.social-link:hover {\n    background: rgba(255, 255, 255, 0.2);\n}\n\n.social-link.facebook::before {\n    content: '📘';\n    margin-right: 6px;\n}\n\n.social-link.twitter::before {\n    content: '🐦';\n    margin-right: 6px;\n}\n\n.social-link.linkedin::before {\n    content: '💼';\n    margin-right: 6px;\n}\n\n.social-link.instagram::before {\n    content: '📸';\n    margin-right: 6px;\n}\n\n/* Responsive adjustments */\n@media (max-width: 480px) {\n    .social-metadata-container {\n        padding: 12px;\n    }\n\n    .metadata-title {\n        font-size: 16px;\n    }\n\n    .metadata-description {\n        font-size: 13px;\n    }\n}";

/***/ }),

/***/ "./node_modules/marked/lib/marked.esm.js":
/*!***********************************************!*\
  !*** ./node_modules/marked/lib/marked.esm.js ***!
  \***********************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Hooks: () => (/* binding */ _Hooks),
/* harmony export */   Lexer: () => (/* binding */ _Lexer),
/* harmony export */   Marked: () => (/* binding */ Marked),
/* harmony export */   Parser: () => (/* binding */ _Parser),
/* harmony export */   Renderer: () => (/* binding */ _Renderer),
/* harmony export */   TextRenderer: () => (/* binding */ _TextRenderer),
/* harmony export */   Tokenizer: () => (/* binding */ _Tokenizer),
/* harmony export */   defaults: () => (/* binding */ _defaults),
/* harmony export */   getDefaults: () => (/* binding */ _getDefaults),
/* harmony export */   lexer: () => (/* binding */ lexer),
/* harmony export */   marked: () => (/* binding */ marked),
/* harmony export */   options: () => (/* binding */ options),
/* harmony export */   parse: () => (/* binding */ parse),
/* harmony export */   parseInline: () => (/* binding */ parseInline),
/* harmony export */   parser: () => (/* binding */ parser),
/* harmony export */   setOptions: () => (/* binding */ setOptions),
/* harmony export */   use: () => (/* binding */ use),
/* harmony export */   walkTokens: () => (/* binding */ walkTokens)
/* harmony export */ });
/**
 * marked v15.0.6 - a markdown parser
 * Copyright (c) 2011-2025, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/markedjs/marked
 */

/**
 * DO NOT EDIT THIS FILE
 * The code in this file is generated from files in ./src/
 */

/**
 * Gets the original marked default options.
 */
function _getDefaults() {
    return {
        async: false,
        breaks: false,
        extensions: null,
        gfm: true,
        hooks: null,
        pedantic: false,
        renderer: null,
        silent: false,
        tokenizer: null,
        walkTokens: null,
    };
}
let _defaults = _getDefaults();
function changeDefaults(newDefaults) {
    _defaults = newDefaults;
}

const noopTest = { exec: () => null };
function edit(regex, opt = '') {
    let source = typeof regex === 'string' ? regex : regex.source;
    const obj = {
        replace: (name, val) => {
            let valSource = typeof val === 'string' ? val : val.source;
            valSource = valSource.replace(other.caret, '$1');
            source = source.replace(name, valSource);
            return obj;
        },
        getRegex: () => {
            return new RegExp(source, opt);
        },
    };
    return obj;
}
const other = {
    codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
    outputLinkReplace: /\\([\[\]])/g,
    indentCodeCompensation: /^(\s+)(?:```)/,
    beginningSpace: /^\s+/,
    endingHash: /#$/,
    startingSpaceChar: /^ /,
    endingSpaceChar: / $/,
    nonSpaceChar: /[^ ]/,
    newLineCharGlobal: /\n/g,
    tabCharGlobal: /\t/g,
    multipleSpaceGlobal: /\s+/g,
    blankLine: /^[ \t]*$/,
    doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
    blockquoteStart: /^ {0,3}>/,
    blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
    blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
    listReplaceTabs: /^\t+/,
    listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
    listIsTask: /^\[[ xX]\] /,
    listReplaceTask: /^\[[ xX]\] +/,
    anyLine: /\n.*\n/,
    hrefBrackets: /^<(.*)>$/,
    tableDelimiter: /[:|]/,
    tableAlignChars: /^\||\| *$/g,
    tableRowBlankLine: /\n[ \t]*$/,
    tableAlignRight: /^ *-+: *$/,
    tableAlignCenter: /^ *:-+: *$/,
    tableAlignLeft: /^ *:-+ *$/,
    startATag: /^<a /i,
    endATag: /^<\/a>/i,
    startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
    endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
    startAngleBracket: /^</,
    endAngleBracket: />$/,
    pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
    unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
    escapeTest: /[&<>"']/,
    escapeReplace: /[&<>"']/g,
    escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
    escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
    unescapeTest: /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,
    caret: /(^|[^\[])\^/g,
    percentDecode: /%25/g,
    findPipe: /\|/g,
    splitPipe: / \|/,
    slashPipe: /\\\|/g,
    carriageReturn: /\r\n|\r/g,
    spaceLine: /^ +$/gm,
    notSpaceStart: /^\S*/,
    endingNewline: /\n$/,
    listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`),
    nextBulletRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`),
    hrRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),
    fencesBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`),
    headingBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`),
    htmlBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}<(?:[a-z].*>|!--)`, 'i'),
};
/**
 * Block-Level Grammar
 */
const newline = /^(?:[ \t]*(?:\n|$))+/;
const blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
const hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const bullet = /(?:[*+-]|\d{1,9}[.)])/;
const lheading = edit(/^(?!bull |blockCode|fences|blockquote|heading|html)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html))+?)\n {0,3}(=+|-+) *(?:\n+|$)/)
    .replace(/bull/g, bullet) // lists can interrupt
    .replace(/blockCode/g, /(?: {4}| {0,3}\t)/) // indented code blocks can interrupt
    .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/) // fenced code blocks can interrupt
    .replace(/blockquote/g, / {0,3}>/) // blockquote can interrupt
    .replace(/heading/g, / {0,3}#{1,6}/) // ATX heading can interrupt
    .replace(/html/g, / {0,3}<[^\n>]+>\n/) // block html can interrupt
    .getRegex();
const _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
const blockText = /^[^\n]+/;
const _blockLabel = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
const def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
    .replace('label', _blockLabel)
    .replace('title', /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/)
    .getRegex();
const list = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/)
    .replace(/bull/g, bullet)
    .getRegex();
const _tag = 'address|article|aside|base|basefont|blockquote|body|caption'
    + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
    + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
    + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
    + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
    + '|tr|track|ul';
const _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const html = edit('^ {0,3}(?:' // optional indentation
    + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)' // (1)
    + '|comment[^\\n]*(\\n+|$)' // (2)
    + '|<\\?[\\s\\S]*?(?:\\?>\\n*|$)' // (3)
    + '|<![A-Z][\\s\\S]*?(?:>\\n*|$)' // (4)
    + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)' // (5)
    + '|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (6)
    + '|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) open tag
    + '|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) closing tag
    + ')', 'i')
    .replace('comment', _comment)
    .replace('tag', _tag)
    .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
    .getRegex();
const paragraph = edit(_paragraph)
    .replace('hr', hr)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
    .replace('|table', '')
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', _tag) // pars can be interrupted by type (6) html blocks
    .getRegex();
const blockquote = edit(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/)
    .replace('paragraph', paragraph)
    .getRegex();
/**
 * Normal Block Grammar
 */
const blockNormal = {
    blockquote,
    code: blockCode,
    def,
    fences,
    heading,
    hr,
    html,
    lheading,
    list,
    newline,
    paragraph,
    table: noopTest,
    text: blockText,
};
/**
 * GFM Block Grammar
 */
const gfmTable = edit('^ *([^\\n ].*)\\n' // Header
    + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)' // Align
    + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)') // Cells
    .replace('hr', hr)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('blockquote', ' {0,3}>')
    .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', _tag) // tables can be interrupted by type (6) html blocks
    .getRegex();
const blockGfm = {
    ...blockNormal,
    table: gfmTable,
    paragraph: edit(_paragraph)
        .replace('hr', hr)
        .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
        .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
        .replace('table', gfmTable) // interrupt paragraphs with table
        .replace('blockquote', ' {0,3}>')
        .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
        .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
        .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
        .replace('tag', _tag) // pars can be interrupted by type (6) html blocks
        .getRegex(),
};
/**
 * Pedantic grammar (original John Gruber's loose markdown specification)
 */
const blockPedantic = {
    ...blockNormal,
    html: edit('^ *(?:comment *(?:\\n|\\s*$)'
        + '|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)' // closed tag
        + '|<tag(?:"[^"]*"|\'[^\']*\'|\\s[^\'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))')
        .replace('comment', _comment)
        .replace(/tag/g, '(?!(?:'
        + 'a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub'
        + '|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)'
        + '\\b)\\w+(?!:|[^\\w\\s@]*@)\\b')
        .getRegex(),
    def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
    heading: /^(#{1,6})(.*)(?:\n+|$)/,
    fences: noopTest, // fences not supported
    lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
    paragraph: edit(_paragraph)
        .replace('hr', hr)
        .replace('heading', ' *#{1,6} *[^\n]')
        .replace('lheading', lheading)
        .replace('|table', '')
        .replace('blockquote', ' {0,3}>')
        .replace('|fences', '')
        .replace('|list', '')
        .replace('|html', '')
        .replace('|tag', '')
        .getRegex(),
};
/**
 * Inline-Level Grammar
 */
const escape$1 = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const br = /^( {2,}|\\)\n(?!\s*$)/;
const inlineText = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
// list of unicode punctuation marks, plus any missing characters from CommonMark spec
const _punctuation = /[\p{P}\p{S}]/u;
const _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;
const punctuation = edit(/^((?![*_])punctSpace)/, 'u')
    .replace(/punctSpace/g, _punctuationOrSpace).getRegex();
// GFM allows ~ inside strong and em for strikethrough
const _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
const _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;
// sequences em should skip over [title](link), `code`, <html>
const blockSkip = /\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g;
const emStrongLDelimCore = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/;
const emStrongLDelim = edit(emStrongLDelimCore, 'u')
    .replace(/punct/g, _punctuation)
    .getRegex();
const emStrongLDelimGfm = edit(emStrongLDelimCore, 'u')
    .replace(/punct/g, _punctuationGfmStrongEm)
    .getRegex();
const emStrongRDelimAstCore = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // Skip orphan inside strong
    + '|[^*]+(?=[^*])' // Consume to delim
    + '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1) #*** can only be a Right Delimiter
    + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2) a***#, a*** can only be a Right Delimiter
    + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3) #***a, ***a can only be Left Delimiter
    + '|[\\s](\\*+)(?!\\*)(?=punct)' // (4) ***# can only be Left Delimiter
    + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5) #***# can be either Left or Right Delimiter
    + '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6) a***a can be either Left or Right Delimiter
const emStrongRDelimAst = edit(emStrongRDelimAstCore, 'gu')
    .replace(/notPunctSpace/g, _notPunctuationOrSpace)
    .replace(/punctSpace/g, _punctuationOrSpace)
    .replace(/punct/g, _punctuation)
    .getRegex();
const emStrongRDelimAstGfm = edit(emStrongRDelimAstCore, 'gu')
    .replace(/notPunctSpace/g, _notPunctuationOrSpaceGfmStrongEm)
    .replace(/punctSpace/g, _punctuationOrSpaceGfmStrongEm)
    .replace(/punct/g, _punctuationGfmStrongEm)
    .getRegex();
// (6) Not allowed for _
const emStrongRDelimUnd = edit('^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)' // Skip orphan inside strong
    + '|[^_]+(?=[^_])' // Consume to delim
    + '|(?!_)punct(_+)(?=[\\s]|$)' // (1) #___ can only be a Right Delimiter
    + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' // (2) a___#, a___ can only be a Right Delimiter
    + '|(?!_)punctSpace(_+)(?=notPunctSpace)' // (3) #___a, ___a can only be Left Delimiter
    + '|[\\s](_+)(?!_)(?=punct)' // (4) ___# can only be Left Delimiter
    + '|(?!_)punct(_+)(?!_)(?=punct)', 'gu') // (5) #___# can be either Left or Right Delimiter
    .replace(/notPunctSpace/g, _notPunctuationOrSpace)
    .replace(/punctSpace/g, _punctuationOrSpace)
    .replace(/punct/g, _punctuation)
    .getRegex();
const anyPunctuation = edit(/\\(punct)/, 'gu')
    .replace(/punct/g, _punctuation)
    .getRegex();
const autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
    .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
    .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
    .getRegex();
const _inlineComment = edit(_comment).replace('(?:-->|$)', '-->').getRegex();
const tag = edit('^comment'
    + '|^</[a-zA-Z][\\w:-]*\\s*>' // self-closing tag
    + '|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>' // open tag
    + '|^<\\?[\\s\\S]*?\\?>' // processing instruction, e.g. <?php ?>
    + '|^<![a-zA-Z]+\\s[\\s\\S]*?>' // declaration, e.g. <!DOCTYPE html>
    + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>') // CDATA section
    .replace('comment', _inlineComment)
    .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
    .getRegex();
const _inlineLabel = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
const link = edit(/^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/)
    .replace('label', _inlineLabel)
    .replace('href', /<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/)
    .replace('title', /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/)
    .getRegex();
const reflink = edit(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', _inlineLabel)
    .replace('ref', _blockLabel)
    .getRegex();
const nolink = edit(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', _blockLabel)
    .getRegex();
const reflinkSearch = edit('reflink|nolink(?!\\()', 'g')
    .replace('reflink', reflink)
    .replace('nolink', nolink)
    .getRegex();
/**
 * Normal Inline Grammar
 */
const inlineNormal = {
    _backpedal: noopTest, // only used for GFM url
    anyPunctuation,
    autolink,
    blockSkip,
    br,
    code: inlineCode,
    del: noopTest,
    emStrongLDelim,
    emStrongRDelimAst,
    emStrongRDelimUnd,
    escape: escape$1,
    link,
    nolink,
    punctuation,
    reflink,
    reflinkSearch,
    tag,
    text: inlineText,
    url: noopTest,
};
/**
 * Pedantic Inline Grammar
 */
const inlinePedantic = {
    ...inlineNormal,
    link: edit(/^!?\[(label)\]\((.*?)\)/)
        .replace('label', _inlineLabel)
        .getRegex(),
    reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/)
        .replace('label', _inlineLabel)
        .getRegex(),
};
/**
 * GFM Inline Grammar
 */
const inlineGfm = {
    ...inlineNormal,
    emStrongRDelimAst: emStrongRDelimAstGfm,
    emStrongLDelim: emStrongLDelimGfm,
    url: edit(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/, 'i')
        .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/)
        .getRegex(),
    _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
    del: /^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,
    text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/,
};
/**
 * GFM + Line Breaks Inline Grammar
 */
const inlineBreaks = {
    ...inlineGfm,
    br: edit(br).replace('{2,}', '*').getRegex(),
    text: edit(inlineGfm.text)
        .replace('\\b_', '\\b_| {2,}\\n')
        .replace(/\{2,\}/g, '*')
        .getRegex(),
};
/**
 * exports
 */
const block = {
    normal: blockNormal,
    gfm: blockGfm,
    pedantic: blockPedantic,
};
const inline = {
    normal: inlineNormal,
    gfm: inlineGfm,
    breaks: inlineBreaks,
    pedantic: inlinePedantic,
};

/**
 * Helpers
 */
const escapeReplacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};
const getEscapeReplacement = (ch) => escapeReplacements[ch];
function escape(html, encode) {
    if (encode) {
        if (other.escapeTest.test(html)) {
            return html.replace(other.escapeReplace, getEscapeReplacement);
        }
    }
    else {
        if (other.escapeTestNoEncode.test(html)) {
            return html.replace(other.escapeReplaceNoEncode, getEscapeReplacement);
        }
    }
    return html;
}
function cleanUrl(href) {
    try {
        href = encodeURI(href).replace(other.percentDecode, '%');
    }
    catch {
        return null;
    }
    return href;
}
function splitCells(tableRow, count) {
    // ensure that every cell-delimiting pipe has a space
    // before it to distinguish it from an escaped pipe
    const row = tableRow.replace(other.findPipe, (match, offset, str) => {
        let escaped = false;
        let curr = offset;
        while (--curr >= 0 && str[curr] === '\\')
            escaped = !escaped;
        if (escaped) {
            // odd number of slashes means | is escaped
            // so we leave it alone
            return '|';
        }
        else {
            // add space before unescaped |
            return ' |';
        }
    }), cells = row.split(other.splitPipe);
    let i = 0;
    // First/last cell in a row cannot be empty if it has no leading/trailing pipe
    if (!cells[0].trim()) {
        cells.shift();
    }
    if (cells.length > 0 && !cells.at(-1)?.trim()) {
        cells.pop();
    }
    if (count) {
        if (cells.length > count) {
            cells.splice(count);
        }
        else {
            while (cells.length < count)
                cells.push('');
        }
    }
    for (; i < cells.length; i++) {
        // leading or trailing whitespace is ignored per the gfm spec
        cells[i] = cells[i].trim().replace(other.slashPipe, '|');
    }
    return cells;
}
/**
 * Remove trailing 'c's. Equivalent to str.replace(/c*$/, '').
 * /c*$/ is vulnerable to REDOS.
 *
 * @param str
 * @param c
 * @param invert Remove suffix of non-c chars instead. Default falsey.
 */
function rtrim(str, c, invert) {
    const l = str.length;
    if (l === 0) {
        return '';
    }
    // Length of suffix matching the invert condition.
    let suffLen = 0;
    // Step left until we fail to match the invert condition.
    while (suffLen < l) {
        const currChar = str.charAt(l - suffLen - 1);
        if (currChar === c && true) {
            suffLen++;
        }
        else {
            break;
        }
    }
    return str.slice(0, l - suffLen);
}
function findClosingBracket(str, b) {
    if (str.indexOf(b[1]) === -1) {
        return -1;
    }
    let level = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '\\') {
            i++;
        }
        else if (str[i] === b[0]) {
            level++;
        }
        else if (str[i] === b[1]) {
            level--;
            if (level < 0) {
                return i;
            }
        }
    }
    return -1;
}

function outputLink(cap, link, raw, lexer, rules) {
    const href = link.href;
    const title = link.title || null;
    const text = cap[1].replace(rules.other.outputLinkReplace, '$1');
    if (cap[0].charAt(0) !== '!') {
        lexer.state.inLink = true;
        const token = {
            type: 'link',
            raw,
            href,
            title,
            text,
            tokens: lexer.inlineTokens(text),
        };
        lexer.state.inLink = false;
        return token;
    }
    return {
        type: 'image',
        raw,
        href,
        title,
        text,
    };
}
function indentCodeCompensation(raw, text, rules) {
    const matchIndentToCode = raw.match(rules.other.indentCodeCompensation);
    if (matchIndentToCode === null) {
        return text;
    }
    const indentToCode = matchIndentToCode[1];
    return text
        .split('\n')
        .map(node => {
        const matchIndentInNode = node.match(rules.other.beginningSpace);
        if (matchIndentInNode === null) {
            return node;
        }
        const [indentInNode] = matchIndentInNode;
        if (indentInNode.length >= indentToCode.length) {
            return node.slice(indentToCode.length);
        }
        return node;
    })
        .join('\n');
}
/**
 * Tokenizer
 */
class _Tokenizer {
    options;
    rules; // set by the lexer
    lexer; // set by the lexer
    constructor(options) {
        this.options = options || _defaults;
    }
    space(src) {
        const cap = this.rules.block.newline.exec(src);
        if (cap && cap[0].length > 0) {
            return {
                type: 'space',
                raw: cap[0],
            };
        }
    }
    code(src) {
        const cap = this.rules.block.code.exec(src);
        if (cap) {
            const text = cap[0].replace(this.rules.other.codeRemoveIndent, '');
            return {
                type: 'code',
                raw: cap[0],
                codeBlockStyle: 'indented',
                text: !this.options.pedantic
                    ? rtrim(text, '\n')
                    : text,
            };
        }
    }
    fences(src) {
        const cap = this.rules.block.fences.exec(src);
        if (cap) {
            const raw = cap[0];
            const text = indentCodeCompensation(raw, cap[3] || '', this.rules);
            return {
                type: 'code',
                raw,
                lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, '$1') : cap[2],
                text,
            };
        }
    }
    heading(src) {
        const cap = this.rules.block.heading.exec(src);
        if (cap) {
            let text = cap[2].trim();
            // remove trailing #s
            if (this.rules.other.endingHash.test(text)) {
                const trimmed = rtrim(text, '#');
                if (this.options.pedantic) {
                    text = trimmed.trim();
                }
                else if (!trimmed || this.rules.other.endingSpaceChar.test(trimmed)) {
                    // CommonMark requires space before trailing #s
                    text = trimmed.trim();
                }
            }
            return {
                type: 'heading',
                raw: cap[0],
                depth: cap[1].length,
                text,
                tokens: this.lexer.inline(text),
            };
        }
    }
    hr(src) {
        const cap = this.rules.block.hr.exec(src);
        if (cap) {
            return {
                type: 'hr',
                raw: rtrim(cap[0], '\n'),
            };
        }
    }
    blockquote(src) {
        const cap = this.rules.block.blockquote.exec(src);
        if (cap) {
            let lines = rtrim(cap[0], '\n').split('\n');
            let raw = '';
            let text = '';
            const tokens = [];
            while (lines.length > 0) {
                let inBlockquote = false;
                const currentLines = [];
                let i;
                for (i = 0; i < lines.length; i++) {
                    // get lines up to a continuation
                    if (this.rules.other.blockquoteStart.test(lines[i])) {
                        currentLines.push(lines[i]);
                        inBlockquote = true;
                    }
                    else if (!inBlockquote) {
                        currentLines.push(lines[i]);
                    }
                    else {
                        break;
                    }
                }
                lines = lines.slice(i);
                const currentRaw = currentLines.join('\n');
                const currentText = currentRaw
                    // precede setext continuation with 4 spaces so it isn't a setext
                    .replace(this.rules.other.blockquoteSetextReplace, '\n    $1')
                    .replace(this.rules.other.blockquoteSetextReplace2, '');
                raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
                text = text ? `${text}\n${currentText}` : currentText;
                // parse blockquote lines as top level tokens
                // merge paragraphs if this is a continuation
                const top = this.lexer.state.top;
                this.lexer.state.top = true;
                this.lexer.blockTokens(currentText, tokens, true);
                this.lexer.state.top = top;
                // if there is no continuation then we are done
                if (lines.length === 0) {
                    break;
                }
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'code') {
                    // blockquote continuation cannot be preceded by a code block
                    break;
                }
                else if (lastToken?.type === 'blockquote') {
                    // include continuation in nested blockquote
                    const oldToken = lastToken;
                    const newText = oldToken.raw + '\n' + lines.join('\n');
                    const newToken = this.blockquote(newText);
                    tokens[tokens.length - 1] = newToken;
                    raw = raw.substring(0, raw.length - oldToken.raw.length) + newToken.raw;
                    text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
                    break;
                }
                else if (lastToken?.type === 'list') {
                    // include continuation in nested list
                    const oldToken = lastToken;
                    const newText = oldToken.raw + '\n' + lines.join('\n');
                    const newToken = this.list(newText);
                    tokens[tokens.length - 1] = newToken;
                    raw = raw.substring(0, raw.length - lastToken.raw.length) + newToken.raw;
                    text = text.substring(0, text.length - oldToken.raw.length) + newToken.raw;
                    lines = newText.substring(tokens.at(-1).raw.length).split('\n');
                    continue;
                }
            }
            return {
                type: 'blockquote',
                raw,
                tokens,
                text,
            };
        }
    }
    list(src) {
        let cap = this.rules.block.list.exec(src);
        if (cap) {
            let bull = cap[1].trim();
            const isordered = bull.length > 1;
            const list = {
                type: 'list',
                raw: '',
                ordered: isordered,
                start: isordered ? +bull.slice(0, -1) : '',
                loose: false,
                items: [],
            };
            bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
            if (this.options.pedantic) {
                bull = isordered ? bull : '[*+-]';
            }
            // Get next list item
            const itemRegex = this.rules.other.listItemRegex(bull);
            let endsWithBlankLine = false;
            // Check if current bullet point can start a new List Item
            while (src) {
                let endEarly = false;
                let raw = '';
                let itemContents = '';
                if (!(cap = itemRegex.exec(src))) {
                    break;
                }
                if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
                    break;
                }
                raw = cap[0];
                src = src.substring(raw.length);
                let line = cap[2].split('\n', 1)[0].replace(this.rules.other.listReplaceTabs, (t) => ' '.repeat(3 * t.length));
                let nextLine = src.split('\n', 1)[0];
                let blankLine = !line.trim();
                let indent = 0;
                if (this.options.pedantic) {
                    indent = 2;
                    itemContents = line.trimStart();
                }
                else if (blankLine) {
                    indent = cap[1].length + 1;
                }
                else {
                    indent = cap[2].search(this.rules.other.nonSpaceChar); // Find first non-space char
                    indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
                    itemContents = line.slice(indent);
                    indent += cap[1].length;
                }
                if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
                    raw += nextLine + '\n';
                    src = src.substring(nextLine.length + 1);
                    endEarly = true;
                }
                if (!endEarly) {
                    const nextBulletRegex = this.rules.other.nextBulletRegex(indent);
                    const hrRegex = this.rules.other.hrRegex(indent);
                    const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent);
                    const headingBeginRegex = this.rules.other.headingBeginRegex(indent);
                    const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent);
                    // Check if following lines should be included in List Item
                    while (src) {
                        const rawLine = src.split('\n', 1)[0];
                        let nextLineWithoutTabs;
                        nextLine = rawLine;
                        // Re-align to follow commonmark nesting rules
                        if (this.options.pedantic) {
                            nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ');
                            nextLineWithoutTabs = nextLine;
                        }
                        else {
                            nextLineWithoutTabs = nextLine.replace(this.rules.other.tabCharGlobal, '    ');
                        }
                        // End list item if found code fences
                        if (fencesBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of new heading
                        if (headingBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of html block
                        if (htmlBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of new bullet
                        if (nextBulletRegex.test(nextLine)) {
                            break;
                        }
                        // Horizontal rule found
                        if (hrRegex.test(nextLine)) {
                            break;
                        }
                        if (nextLineWithoutTabs.search(this.rules.other.nonSpaceChar) >= indent || !nextLine.trim()) { // Dedent if possible
                            itemContents += '\n' + nextLineWithoutTabs.slice(indent);
                        }
                        else {
                            // not enough indentation
                            if (blankLine) {
                                break;
                            }
                            // paragraph continuation unless last line was a different block level element
                            if (line.replace(this.rules.other.tabCharGlobal, '    ').search(this.rules.other.nonSpaceChar) >= 4) { // indented code block
                                break;
                            }
                            if (fencesBeginRegex.test(line)) {
                                break;
                            }
                            if (headingBeginRegex.test(line)) {
                                break;
                            }
                            if (hrRegex.test(line)) {
                                break;
                            }
                            itemContents += '\n' + nextLine;
                        }
                        if (!blankLine && !nextLine.trim()) { // Check if current line is blank
                            blankLine = true;
                        }
                        raw += rawLine + '\n';
                        src = src.substring(rawLine.length + 1);
                        line = nextLineWithoutTabs.slice(indent);
                    }
                }
                if (!list.loose) {
                    // If the previous item ended with a blank line, the list is loose
                    if (endsWithBlankLine) {
                        list.loose = true;
                    }
                    else if (this.rules.other.doubleBlankLine.test(raw)) {
                        endsWithBlankLine = true;
                    }
                }
                let istask = null;
                let ischecked;
                // Check for task list items
                if (this.options.gfm) {
                    istask = this.rules.other.listIsTask.exec(itemContents);
                    if (istask) {
                        ischecked = istask[0] !== '[ ] ';
                        itemContents = itemContents.replace(this.rules.other.listReplaceTask, '');
                    }
                }
                list.items.push({
                    type: 'list_item',
                    raw,
                    task: !!istask,
                    checked: ischecked,
                    loose: false,
                    text: itemContents,
                    tokens: [],
                });
                list.raw += raw;
            }
            // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
            const lastItem = list.items.at(-1);
            if (lastItem) {
                lastItem.raw = lastItem.raw.trimEnd();
                lastItem.text = lastItem.text.trimEnd();
            }
            else {
                // not a list since there were no items
                return;
            }
            list.raw = list.raw.trimEnd();
            // Item child tokens handled here at end because we needed to have the final item to trim it first
            for (let i = 0; i < list.items.length; i++) {
                this.lexer.state.top = false;
                list.items[i].tokens = this.lexer.blockTokens(list.items[i].text, []);
                if (!list.loose) {
                    // Check if list should be loose
                    const spacers = list.items[i].tokens.filter(t => t.type === 'space');
                    const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => this.rules.other.anyLine.test(t.raw));
                    list.loose = hasMultipleLineBreaks;
                }
            }
            // Set all items to loose if list is loose
            if (list.loose) {
                for (let i = 0; i < list.items.length; i++) {
                    list.items[i].loose = true;
                }
            }
            return list;
        }
    }
    html(src) {
        const cap = this.rules.block.html.exec(src);
        if (cap) {
            const token = {
                type: 'html',
                block: true,
                raw: cap[0],
                pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
                text: cap[0],
            };
            return token;
        }
    }
    def(src) {
        const cap = this.rules.block.def.exec(src);
        if (cap) {
            const tag = cap[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, ' ');
            const href = cap[2] ? cap[2].replace(this.rules.other.hrefBrackets, '$1').replace(this.rules.inline.anyPunctuation, '$1') : '';
            const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, '$1') : cap[3];
            return {
                type: 'def',
                tag,
                raw: cap[0],
                href,
                title,
            };
        }
    }
    table(src) {
        const cap = this.rules.block.table.exec(src);
        if (!cap) {
            return;
        }
        if (!this.rules.other.tableDelimiter.test(cap[2])) {
            // delimiter row must have a pipe (|) or colon (:) otherwise it is a setext heading
            return;
        }
        const headers = splitCells(cap[1]);
        const aligns = cap[2].replace(this.rules.other.tableAlignChars, '').split('|');
        const rows = cap[3]?.trim() ? cap[3].replace(this.rules.other.tableRowBlankLine, '').split('\n') : [];
        const item = {
            type: 'table',
            raw: cap[0],
            header: [],
            align: [],
            rows: [],
        };
        if (headers.length !== aligns.length) {
            // header and align columns must be equal, rows can be different.
            return;
        }
        for (const align of aligns) {
            if (this.rules.other.tableAlignRight.test(align)) {
                item.align.push('right');
            }
            else if (this.rules.other.tableAlignCenter.test(align)) {
                item.align.push('center');
            }
            else if (this.rules.other.tableAlignLeft.test(align)) {
                item.align.push('left');
            }
            else {
                item.align.push(null);
            }
        }
        for (let i = 0; i < headers.length; i++) {
            item.header.push({
                text: headers[i],
                tokens: this.lexer.inline(headers[i]),
                header: true,
                align: item.align[i],
            });
        }
        for (const row of rows) {
            item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
                return {
                    text: cell,
                    tokens: this.lexer.inline(cell),
                    header: false,
                    align: item.align[i],
                };
            }));
        }
        return item;
    }
    lheading(src) {
        const cap = this.rules.block.lheading.exec(src);
        if (cap) {
            return {
                type: 'heading',
                raw: cap[0],
                depth: cap[2].charAt(0) === '=' ? 1 : 2,
                text: cap[1],
                tokens: this.lexer.inline(cap[1]),
            };
        }
    }
    paragraph(src) {
        const cap = this.rules.block.paragraph.exec(src);
        if (cap) {
            const text = cap[1].charAt(cap[1].length - 1) === '\n'
                ? cap[1].slice(0, -1)
                : cap[1];
            return {
                type: 'paragraph',
                raw: cap[0],
                text,
                tokens: this.lexer.inline(text),
            };
        }
    }
    text(src) {
        const cap = this.rules.block.text.exec(src);
        if (cap) {
            return {
                type: 'text',
                raw: cap[0],
                text: cap[0],
                tokens: this.lexer.inline(cap[0]),
            };
        }
    }
    escape(src) {
        const cap = this.rules.inline.escape.exec(src);
        if (cap) {
            return {
                type: 'escape',
                raw: cap[0],
                text: cap[1],
            };
        }
    }
    tag(src) {
        const cap = this.rules.inline.tag.exec(src);
        if (cap) {
            if (!this.lexer.state.inLink && this.rules.other.startATag.test(cap[0])) {
                this.lexer.state.inLink = true;
            }
            else if (this.lexer.state.inLink && this.rules.other.endATag.test(cap[0])) {
                this.lexer.state.inLink = false;
            }
            if (!this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(cap[0])) {
                this.lexer.state.inRawBlock = true;
            }
            else if (this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(cap[0])) {
                this.lexer.state.inRawBlock = false;
            }
            return {
                type: 'html',
                raw: cap[0],
                inLink: this.lexer.state.inLink,
                inRawBlock: this.lexer.state.inRawBlock,
                block: false,
                text: cap[0],
            };
        }
    }
    link(src) {
        const cap = this.rules.inline.link.exec(src);
        if (cap) {
            const trimmedUrl = cap[2].trim();
            if (!this.options.pedantic && this.rules.other.startAngleBracket.test(trimmedUrl)) {
                // commonmark requires matching angle brackets
                if (!(this.rules.other.endAngleBracket.test(trimmedUrl))) {
                    return;
                }
                // ending angle bracket cannot be escaped
                const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
                if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
                    return;
                }
            }
            else {
                // find closing parenthesis
                const lastParenIndex = findClosingBracket(cap[2], '()');
                if (lastParenIndex > -1) {
                    const start = cap[0].indexOf('!') === 0 ? 5 : 4;
                    const linkLen = start + cap[1].length + lastParenIndex;
                    cap[2] = cap[2].substring(0, lastParenIndex);
                    cap[0] = cap[0].substring(0, linkLen).trim();
                    cap[3] = '';
                }
            }
            let href = cap[2];
            let title = '';
            if (this.options.pedantic) {
                // split pedantic href and title
                const link = this.rules.other.pedanticHrefTitle.exec(href);
                if (link) {
                    href = link[1];
                    title = link[3];
                }
            }
            else {
                title = cap[3] ? cap[3].slice(1, -1) : '';
            }
            href = href.trim();
            if (this.rules.other.startAngleBracket.test(href)) {
                if (this.options.pedantic && !(this.rules.other.endAngleBracket.test(trimmedUrl))) {
                    // pedantic allows starting angle bracket without ending angle bracket
                    href = href.slice(1);
                }
                else {
                    href = href.slice(1, -1);
                }
            }
            return outputLink(cap, {
                href: href ? href.replace(this.rules.inline.anyPunctuation, '$1') : href,
                title: title ? title.replace(this.rules.inline.anyPunctuation, '$1') : title,
            }, cap[0], this.lexer, this.rules);
        }
    }
    reflink(src, links) {
        let cap;
        if ((cap = this.rules.inline.reflink.exec(src))
            || (cap = this.rules.inline.nolink.exec(src))) {
            const linkString = (cap[2] || cap[1]).replace(this.rules.other.multipleSpaceGlobal, ' ');
            const link = links[linkString.toLowerCase()];
            if (!link) {
                const text = cap[0].charAt(0);
                return {
                    type: 'text',
                    raw: text,
                    text,
                };
            }
            return outputLink(cap, link, cap[0], this.lexer, this.rules);
        }
    }
    emStrong(src, maskedSrc, prevChar = '') {
        let match = this.rules.inline.emStrongLDelim.exec(src);
        if (!match)
            return;
        // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
        if (match[3] && prevChar.match(this.rules.other.unicodeAlphaNumeric))
            return;
        const nextChar = match[1] || match[2] || '';
        if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
            // unicode Regex counts emoji as 1 char; spread into array for proper count (used multiple times below)
            const lLength = [...match[0]].length - 1;
            let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
            const endReg = match[0][0] === '*' ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
            endReg.lastIndex = 0;
            // Clip maskedSrc to same section of string as src (move to lexer?)
            maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
            while ((match = endReg.exec(maskedSrc)) != null) {
                rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
                if (!rDelim)
                    continue; // skip single * in __abc*abc__
                rLength = [...rDelim].length;
                if (match[3] || match[4]) { // found another Left Delim
                    delimTotal += rLength;
                    continue;
                }
                else if (match[5] || match[6]) { // either Left or Right Delim
                    if (lLength % 3 && !((lLength + rLength) % 3)) {
                        midDelimTotal += rLength;
                        continue; // CommonMark Emphasis Rules 9-10
                    }
                }
                delimTotal -= rLength;
                if (delimTotal > 0)
                    continue; // Haven't found enough closing delimiters
                // Remove extra characters. *a*** -> *a*
                rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
                // char length can be >1 for unicode characters;
                const lastCharLength = [...match[0]][0].length;
                const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
                // Create `em` if smallest delimiter has odd char count. *a***
                if (Math.min(lLength, rLength) % 2) {
                    const text = raw.slice(1, -1);
                    return {
                        type: 'em',
                        raw,
                        text,
                        tokens: this.lexer.inlineTokens(text),
                    };
                }
                // Create 'strong' if smallest delimiter has even char count. **a***
                const text = raw.slice(2, -2);
                return {
                    type: 'strong',
                    raw,
                    text,
                    tokens: this.lexer.inlineTokens(text),
                };
            }
        }
    }
    codespan(src) {
        const cap = this.rules.inline.code.exec(src);
        if (cap) {
            let text = cap[2].replace(this.rules.other.newLineCharGlobal, ' ');
            const hasNonSpaceChars = this.rules.other.nonSpaceChar.test(text);
            const hasSpaceCharsOnBothEnds = this.rules.other.startingSpaceChar.test(text) && this.rules.other.endingSpaceChar.test(text);
            if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
                text = text.substring(1, text.length - 1);
            }
            return {
                type: 'codespan',
                raw: cap[0],
                text,
            };
        }
    }
    br(src) {
        const cap = this.rules.inline.br.exec(src);
        if (cap) {
            return {
                type: 'br',
                raw: cap[0],
            };
        }
    }
    del(src) {
        const cap = this.rules.inline.del.exec(src);
        if (cap) {
            return {
                type: 'del',
                raw: cap[0],
                text: cap[2],
                tokens: this.lexer.inlineTokens(cap[2]),
            };
        }
    }
    autolink(src) {
        const cap = this.rules.inline.autolink.exec(src);
        if (cap) {
            let text, href;
            if (cap[2] === '@') {
                text = cap[1];
                href = 'mailto:' + text;
            }
            else {
                text = cap[1];
                href = text;
            }
            return {
                type: 'link',
                raw: cap[0],
                text,
                href,
                tokens: [
                    {
                        type: 'text',
                        raw: text,
                        text,
                    },
                ],
            };
        }
    }
    url(src) {
        let cap;
        if (cap = this.rules.inline.url.exec(src)) {
            let text, href;
            if (cap[2] === '@') {
                text = cap[0];
                href = 'mailto:' + text;
            }
            else {
                // do extended autolink path validation
                let prevCapZero;
                do {
                    prevCapZero = cap[0];
                    cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? '';
                } while (prevCapZero !== cap[0]);
                text = cap[0];
                if (cap[1] === 'www.') {
                    href = 'http://' + cap[0];
                }
                else {
                    href = cap[0];
                }
            }
            return {
                type: 'link',
                raw: cap[0],
                text,
                href,
                tokens: [
                    {
                        type: 'text',
                        raw: text,
                        text,
                    },
                ],
            };
        }
    }
    inlineText(src) {
        const cap = this.rules.inline.text.exec(src);
        if (cap) {
            const escaped = this.lexer.state.inRawBlock;
            return {
                type: 'text',
                raw: cap[0],
                text: cap[0],
                escaped,
            };
        }
    }
}

/**
 * Block Lexer
 */
class _Lexer {
    tokens;
    options;
    state;
    tokenizer;
    inlineQueue;
    constructor(options) {
        // TokenList cannot be created in one go
        this.tokens = [];
        this.tokens.links = Object.create(null);
        this.options = options || _defaults;
        this.options.tokenizer = this.options.tokenizer || new _Tokenizer();
        this.tokenizer = this.options.tokenizer;
        this.tokenizer.options = this.options;
        this.tokenizer.lexer = this;
        this.inlineQueue = [];
        this.state = {
            inLink: false,
            inRawBlock: false,
            top: true,
        };
        const rules = {
            other,
            block: block.normal,
            inline: inline.normal,
        };
        if (this.options.pedantic) {
            rules.block = block.pedantic;
            rules.inline = inline.pedantic;
        }
        else if (this.options.gfm) {
            rules.block = block.gfm;
            if (this.options.breaks) {
                rules.inline = inline.breaks;
            }
            else {
                rules.inline = inline.gfm;
            }
        }
        this.tokenizer.rules = rules;
    }
    /**
     * Expose Rules
     */
    static get rules() {
        return {
            block,
            inline,
        };
    }
    /**
     * Static Lex Method
     */
    static lex(src, options) {
        const lexer = new _Lexer(options);
        return lexer.lex(src);
    }
    /**
     * Static Lex Inline Method
     */
    static lexInline(src, options) {
        const lexer = new _Lexer(options);
        return lexer.inlineTokens(src);
    }
    /**
     * Preprocessing
     */
    lex(src) {
        src = src.replace(other.carriageReturn, '\n');
        this.blockTokens(src, this.tokens);
        for (let i = 0; i < this.inlineQueue.length; i++) {
            const next = this.inlineQueue[i];
            this.inlineTokens(next.src, next.tokens);
        }
        this.inlineQueue = [];
        return this.tokens;
    }
    blockTokens(src, tokens = [], lastParagraphClipped = false) {
        if (this.options.pedantic) {
            src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
        }
        while (src) {
            let token;
            if (this.options.extensions?.block?.some((extTokenizer) => {
                if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
                    src = src.substring(token.raw.length);
                    tokens.push(token);
                    return true;
                }
                return false;
            })) {
                continue;
            }
            // newline
            if (token = this.tokenizer.space(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (token.raw.length === 1 && lastToken !== undefined) {
                    // if there's a single \n as a spacer, it's terminating the last line,
                    // so move it there so that we don't get unnecessary paragraph tags
                    lastToken.raw += '\n';
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // code
            if (token = this.tokenizer.code(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                // An indented code block cannot interrupt a paragraph.
                if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // fences
            if (token = this.tokenizer.fences(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // heading
            if (token = this.tokenizer.heading(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // hr
            if (token = this.tokenizer.hr(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // blockquote
            if (token = this.tokenizer.blockquote(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // list
            if (token = this.tokenizer.list(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // html
            if (token = this.tokenizer.html(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // def
            if (token = this.tokenizer.def(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.raw;
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else if (!this.tokens.links[token.tag]) {
                    this.tokens.links[token.tag] = {
                        href: token.href,
                        title: token.title,
                    };
                }
                continue;
            }
            // table (gfm)
            if (token = this.tokenizer.table(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // lheading
            if (token = this.tokenizer.lheading(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // top-level paragraph
            // prevent paragraph consuming extensions by clipping 'src' to extension start
            let cutSrc = src;
            if (this.options.extensions?.startBlock) {
                let startIndex = Infinity;
                const tempSrc = src.slice(1);
                let tempStart;
                this.options.extensions.startBlock.forEach((getStartIndex) => {
                    tempStart = getStartIndex.call({ lexer: this }, tempSrc);
                    if (typeof tempStart === 'number' && tempStart >= 0) {
                        startIndex = Math.min(startIndex, tempStart);
                    }
                });
                if (startIndex < Infinity && startIndex >= 0) {
                    cutSrc = src.substring(0, startIndex + 1);
                }
            }
            if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
                const lastToken = tokens.at(-1);
                if (lastParagraphClipped && lastToken?.type === 'paragraph') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.pop();
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                lastParagraphClipped = cutSrc.length !== src.length;
                src = src.substring(token.raw.length);
                continue;
            }
            // text
            if (token = this.tokenizer.text(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.pop();
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            if (src) {
                const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
                if (this.options.silent) {
                    console.error(errMsg);
                    break;
                }
                else {
                    throw new Error(errMsg);
                }
            }
        }
        this.state.top = true;
        return tokens;
    }
    inline(src, tokens = []) {
        this.inlineQueue.push({ src, tokens });
        return tokens;
    }
    /**
     * Lexing/Compiling
     */
    inlineTokens(src, tokens = []) {
        // String with links masked to avoid interference with em and strong
        let maskedSrc = src;
        let match = null;
        // Mask out reflinks
        if (this.tokens.links) {
            const links = Object.keys(this.tokens.links);
            if (links.length > 0) {
                while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
                    if (links.includes(match[0].slice(match[0].lastIndexOf('[') + 1, -1))) {
                        maskedSrc = maskedSrc.slice(0, match.index)
                            + '[' + 'a'.repeat(match[0].length - 2) + ']'
                            + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
                    }
                }
            }
        }
        // Mask out other blocks
        while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
            maskedSrc = maskedSrc.slice(0, match.index) + '[' + 'a'.repeat(match[0].length - 2) + ']' + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
        }
        // Mask out escaped characters
        while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
            maskedSrc = maskedSrc.slice(0, match.index) + '++' + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
        }
        let keepPrevChar = false;
        let prevChar = '';
        while (src) {
            if (!keepPrevChar) {
                prevChar = '';
            }
            keepPrevChar = false;
            let token;
            // extensions
            if (this.options.extensions?.inline?.some((extTokenizer) => {
                if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
                    src = src.substring(token.raw.length);
                    tokens.push(token);
                    return true;
                }
                return false;
            })) {
                continue;
            }
            // escape
            if (token = this.tokenizer.escape(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // tag
            if (token = this.tokenizer.tag(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // link
            if (token = this.tokenizer.link(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // reflink, nolink
            if (token = this.tokenizer.reflink(src, this.tokens.links)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (token.type === 'text' && lastToken?.type === 'text') {
                    lastToken.raw += token.raw;
                    lastToken.text += token.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // em & strong
            if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // code
            if (token = this.tokenizer.codespan(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // br
            if (token = this.tokenizer.br(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // del (gfm)
            if (token = this.tokenizer.del(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // autolink
            if (token = this.tokenizer.autolink(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // url (gfm)
            if (!this.state.inLink && (token = this.tokenizer.url(src))) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // text
            // prevent inlineText consuming extensions by clipping 'src' to extension start
            let cutSrc = src;
            if (this.options.extensions?.startInline) {
                let startIndex = Infinity;
                const tempSrc = src.slice(1);
                let tempStart;
                this.options.extensions.startInline.forEach((getStartIndex) => {
                    tempStart = getStartIndex.call({ lexer: this }, tempSrc);
                    if (typeof tempStart === 'number' && tempStart >= 0) {
                        startIndex = Math.min(startIndex, tempStart);
                    }
                });
                if (startIndex < Infinity && startIndex >= 0) {
                    cutSrc = src.substring(0, startIndex + 1);
                }
            }
            if (token = this.tokenizer.inlineText(cutSrc)) {
                src = src.substring(token.raw.length);
                if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
                    prevChar = token.raw.slice(-1);
                }
                keepPrevChar = true;
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'text') {
                    lastToken.raw += token.raw;
                    lastToken.text += token.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            if (src) {
                const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
                if (this.options.silent) {
                    console.error(errMsg);
                    break;
                }
                else {
                    throw new Error(errMsg);
                }
            }
        }
        return tokens;
    }
}

/**
 * Renderer
 */
class _Renderer {
    options;
    parser; // set by the parser
    constructor(options) {
        this.options = options || _defaults;
    }
    space(token) {
        return '';
    }
    code({ text, lang, escaped }) {
        const langString = (lang || '').match(other.notSpaceStart)?.[0];
        const code = text.replace(other.endingNewline, '') + '\n';
        if (!langString) {
            return '<pre><code>'
                + (escaped ? code : escape(code, true))
                + '</code></pre>\n';
        }
        return '<pre><code class="language-'
            + escape(langString)
            + '">'
            + (escaped ? code : escape(code, true))
            + '</code></pre>\n';
    }
    blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        return `<blockquote>\n${body}</blockquote>\n`;
    }
    html({ text }) {
        return text;
    }
    heading({ tokens, depth }) {
        return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
    }
    hr(token) {
        return '<hr>\n';
    }
    list(token) {
        const ordered = token.ordered;
        const start = token.start;
        let body = '';
        for (let j = 0; j < token.items.length; j++) {
            const item = token.items[j];
            body += this.listitem(item);
        }
        const type = ordered ? 'ol' : 'ul';
        const startAttr = (ordered && start !== 1) ? (' start="' + start + '"') : '';
        return '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
    }
    listitem(item) {
        let itemBody = '';
        if (item.task) {
            const checkbox = this.checkbox({ checked: !!item.checked });
            if (item.loose) {
                if (item.tokens[0]?.type === 'paragraph') {
                    item.tokens[0].text = checkbox + ' ' + item.tokens[0].text;
                    if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === 'text') {
                        item.tokens[0].tokens[0].text = checkbox + ' ' + escape(item.tokens[0].tokens[0].text);
                        item.tokens[0].tokens[0].escaped = true;
                    }
                }
                else {
                    item.tokens.unshift({
                        type: 'text',
                        raw: checkbox + ' ',
                        text: checkbox + ' ',
                        escaped: true,
                    });
                }
            }
            else {
                itemBody += checkbox + ' ';
            }
        }
        itemBody += this.parser.parse(item.tokens, !!item.loose);
        return `<li>${itemBody}</li>\n`;
    }
    checkbox({ checked }) {
        return '<input '
            + (checked ? 'checked="" ' : '')
            + 'disabled="" type="checkbox">';
    }
    paragraph({ tokens }) {
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
    }
    table(token) {
        let header = '';
        // header
        let cell = '';
        for (let j = 0; j < token.header.length; j++) {
            cell += this.tablecell(token.header[j]);
        }
        header += this.tablerow({ text: cell });
        let body = '';
        for (let j = 0; j < token.rows.length; j++) {
            const row = token.rows[j];
            cell = '';
            for (let k = 0; k < row.length; k++) {
                cell += this.tablecell(row[k]);
            }
            body += this.tablerow({ text: cell });
        }
        if (body)
            body = `<tbody>${body}</tbody>`;
        return '<table>\n'
            + '<thead>\n'
            + header
            + '</thead>\n'
            + body
            + '</table>\n';
    }
    tablerow({ text }) {
        return `<tr>\n${text}</tr>\n`;
    }
    tablecell(token) {
        const content = this.parser.parseInline(token.tokens);
        const type = token.header ? 'th' : 'td';
        const tag = token.align
            ? `<${type} align="${token.align}">`
            : `<${type}>`;
        return tag + content + `</${type}>\n`;
    }
    /**
     * span level renderer
     */
    strong({ tokens }) {
        return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    }
    em({ tokens }) {
        return `<em>${this.parser.parseInline(tokens)}</em>`;
    }
    codespan({ text }) {
        return `<code>${escape(text, true)}</code>`;
    }
    br(token) {
        return '<br>';
    }
    del({ tokens }) {
        return `<del>${this.parser.parseInline(tokens)}</del>`;
    }
    link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
            return text;
        }
        href = cleanHref;
        let out = '<a href="' + href + '"';
        if (title) {
            out += ' title="' + (escape(title)) + '"';
        }
        out += '>' + text + '</a>';
        return out;
    }
    image({ href, title, text }) {
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
            return escape(text);
        }
        href = cleanHref;
        let out = `<img src="${href}" alt="${text}"`;
        if (title) {
            out += ` title="${escape(title)}"`;
        }
        out += '>';
        return out;
    }
    text(token) {
        return 'tokens' in token && token.tokens
            ? this.parser.parseInline(token.tokens)
            : ('escaped' in token && token.escaped ? token.text : escape(token.text));
    }
}

/**
 * TextRenderer
 * returns only the textual part of the token
 */
class _TextRenderer {
    // no need for block level renderers
    strong({ text }) {
        return text;
    }
    em({ text }) {
        return text;
    }
    codespan({ text }) {
        return text;
    }
    del({ text }) {
        return text;
    }
    html({ text }) {
        return text;
    }
    text({ text }) {
        return text;
    }
    link({ text }) {
        return '' + text;
    }
    image({ text }) {
        return '' + text;
    }
    br() {
        return '';
    }
}

/**
 * Parsing & Compiling
 */
class _Parser {
    options;
    renderer;
    textRenderer;
    constructor(options) {
        this.options = options || _defaults;
        this.options.renderer = this.options.renderer || new _Renderer();
        this.renderer = this.options.renderer;
        this.renderer.options = this.options;
        this.renderer.parser = this;
        this.textRenderer = new _TextRenderer();
    }
    /**
     * Static Parse Method
     */
    static parse(tokens, options) {
        const parser = new _Parser(options);
        return parser.parse(tokens);
    }
    /**
     * Static Parse Inline Method
     */
    static parseInline(tokens, options) {
        const parser = new _Parser(options);
        return parser.parseInline(tokens);
    }
    /**
     * Parse Loop
     */
    parse(tokens, top = true) {
        let out = '';
        for (let i = 0; i < tokens.length; i++) {
            const anyToken = tokens[i];
            // Run any renderer extensions
            if (this.options.extensions?.renderers?.[anyToken.type]) {
                const genericToken = anyToken;
                const ret = this.options.extensions.renderers[genericToken.type].call({ parser: this }, genericToken);
                if (ret !== false || !['space', 'hr', 'heading', 'code', 'table', 'blockquote', 'list', 'html', 'paragraph', 'text'].includes(genericToken.type)) {
                    out += ret || '';
                    continue;
                }
            }
            const token = anyToken;
            switch (token.type) {
                case 'space': {
                    out += this.renderer.space(token);
                    continue;
                }
                case 'hr': {
                    out += this.renderer.hr(token);
                    continue;
                }
                case 'heading': {
                    out += this.renderer.heading(token);
                    continue;
                }
                case 'code': {
                    out += this.renderer.code(token);
                    continue;
                }
                case 'table': {
                    out += this.renderer.table(token);
                    continue;
                }
                case 'blockquote': {
                    out += this.renderer.blockquote(token);
                    continue;
                }
                case 'list': {
                    out += this.renderer.list(token);
                    continue;
                }
                case 'html': {
                    out += this.renderer.html(token);
                    continue;
                }
                case 'paragraph': {
                    out += this.renderer.paragraph(token);
                    continue;
                }
                case 'text': {
                    let textToken = token;
                    let body = this.renderer.text(textToken);
                    while (i + 1 < tokens.length && tokens[i + 1].type === 'text') {
                        textToken = tokens[++i];
                        body += '\n' + this.renderer.text(textToken);
                    }
                    if (top) {
                        out += this.renderer.paragraph({
                            type: 'paragraph',
                            raw: body,
                            text: body,
                            tokens: [{ type: 'text', raw: body, text: body, escaped: true }],
                        });
                    }
                    else {
                        out += body;
                    }
                    continue;
                }
                default: {
                    const errMsg = 'Token with "' + token.type + '" type was not found.';
                    if (this.options.silent) {
                        console.error(errMsg);
                        return '';
                    }
                    else {
                        throw new Error(errMsg);
                    }
                }
            }
        }
        return out;
    }
    /**
     * Parse Inline Tokens
     */
    parseInline(tokens, renderer = this.renderer) {
        let out = '';
        for (let i = 0; i < tokens.length; i++) {
            const anyToken = tokens[i];
            // Run any renderer extensions
            if (this.options.extensions?.renderers?.[anyToken.type]) {
                const ret = this.options.extensions.renderers[anyToken.type].call({ parser: this }, anyToken);
                if (ret !== false || !['escape', 'html', 'link', 'image', 'strong', 'em', 'codespan', 'br', 'del', 'text'].includes(anyToken.type)) {
                    out += ret || '';
                    continue;
                }
            }
            const token = anyToken;
            switch (token.type) {
                case 'escape': {
                    out += renderer.text(token);
                    break;
                }
                case 'html': {
                    out += renderer.html(token);
                    break;
                }
                case 'link': {
                    out += renderer.link(token);
                    break;
                }
                case 'image': {
                    out += renderer.image(token);
                    break;
                }
                case 'strong': {
                    out += renderer.strong(token);
                    break;
                }
                case 'em': {
                    out += renderer.em(token);
                    break;
                }
                case 'codespan': {
                    out += renderer.codespan(token);
                    break;
                }
                case 'br': {
                    out += renderer.br(token);
                    break;
                }
                case 'del': {
                    out += renderer.del(token);
                    break;
                }
                case 'text': {
                    out += renderer.text(token);
                    break;
                }
                default: {
                    const errMsg = 'Token with "' + token.type + '" type was not found.';
                    if (this.options.silent) {
                        console.error(errMsg);
                        return '';
                    }
                    else {
                        throw new Error(errMsg);
                    }
                }
            }
        }
        return out;
    }
}

class _Hooks {
    options;
    block;
    constructor(options) {
        this.options = options || _defaults;
    }
    static passThroughHooks = new Set([
        'preprocess',
        'postprocess',
        'processAllTokens',
    ]);
    /**
     * Process markdown before marked
     */
    preprocess(markdown) {
        return markdown;
    }
    /**
     * Process HTML after marked is finished
     */
    postprocess(html) {
        return html;
    }
    /**
     * Process all tokens before walk tokens
     */
    processAllTokens(tokens) {
        return tokens;
    }
    /**
     * Provide function to tokenize markdown
     */
    provideLexer() {
        return this.block ? _Lexer.lex : _Lexer.lexInline;
    }
    /**
     * Provide function to parse tokens
     */
    provideParser() {
        return this.block ? _Parser.parse : _Parser.parseInline;
    }
}

class Marked {
    defaults = _getDefaults();
    options = this.setOptions;
    parse = this.parseMarkdown(true);
    parseInline = this.parseMarkdown(false);
    Parser = _Parser;
    Renderer = _Renderer;
    TextRenderer = _TextRenderer;
    Lexer = _Lexer;
    Tokenizer = _Tokenizer;
    Hooks = _Hooks;
    constructor(...args) {
        this.use(...args);
    }
    /**
     * Run callback for every token
     */
    walkTokens(tokens, callback) {
        let values = [];
        for (const token of tokens) {
            values = values.concat(callback.call(this, token));
            switch (token.type) {
                case 'table': {
                    const tableToken = token;
                    for (const cell of tableToken.header) {
                        values = values.concat(this.walkTokens(cell.tokens, callback));
                    }
                    for (const row of tableToken.rows) {
                        for (const cell of row) {
                            values = values.concat(this.walkTokens(cell.tokens, callback));
                        }
                    }
                    break;
                }
                case 'list': {
                    const listToken = token;
                    values = values.concat(this.walkTokens(listToken.items, callback));
                    break;
                }
                default: {
                    const genericToken = token;
                    if (this.defaults.extensions?.childTokens?.[genericToken.type]) {
                        this.defaults.extensions.childTokens[genericToken.type].forEach((childTokens) => {
                            const tokens = genericToken[childTokens].flat(Infinity);
                            values = values.concat(this.walkTokens(tokens, callback));
                        });
                    }
                    else if (genericToken.tokens) {
                        values = values.concat(this.walkTokens(genericToken.tokens, callback));
                    }
                }
            }
        }
        return values;
    }
    use(...args) {
        const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };
        args.forEach((pack) => {
            // copy options to new object
            const opts = { ...pack };
            // set async to true if it was set to true before
            opts.async = this.defaults.async || opts.async || false;
            // ==-- Parse "addon" extensions --== //
            if (pack.extensions) {
                pack.extensions.forEach((ext) => {
                    if (!ext.name) {
                        throw new Error('extension name required');
                    }
                    if ('renderer' in ext) { // Renderer extensions
                        const prevRenderer = extensions.renderers[ext.name];
                        if (prevRenderer) {
                            // Replace extension with func to run new extension but fall back if false
                            extensions.renderers[ext.name] = function (...args) {
                                let ret = ext.renderer.apply(this, args);
                                if (ret === false) {
                                    ret = prevRenderer.apply(this, args);
                                }
                                return ret;
                            };
                        }
                        else {
                            extensions.renderers[ext.name] = ext.renderer;
                        }
                    }
                    if ('tokenizer' in ext) { // Tokenizer Extensions
                        if (!ext.level || (ext.level !== 'block' && ext.level !== 'inline')) {
                            throw new Error("extension level must be 'block' or 'inline'");
                        }
                        const extLevel = extensions[ext.level];
                        if (extLevel) {
                            extLevel.unshift(ext.tokenizer);
                        }
                        else {
                            extensions[ext.level] = [ext.tokenizer];
                        }
                        if (ext.start) { // Function to check for start of token
                            if (ext.level === 'block') {
                                if (extensions.startBlock) {
                                    extensions.startBlock.push(ext.start);
                                }
                                else {
                                    extensions.startBlock = [ext.start];
                                }
                            }
                            else if (ext.level === 'inline') {
                                if (extensions.startInline) {
                                    extensions.startInline.push(ext.start);
                                }
                                else {
                                    extensions.startInline = [ext.start];
                                }
                            }
                        }
                    }
                    if ('childTokens' in ext && ext.childTokens) { // Child tokens to be visited by walkTokens
                        extensions.childTokens[ext.name] = ext.childTokens;
                    }
                });
                opts.extensions = extensions;
            }
            // ==-- Parse "overwrite" extensions --== //
            if (pack.renderer) {
                const renderer = this.defaults.renderer || new _Renderer(this.defaults);
                for (const prop in pack.renderer) {
                    if (!(prop in renderer)) {
                        throw new Error(`renderer '${prop}' does not exist`);
                    }
                    if (['options', 'parser'].includes(prop)) {
                        // ignore options property
                        continue;
                    }
                    const rendererProp = prop;
                    const rendererFunc = pack.renderer[rendererProp];
                    const prevRenderer = renderer[rendererProp];
                    // Replace renderer with func to run extension, but fall back if false
                    renderer[rendererProp] = (...args) => {
                        let ret = rendererFunc.apply(renderer, args);
                        if (ret === false) {
                            ret = prevRenderer.apply(renderer, args);
                        }
                        return ret || '';
                    };
                }
                opts.renderer = renderer;
            }
            if (pack.tokenizer) {
                const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
                for (const prop in pack.tokenizer) {
                    if (!(prop in tokenizer)) {
                        throw new Error(`tokenizer '${prop}' does not exist`);
                    }
                    if (['options', 'rules', 'lexer'].includes(prop)) {
                        // ignore options, rules, and lexer properties
                        continue;
                    }
                    const tokenizerProp = prop;
                    const tokenizerFunc = pack.tokenizer[tokenizerProp];
                    const prevTokenizer = tokenizer[tokenizerProp];
                    // Replace tokenizer with func to run extension, but fall back if false
                    // @ts-expect-error cannot type tokenizer function dynamically
                    tokenizer[tokenizerProp] = (...args) => {
                        let ret = tokenizerFunc.apply(tokenizer, args);
                        if (ret === false) {
                            ret = prevTokenizer.apply(tokenizer, args);
                        }
                        return ret;
                    };
                }
                opts.tokenizer = tokenizer;
            }
            // ==-- Parse Hooks extensions --== //
            if (pack.hooks) {
                const hooks = this.defaults.hooks || new _Hooks();
                for (const prop in pack.hooks) {
                    if (!(prop in hooks)) {
                        throw new Error(`hook '${prop}' does not exist`);
                    }
                    if (['options', 'block'].includes(prop)) {
                        // ignore options and block properties
                        continue;
                    }
                    const hooksProp = prop;
                    const hooksFunc = pack.hooks[hooksProp];
                    const prevHook = hooks[hooksProp];
                    if (_Hooks.passThroughHooks.has(prop)) {
                        // @ts-expect-error cannot type hook function dynamically
                        hooks[hooksProp] = (arg) => {
                            if (this.defaults.async) {
                                return Promise.resolve(hooksFunc.call(hooks, arg)).then(ret => {
                                    return prevHook.call(hooks, ret);
                                });
                            }
                            const ret = hooksFunc.call(hooks, arg);
                            return prevHook.call(hooks, ret);
                        };
                    }
                    else {
                        // @ts-expect-error cannot type hook function dynamically
                        hooks[hooksProp] = (...args) => {
                            let ret = hooksFunc.apply(hooks, args);
                            if (ret === false) {
                                ret = prevHook.apply(hooks, args);
                            }
                            return ret;
                        };
                    }
                }
                opts.hooks = hooks;
            }
            // ==-- Parse WalkTokens extensions --== //
            if (pack.walkTokens) {
                const walkTokens = this.defaults.walkTokens;
                const packWalktokens = pack.walkTokens;
                opts.walkTokens = function (token) {
                    let values = [];
                    values.push(packWalktokens.call(this, token));
                    if (walkTokens) {
                        values = values.concat(walkTokens.call(this, token));
                    }
                    return values;
                };
            }
            this.defaults = { ...this.defaults, ...opts };
        });
        return this;
    }
    setOptions(opt) {
        this.defaults = { ...this.defaults, ...opt };
        return this;
    }
    lexer(src, options) {
        return _Lexer.lex(src, options ?? this.defaults);
    }
    parser(tokens, options) {
        return _Parser.parse(tokens, options ?? this.defaults);
    }
    parseMarkdown(blockType) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parse = (src, options) => {
            const origOpt = { ...options };
            const opt = { ...this.defaults, ...origOpt };
            const throwError = this.onError(!!opt.silent, !!opt.async);
            // throw error if an extension set async to true but parse was called with async: false
            if (this.defaults.async === true && origOpt.async === false) {
                return throwError(new Error('marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise.'));
            }
            // throw error in case of non string input
            if (typeof src === 'undefined' || src === null) {
                return throwError(new Error('marked(): input parameter is undefined or null'));
            }
            if (typeof src !== 'string') {
                return throwError(new Error('marked(): input parameter is of type '
                    + Object.prototype.toString.call(src) + ', string expected'));
            }
            if (opt.hooks) {
                opt.hooks.options = opt;
                opt.hooks.block = blockType;
            }
            const lexer = opt.hooks ? opt.hooks.provideLexer() : (blockType ? _Lexer.lex : _Lexer.lexInline);
            const parser = opt.hooks ? opt.hooks.provideParser() : (blockType ? _Parser.parse : _Parser.parseInline);
            if (opt.async) {
                return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src)
                    .then(src => lexer(src, opt))
                    .then(tokens => opt.hooks ? opt.hooks.processAllTokens(tokens) : tokens)
                    .then(tokens => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens)
                    .then(tokens => parser(tokens, opt))
                    .then(html => opt.hooks ? opt.hooks.postprocess(html) : html)
                    .catch(throwError);
            }
            try {
                if (opt.hooks) {
                    src = opt.hooks.preprocess(src);
                }
                let tokens = lexer(src, opt);
                if (opt.hooks) {
                    tokens = opt.hooks.processAllTokens(tokens);
                }
                if (opt.walkTokens) {
                    this.walkTokens(tokens, opt.walkTokens);
                }
                let html = parser(tokens, opt);
                if (opt.hooks) {
                    html = opt.hooks.postprocess(html);
                }
                return html;
            }
            catch (e) {
                return throwError(e);
            }
        };
        return parse;
    }
    onError(silent, async) {
        return (e) => {
            e.message += '\nPlease report this to https://github.com/markedjs/marked.';
            if (silent) {
                const msg = '<p>An error occurred:</p><pre>'
                    + escape(e.message + '', true)
                    + '</pre>';
                if (async) {
                    return Promise.resolve(msg);
                }
                return msg;
            }
            if (async) {
                return Promise.reject(e);
            }
            throw e;
        };
    }
}

const markedInstance = new Marked();
function marked(src, opt) {
    return markedInstance.parse(src, opt);
}
/**
 * Sets the default options.
 *
 * @param options Hash of options
 */
marked.options =
    marked.setOptions = function (options) {
        markedInstance.setOptions(options);
        marked.defaults = markedInstance.defaults;
        changeDefaults(marked.defaults);
        return marked;
    };
/**
 * Gets the original marked default options.
 */
marked.getDefaults = _getDefaults;
marked.defaults = _defaults;
/**
 * Use Extension
 */
marked.use = function (...args) {
    markedInstance.use(...args);
    marked.defaults = markedInstance.defaults;
    changeDefaults(marked.defaults);
    return marked;
};
/**
 * Run callback for every token
 */
marked.walkTokens = function (tokens, callback) {
    return markedInstance.walkTokens(tokens, callback);
};
/**
 * Compiles markdown to HTML without enclosing `p` tag.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options
 * @return String of compiled HTML
 */
marked.parseInline = markedInstance.parseInline;
/**
 * Expose
 */
marked.Parser = _Parser;
marked.parser = _Parser.parse;
marked.Renderer = _Renderer;
marked.TextRenderer = _TextRenderer;
marked.Lexer = _Lexer;
marked.lexer = _Lexer.lex;
marked.Tokenizer = _Tokenizer;
marked.Hooks = _Hooks;
marked.parse = marked;
const options = marked.options;
const setOptions = marked.setOptions;
const use = marked.use;
const walkTokens = marked.walkTokens;
const parseInline = marked.parseInline;
const parse = marked;
const parser = _Parser.parse;
const lexer = _Lexer.lex;


//# sourceMappingURL=marked.esm.js.map


/***/ })

/******/ });
/************************************************************************/
/******/ // The module cache
/******/ var __webpack_module_cache__ = {};
/******/ 
/******/ // The require function
/******/ function __webpack_require__(moduleId) {
/******/ 	// Check if module is in cache
/******/ 	var cachedModule = __webpack_module_cache__[moduleId];
/******/ 	if (cachedModule !== undefined) {
/******/ 		return cachedModule.exports;
/******/ 	}
/******/ 	// Create a new module (and put it into the cache)
/******/ 	var module = __webpack_module_cache__[moduleId] = {
/******/ 		// no module.id needed
/******/ 		// no module.loaded needed
/******/ 		exports: {}
/******/ 	};
/******/ 
/******/ 	// Execute the module function
/******/ 	__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 
/******/ 	// Return the exports of the module
/******/ 	return module.exports;
/******/ }
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__webpack_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/make namespace object */
/******/ (() => {
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = (exports) => {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/ })();
/******/ 
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!*******************************************************!*\
  !*** ./src/chrome-carbonbar-page/carbon-commander.js ***!
  \*******************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CarbonCommander: () => (/* binding */ CarbonCommander)
/* harmony export */ });
/* harmony import */ var marked__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! marked */ "./node_modules/marked/lib/marked.esm.js");
/* harmony import */ var _tool_caller_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./tool-caller.js */ "./src/chrome-carbonbar-page/tool-caller.js");
/* harmony import */ var _mcp_tool_caller_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./mcp-tool-caller.js */ "./src/chrome-carbonbar-page/mcp-tool-caller.js");
/* harmony import */ var _tools_CarbonBarHelpTools_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../tools/CarbonBarHelpTools.js */ "./src/tools/CarbonBarHelpTools.js");
/* harmony import */ var _global_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../global.js */ "./src/global.js");
/* harmony import */ var _settings_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./settings.js */ "./src/chrome-carbonbar-page/settings.js");
/* harmony import */ var _carbon_commander_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./carbon-commander.css */ "./src/chrome-carbonbar-page/carbon-commander.css");
/* harmony import */ var _autocomplete_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./autocomplete.js */ "./src/chrome-carbonbar-page/autocomplete.js");
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










_global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.setPrefix('[CARBONBAR]');

class CarbonCommander {
    constructor(doc = document) {
      this.currentApp = `CarbonCommander [${window.location.hostname}]`;
      this.toolCaller = _tool_caller_js__WEBPACK_IMPORTED_MODULE_1__["default"];
      this.mcpToolCaller = _mcp_tool_caller_js__WEBPACK_IMPORTED_MODULE_2__["default"];
      this.settings = _settings_js__WEBPACK_IMPORTED_MODULE_5__["default"];
      this.keybind = _settings_js__WEBPACK_IMPORTED_MODULE_5__["default"].keybind;
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

      // Initialize HMAC key from script data attribute
      const script = doc.querySelector('script[cc-data-key]');
      if (script) {
        const keyBase64 = script.getAttribute('cc-data-key');
        if (keyBase64) {
          this.initializeHMACKey(keyBase64).catch(error => {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error initializing HMAC key:', error);
          });
        }
      }

      var tabId = doc.querySelector('meta[name="tabId"]').getAttribute('content');
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.info("Initializing with tabId:", tabId);
      window.tabId = tabId;

      if (typeof window.tabId === 'undefined') {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('TabId not initialized properly');
      }
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.info(`CarbonCommander initialized with tabId: ${window.tabId}`);
      
      // Create root element with shadow DOM
      this.root = doc.createElement('div');
      this.shadow = this.root.attachShadow({ mode: 'closed' });
      
      // Add styles to shadow DOM
      const style = doc.createElement('style');
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

        ${_carbon_commander_css__WEBPACK_IMPORTED_MODULE_6__}
      `;
      this.shadow.appendChild(style);
      
      // Create container for content
      this.container = doc.createElement('div');
      this.shadow.appendChild(this.container);
      
      // Setup event listeners first
      this.setupEventListeners();
      
      // Set up settings with postMessage handler
      this.settings.setPostMessageHandler((message) => this.postMessage(message));
      
      doc.body.appendChild(this.root);

      this.ollamaCheckInterval = null;

      // Initialize after event listeners are set up
      this.waitForAuthThenInitialize();

      // Load command history after initialization
      this.loadCommandHistory().catch(error => {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error loading initial command history:', error);
      });
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
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.info(`Initializing CarbonCommander`);
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

      // Add click handler for settings icon
      const settingsIcon = this.container.querySelector('.cc-settings-icon');
      settingsIcon.addEventListener('click', () => this.showSettingsDialog());

      // Load settings
      await this.settings.load();

      // Load command history
      this.loadCommandHistory();

      // Initialize autocomplete
      this.autocomplete = new _autocomplete_js__WEBPACK_IMPORTED_MODULE_7__.Autocomplete(this.container, this.input, {
        delay: 300,
        minLength: 2
      });
    
      // Set up autocomplete callbacks
      this.autocomplete.setCommandHistoryGetter(() => this.commandHistory);
      this.autocomplete.setToolsContextGetter(() => {
        return this.toolCaller.getTools(true).map(tool => `${tool.description}`).join('\n');
      });
      this.autocomplete.onRequestAutocomplete = (context) => {
        this.postMessage({
          type: 'CB_GET_AUTOCOMPLETE',
          payload: context
        });
      };

      setTimeout(() => {
        this.checkOllamaAvailability(1000, 10);
      }, 500);

      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Checking OpenAI availability', { noAIMode: this.hasNoAIMode });
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
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AUTH_TOKEN_INITIALIZED', this.authToken);
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
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('[RCV]','Invalid auth token', event.data);
            return;
          }
          
          const payload = event.data.payload?.payload || event.data.payload;

          const toolName = payload.tool.name;
          const toolArgs = payload.tool.arguments;
        
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Received tool execution request:', toolName, toolArgs);
          const tool = this.toolCaller.getTool(toolName);
          if (!tool) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error(`Tool not found: ${toolName}`);
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
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug("AI_EXECUTE_TOOL result:", result);
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
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Tool execution error:', error);
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

        if (unprefixedType === 'COMMAND_HISTORY_RESPONSE') {
          this.commandHistory = event.data.payload || [];
          this.historyIndex = this.commandHistory.length;
        }

        if (unprefixedType === 'GET_AUTOCOMPLETE_RESPONSE') {
            const suggestion = event.data.payload?.payload || event.data.payload;
            if (suggestion) {
                _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('showAutocompleteSuggestion', suggestion);
                // Extract the input from the current input field
                const currentInput = this.input.value.trim();
                // Create the suggestion object in the format expected by showAutocompleteSuggestion
                const formattedSuggestion = {
                    requestId: this.autocomplete.currentAutocompleteRequestId,
                    text: suggestion.payload || suggestion
                };
                this.showAutocompleteSuggestion(currentInput, formattedSuggestion);
            }
        }

        if (unprefixedType === 'PROVIDER_STATUS_UPDATE') {
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('PROVIDER_STATUS_UPDATE', event.data.provider, event.data.status);
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
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.warn('Message from external source');
          //return;
        }

        // Handle secure message channel setup
        if (event.data.type === 'SECURE_MESSAGE_DONT_HANDLEATM') {
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Setting up secure message channel');
          const port = event.ports[0];
          const messageId = event.data.messageId;
          if (!port || !messageId) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Missing port or messageId for secure channel');
            return;
          }

          // Verify this is a message we sent
          if(event.data.messageType == 'AI_TOOL_EXECUTE') {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Received secure message for AI tool execute:', messageId, event.data);
          } else if (!this.pendingSecureMessages.has(messageId)) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.warn('Received secure message for unknown message ID:', messageId, event.data);
            return;
          } else {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Received secure message for known message ID:', messageId, event.data);
          }

          // Store port reference and initialize key state
          this.activeMessagePorts.set(messageId, port);
          this.messageKeyStates.set(messageId, this.hmacKey);
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Initialized message state with HMAC key');

          // Start port immediately
          port.start();
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Started message port');

          // Listen for messages on the port
          port.onmessage = async (e) => {
            const message = e.data;
            try {
              const counter = message._counter;
              _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Received message on secure channel:', { 
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
              _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Processing secure message:', unprefixedType);
              
              // Handle the message based on its type
              await tempMessageHandler({ data: message.data }, unprefixedType);

              // Derive and update to next key
              const nextKey = await this.deriveNextKey(currentKey, `${messageId}-${counter}`);
              if (nextKey) {
                this.messageKeyStates.set(messageId, nextKey);
                _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Updated message key');
              }
              
            } catch (error) {
              _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error in secure message handling:', error);
              // Send error back through port
              port.postMessage({
                error: error.message,
                counter: message?._counter
              });
            }
          };

          // Handle port closure and cleanup
          port.onclose = () => {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Secure message port closed:', messageId);
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
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('[RCV]','Unknown message type', event.data);
          return;
        }

        const unprefixedType = event.data.type.replace('CARBON_', '').replace('CB_', '');
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('[RCV]', event.data.type, event.data);
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
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error deriving next key:', error);
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
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error verifying signature:', error);
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
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('HMAC key initialized');
      } catch (error) {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error initializing HMAC key:', error);
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
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AI_ERROR_RESPONSE', error);
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
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.group('AI Response Handler');
      const container = this.container.querySelector('.cc-container');
      const payload = message.payload || message.data.payload;

      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Processing AI response:', { type: message.type, payload });
        
      if (payload.error) {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('AI response error:', payload.error);
        this.displayError(payload);
      } else if (message.type == 'AI_ERROR_RESPONSE') {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('AI response error:', payload);
        this.displayError(payload);
      } 
      //else {
      if (typeof payload.content === 'string' && payload.content.length > 0) {
        const chunk = payload.content;
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AI_CHUNK_RESPONSE2', payload.error, message.type, chunk);
        this.accumulatedChunks += chunk;
        const htmlContent = marked__WEBPACK_IMPORTED_MODULE_0__.marked.parse(this.accumulatedChunks);
        const resultContainer = this.getCurrentResultContainer();
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AI_CHUNK_RESPONSE3', resultContainer);
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
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('toolCallDiv', toolCallDiv);
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

        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AI_TOOL_CALL_RESULT', payload.content?.payload?.id, payload);
      }

      this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
      

      if (payload.isFinished) {
        container.classList.remove('processing', 'tool-running', 'has-error');
        container.classList.add('success');
        setTimeout(() => {
          container.classList.remove('success');
          container.classList.add('waiting-input');
        }, 2000);
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AI response finished', payload, container.classList);
        this.createNewResultContainer = true;
        this.accumulatedChunks = '';
        // Reset input
        this.input.value = '';
        this.input.disabled = false;
        this.input.focus();
      }

      if (payload.messages && !payload.error) {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('AI response messages', payload.messages);
        this.messages = payload.messages;
      }
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.groupEnd();
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
        model: _global_js__WEBPACK_IMPORTED_MODULE_4__.AICallerModels.FAST, //this will be set by the ai-service if null
        tools: _tools_CarbonBarHelpTools_js__WEBPACK_IMPORTED_MODULE_3__.CarbonBarHelpTools.GetNoAIModeToolInfo(),
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
        tools: _tools_CarbonBarHelpTools_js__WEBPACK_IMPORTED_MODULE_3__.CarbonBarHelpTools.GetNoAIModeToolInfo(),
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
          var result = await _tools_CarbonBarHelpTools_js__WEBPACK_IMPORTED_MODULE_3__.CarbonBarHelpTools.SetOpenAIKey.execute(await this.toolCaller.getToolScope(this), {key: key});
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('result', result);
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
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.group('Handle Submit');
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.info('Processing input:', value);

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
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.info('Disconnecting OpenAI');
        this.sendFakeAIResponse("OpenAI disconnected successfully");
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.groupEnd();
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
              model: _global_js__WEBPACK_IMPORTED_MODULE_4__.AICallerModels.FAST,
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
          
          _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error:', error);
          this.resultsContainer.innerHTML += `
              <div class="cc-error">Error: ${error.message}</div>
          `;
          this.input.disabled = false;
          this.input.value = value;
          this.resultsContainer.scrollTop = this.resultsContainer.scrollHeight;
      }
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.groupEnd();
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
      try {
        this.postMessage({ 
          type: "GET_COMMAND_HISTORY",
          payload: {
            encrypted: true,
            hostname: window.location.hostname
          }
        });
      } catch (error) {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error loading command history:', error);
      }
    }

    async saveCommandHistory() {
      try {
        this.postMessage({ 
          type: "SAVE_COMMAND_HISTORY", 
          payload: {
            history: this.commandHistory,
            encrypted: true,
            hostname: window.location.hostname
          }
        });
      } catch (error) {
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Error saving command history:', error);
      }
    }

    showAutocompleteSuggestion(input, suggestion) {
      // If suggestion contains a nested array of suggestions, extract it
      if (suggestion?.payload?.text && Array.isArray(suggestion.payload.text)) {
        const suggestionsWithId = suggestion.payload.text.map(s => ({
          text: s.text,
          requestId: this.autocomplete.currentAutocompleteRequestId
        }));
        this.autocomplete.showSuggestion(input, suggestionsWithId);
        return;
      }

      // If suggestion is an array of text objects, pass it directly
      if (Array.isArray(suggestion)) {
        // Add the current requestId to the array of suggestions
        const suggestionsWithId = suggestion.map(s => ({
          text: s.text,
          requestId: this.autocomplete.currentAutocompleteRequestId
        }));
        this.autocomplete.showSuggestion(input, suggestionsWithId);
        return;
      }

      // If it's a single suggestion, convert it to our new format
      if (suggestion && suggestion.text) {
        this.autocomplete.showSuggestion(input, [{
          text: suggestion.text,
          requestId: suggestion.requestId || this.autocomplete.currentAutocompleteRequestId
        }]);
      }
    }

    async checkOllamaAvailability(interval = 1000, maxCount = -1) {
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.time('ollamaCheck');
      var fastCheck = true;
      let count = 0;
      if (!this.ollamaCheckInterval) {
        this.ollamaCheckInterval = setInterval(async () => {
          count++;
          if(maxCount > 0 && count > maxCount && !this.hasNoAIMode){
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Ollama check complete', { count: count - 1 });
            clearInterval(this.ollamaCheckInterval);
            this.ollamaCheckInterval = null;
            return;
          }
          try {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Checking Ollama availability', { noAIMode: this.hasNoAIMode });
            this.postMessage({ 
              type: "CHECK_OLLAMA_AVAILABLE",
              payload: {
                noAIMode: this.hasNoAIMode
              }
            });
            

          } catch (error) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Ollama check failed:', error);
          }
        }, interval);
      }
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.timeEnd('ollamaCheck');
    }

    updateProviderStatus(provider, isConnected) {
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('PROVIDER_STATUS_UPDATE', provider, isConnected);
      
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
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.group('System Prompt Generation');
      
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
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Building system prompt with tools');
      
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
              _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error(`Error getting MCP system prompt for ${serviceId}:`, error);
          }
      }

      this.messages.push({
          role: 'system',
          content: systemPrompt
      });
      
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Final system prompt:', systemPrompt);
      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.groupEnd();
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

      _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('Sending message:', carbonMessage);

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
        _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.debug('handleAccessRequest', message);
        if(message.payload?.payload) {
            message.payload = message.payload.payload;
        }
        if (!message?.payload) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Invalid access request message:', message);
            return;
        }

        const { requestId, prompt } = message.payload;
        if (!requestId) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('No requestId provided in access request');
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
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('Failed to create dialog element');
            resultContainer.remove();
            return;
        }

        // Add click handlers for buttons
        const buttons = dialog.querySelectorAll('.cc-button');
        if (!buttons || buttons.length === 0) {
            _global_js__WEBPACK_IMPORTED_MODULE_4__.ccLogger.error('No buttons found in dialog');
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

importAll(__webpack_require__("./src/tools sync recursive \\.js$"));


const carbonCommander = new CarbonCommander();
window.carbonCommander = carbonCommander;
})();

var __webpack_exports__CarbonCommander = __webpack_exports__.CarbonCommander;
export { __webpack_exports__CarbonCommander as CarbonCommander };

//# sourceMappingURL=carbon-commander.js.map