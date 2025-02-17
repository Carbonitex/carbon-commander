import { ccLogger } from '../global.js';

export class Autocomplete {
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
        ccLogger.debug('Showing suggestion:', { input, suggestion });
        
        // For array suggestions, check the requestId of the first item
        if (Array.isArray(suggestion)) {
            if (!suggestion.length || suggestion[0].requestId !== this.currentAutocompleteRequestId) {
                ccLogger.debug('Skipping suggestions due to requestId mismatch:', {
                    current: this.currentAutocompleteRequestId,
                    received: suggestion[0]?.requestId
                });
                return;
            }

            suggestion = suggestion[0].text;
        } else if (suggestion.requestId !== this.currentAutocompleteRequestId) {
            ccLogger.debug('Skipping suggestion due to requestId mismatch:', {
                current: this.currentAutocompleteRequestId,
                received: suggestion.requestId
            });
            return;
        }

        // Clear any existing keyboard handlers
        this.input.removeEventListener('keydown', this._handleKeyNavigation);

        // If we have an array of suggestions
        if (Array.isArray(suggestion)) {
            ccLogger.debug('Processing array of suggestions:', suggestion);
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
                            ccLogger.debug('Selected suggestion:', selectedSuggestion);
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

        ccLogger.debug('Rendering breadcrumbs for suggestions:', this._currentSuggestions);

        const breadcrumbsHtml = this._currentSuggestions.map((suggestion, index) => {
            // Ensure we're getting the text property from the suggestion object
            const suggestionText = suggestion.text || suggestion.toString();
            ccLogger.debug(`Suggestion ${index}:`, { suggestion, suggestionText });
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