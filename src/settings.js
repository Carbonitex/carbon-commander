/*
 * CarbonCommander - A command palette interface for quick actions
 * Copyright (C) 2025 Carbonitex
 */

import { ccLogger } from './global.js';

export class Settings {
    constructor() {
        this.systemPrompt = '';
        this.keyValuePairs = new Map();
        this.encryptedKeys = new Set(); // Track which keys are encrypted
        this.keybind = { key: 'k', ctrl: true, meta: false }; // Default keybind
        
        // Add predefined openai-key
        this.keyValuePairs.set('openai-key', '');
        this.encryptedKeys.add('openai-key');
        
        // Add event listener for settings loaded
        window.addEventListener('message', this.handleSettingsMessage.bind(this));
        
        // Request initial settings
        this.load();
    }

    handleSettingsMessage(event) {
        if (event.source !== window) return;

        if (event.data.type === 'SETTINGS_LOADED') {
            const settings = event.data.payload;
            if (settings) {
                this.systemPrompt = settings.systemPrompt || '';
                if (settings.keyValuePairs) {
                    this.keyValuePairs = new Map(
                        settings.keyValuePairs instanceof Map ? 
                            settings.keyValuePairs : 
                            Object.entries(settings.keyValuePairs)
                    );
                    // Ensure openai-key is always present
                    if (!this.keyValuePairs.has('openai-key')) {
                        this.keyValuePairs.set('openai-key', '');
                    }
                }
                if (settings.encryptedKeys) {
                    this.encryptedKeys = new Set(settings.encryptedKeys);
                    // Ensure openai-key is always encrypted
                    this.encryptedKeys.add('openai-key');
                }
            }
        }

        if (event.data.type === 'SET_KEYBIND') {
            this.keybind = event.data.payload || { key: 'k', ctrl: true, meta: false };
        }
    }

    async load() {
        try {
            // Request settings from service.js
            window.postMessage({
                type: 'GET_SETTINGS'
            }, window.location.origin);

            // Request keybind settings
            window.postMessage({
                type: 'GET_KEYBIND'
            }, window.location.origin);
        } catch (error) {
            ccLogger.error('Error loading settings:', error);
        }
    }

