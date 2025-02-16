class CCLocalStorage {
    // TODO: Make this a random key based on something from chrome thats unique to the extension
    static #pass = 'CarbonLocalSecurityKey';
    
    static ccLogger = {
        log: console.log.bind(console, '[CARBON-STORAGE]'),
        info: console.info.bind(console, '[CARBON-STORAGE]'),
        warn: console.warn.bind(console, '[CARBON-STORAGE]'),
        error: console.error.bind(console, '[CARBON-STORAGE]'),
        debug: console.debug.bind(console, '[CARBON-STORAGE]'),
        group: console.group.bind(console, '[CARBON-STORAGE]'),
        groupEnd: console.groupEnd.bind(console, '[CARBON-STORAGE]'),
      }

    static async setEncrypted(key, value) {
        const encryptedKey = `encrypted_${key}`;
        let enc = '';
        for(let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i) ^ this.#pass.charCodeAt(i % this.#pass.length);
            enc += c.toString(16).padStart(4, '0');
        }
        await chrome.storage.local.set({ [encryptedKey]: enc });
        this.ccLogger.log('setEncrypted', encryptedKey, `[${value.substring(0, 4)}...]`);
    }

    static async getEncrypted(key) {
        const encryptedKey = `encrypted_${key}`;
        const result = await chrome.storage.local.get([encryptedKey]);
        const enc = result[encryptedKey];
        if (!enc) return null;
        
        let dec = '';
        for(let i = 0; i < enc.length; i += 4) {
            const c = parseInt(enc.slice(i, i + 4), 16);
            dec += String.fromCharCode(c ^ this.#pass.charCodeAt((i/4) % this.#pass.length));
        }
        this.ccLogger.log('getEncrypted', encryptedKey, `[${dec.substring(0, 4)}...]`);
        return dec;
    }

    static async removeEncrypted(key) {
        const encryptedKey = `encrypted_${key}`;
        await chrome.storage.local.remove(encryptedKey);
        this.ccLogger.debug('removeEncrypted', encryptedKey);
    }

    static async getEncryptedKeys() {
        const result = await chrome.storage.local.get(null);
        return Object.keys(result).filter(key => key.startsWith('encrypted_')).map(key => key.substring(10).trim());
    }

    static async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
    }

    static async get(key) {
        const result = await chrome.storage.local.get([key]);
        return result[key] || null;
    }

    static async getAll() {
        return await chrome.storage.local.get(null);
    }

    static async remove(key) {
        await chrome.storage.local.remove(key);
    }
}

export default CCLocalStorage;