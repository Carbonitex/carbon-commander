/*
 * CarbonCommander - A command palette interface for quick actions
 * Copyright (C) 2025 Carbonitex
 */

import { ccLogger, ccDefaultKeybind } from '../global.js';

export class Settings {
    constructor() {
        ccLogger.debug('Settings constructor');
        this._postMessageHandler = null;
        this.systemPrompt = '';
        this.hostnamePrompts = new Map(); // Add storage for hostname-specific prompts
        this.keyValuePairs = new Map();
        this.encryptedKeys = new Map(); // Track which keys are encrypted and if they have a non-empty value
        this.keybind = ccDefaultKeybind; // Default keybind
        




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
            this.keybind = event.data.payload || ccDefaultKeybind;
        }
    }

    async load() {
        ccLogger.debug('Settings: load');
        if (!this._postMessageHandler) {
            ccLogger.error('Settings: postMessage handler not initialized');
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
            ccLogger.error('Error loading settings:', error);
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
            ccLogger.error('Settings: postMessage handler not initialized');
            return;
        }

        try {
            // Convert Map to object for storage
            const settingsToSave = {
                systemPrompt: this.systemPrompt,
                keyValuePairs: this.keyValuePairs,
                encryptedKeys: this.encryptedKeys,
                hostnamePrompts: this.hostnamePrompts
            };
            
            // Save encrypted values first
            for (const [key, value] of this.keyValuePairs.entries()) {
                if (this.encryptedKeys.has(key)) {
                    const isEncryptedSet = this.encryptedKeys.get(key);
                    if(isEncryptedSet){
                        const hasValue = value !== null && value !== undefined && value !== '';
                        if(hasValue){
                            ccLogger.debug('Saving encrypted value:', key);
                            await this._postMessageHandler({
                                type: 'SAVE_ENCRYPTED_VALUE',
                                payload: {
                                    key: key,
                                    value: value
                                }
                            });
                            if(key === 'openai-key') {
                                ccLogger.debug('Setting OpenAI key:', value);
                                window.postMessage({
                                    type: 'CARBON_SET_OPENAI_KEY',
                                    payload: { key: value, save: true }
                                }, window.location.origin);
                            }
                        } else {
                            ccLogger.debug('Deleting encrypted value:', key);
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

            //remove all encrypted keys from the keyValuePairs map
            for(const [key, value] of this.encryptedKeys.entries()) {
                this.keyValuePairs.delete(key);
            }

            
            // Send settings to service.js for storage
            this._postMessageHandler({
                type: 'SAVE_SETTINGS',
                payload: settingsToSave
            });
        } catch (error) {
            ccLogger.error('Error saving settings:', error);
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
            ccLogger.error('Settings: postMessage handler not initialized');
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
                <div class="cc-settings-field">
                    <label>Command palette shortcut:</label>
                    <div class="cc-keybind-display">${this.getKeybindDisplay()}</div>
                    <button class="cc-button" id="change-keybind">Change Shortcut</button>
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

                ccLogger.debug('Deleted key:', key, 'new keyValuePairs:', this.keyValuePairs);

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
                            ccLogger.error('Failed to set OpenAI key');
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
        });
        
        const confirmBtn = dialog.querySelector('.confirm');
        confirmBtn.addEventListener('click', async () => {
            ccLogger.group('Saving settings from confirm click');
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
                                            ccLogger.error('Failed to set OpenAI key');
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

                ccLogger.debug('Old keyValuePairs:', this.keyValuePairs);
                ccLogger.debug('Old encryptedKeys:', this.encryptedKeys);

                this.keyValuePairs = newPairs;
                this.encryptedKeys = newEncryptedKeys;

                ccLogger.debug('New keyValuePairs:', this.keyValuePairs);
                ccLogger.debug('New encryptedKeys:', this.encryptedKeys);

                await this.save();
                overlay.remove();
            }catch(error)
            {
                ccLogger.error('Error saving settings:', error);
            }finally
            {
                ccLogger.groupEnd();
            }
            
        });
        
        const cancelBtn = dialog.querySelector('.cancel');
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
        });
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }
}

export default new Settings(); 