    async save() {
        try {
            // Convert Map to object for storage
            const settingsToSave = {
                systemPrompt: this.systemPrompt,
                keyValuePairs: Object.fromEntries(this.keyValuePairs),
                encryptedKeys: Array.from(this.encryptedKeys)
            };
            
            // Send settings to service.js for storage
            window.postMessage({
                type: 'SAVE_SETTINGS',
                payload: settingsToSave
            }, window.location.origin);
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
        this.keybind = newKeybind;
        window.postMessage({
            type: 'SAVE_KEYBIND',
            payload: newKeybind
        }, window.location.origin);
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
                    <label>Custom system prompt to be injected into all system messages:</label>
                    <textarea id="system-prompt">${this.systemPrompt || ''}</textarea>
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
            
            <div class="cc-settings-section">
                <h3>Configuration Key-Value Pairs</h3>
                <div class="cc-settings-field">
                    <table class="cc-key-value-table">
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Value</th>
                                <th>Encrypted</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Array.from(this.keyValuePairs || []).map(([key, value]) => `
                                <tr>
                                    <td><input type="text" value="${key}" class="kv-key" ${this.encryptedKeys.has(key) ? 'readonly' : ''}></td>
                                    <td>
                                        ${this.encryptedKeys.has(key) ? 
                                            `<div class="encrypted-value">${(!value || value.trim() === '') ? '<span style="color: #ff9999; font-style: italic;">Not Set</span>' : '••••••••'}</div>` :
                                            `<input type="text" value="${value}" class="kv-value">`
                                        }
                                    </td>
                                    <td>
                                        ${this.encryptedKeys.has(key) ? 
                                            '<span class="encrypted-badge">🔒</span>' :
                                            '<input type="checkbox" class="encrypt-toggle">'
                                        }
                                    </td>
                                    <td>
                                        <button class="cc-button delete-row">Delete</button>
                                        ${this.encryptedKeys.has(key) ? 
                                            '<button class="cc-button update-encrypted">Update</button>' : 
                                            ''
                                        }
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
            const tbody = dialog.querySelector('.cc-key-value-table tbody');
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
        
        dialog.addEventListener('click', async (e) => {
            if (e.target.classList.contains('delete-row')) {
                const row = e.target.closest('tr');
                const key = row.querySelector('.kv-key').value;
                this.encryptedKeys.delete(key);
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
                    if (newValue) {
                        if (key === 'openai-key') {
                            // Test OpenAI key before saving
                            window.postMessage({
                                type: 'SET_OPENAI_KEY',
                                payload: { key: newValue }
                            }, window.location.origin);

                            // Listen for the response
                            const response = await new Promise(resolve => {
                                const listener = (event) => {
                                    if (event.data.type === 'SET_OPENAI_KEY_RESPONSE') {
                                        window.removeEventListener('message', listener);
                                        resolve(event.data.payload);
                                    }
                                };
                                window.addEventListener('message', listener);
                            });

                            if (!response) {
                                ccLogger.error('Failed to set OpenAI key');
                                inputDialog.remove();
                                return;
                            }
                        }
                        
                        // Send message to update encrypted value
                        window.postMessage({
                            type: 'UPDATE_ENCRYPTED_VALUE',
                            payload: { key, value: newValue }
                        }, window.location.origin);
                        
                        this.keyValuePairs.set(key, newValue);
                        inputDialog.remove();
                    }
                });
            }
        });
        
        const confirmBtn = dialog.querySelector('.confirm');
        confirmBtn.addEventListener('click', async () => {
            // Save system prompt
            this.systemPrompt = dialog.querySelector('#system-prompt').value.trim();
            
            // Save key-value pairs
            const newPairs = new Map();
            const newEncryptedKeys = new Set();
            
            const rows = dialog.querySelectorAll('.cc-key-value-table tbody tr');
            for (const row of rows) {
                const key = row.querySelector('.kv-key').value.trim();
                const valueInput = row.querySelector('.kv-value');
                const encryptToggle = row.querySelector('.encrypt-toggle');
                
                if (key) {
                    if (this.encryptedKeys.has(key)) {
                        // Keep existing encrypted value
                        const existingValue = this.keyValuePairs.get(key);
                        newPairs.set(key, typeof existingValue === 'string' ? existingValue.trim() : existingValue);
                        newEncryptedKeys.add(key);
                    } else if (valueInput) {
                        const value = valueInput.value;
                        if (value !== undefined && value !== null) {
                            const trimmedValue = typeof value === 'string' ? value.trim() : value;
                            if (trimmedValue !== '') {
                                // If this is the OpenAI key and it's being encrypted, test it first
                                if (key === 'openai-key' && encryptToggle?.checked) {
                                    const response = await new Promise(resolve => {
                                        window.postMessage({
                                            type: 'SET_OPENAI_KEY',
                                            payload: { key: trimmedValue }
                                        }, window.location.origin);

                                        const listener = (event) => {
                                            if (event.data.type === 'SET_OPENAI_KEY_RESPONSE') {
                                                window.removeEventListener('message', listener);
                                                resolve(event.data.payload);
                                            }
                                        };
                                        window.addEventListener('message', listener);
                                    });

                                    if (!response) {
                                        ccLogger.error('Failed to set OpenAI key');
                                        continue;
                                    }
                                }

                                newPairs.set(key, trimmedValue);
                                // Check if this should be encrypted
                                if (encryptToggle && encryptToggle.checked) {
                                    newEncryptedKeys.add(key);
                                    // Send message to encrypt value
                                    window.postMessage({
                                        type: 'ENCRYPT_VALUE',
                                        payload: { key, value: trimmedValue }
                                    }, window.location.origin);
                                }
                            }
                        }
                    }
                }
            }
            
            this.keyValuePairs = newPairs;
            this.encryptedKeys = newEncryptedKeys;
            
            await this.save();
            overlay.remove();
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