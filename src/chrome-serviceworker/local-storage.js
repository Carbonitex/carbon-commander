class CCLocalStorage {
    // TODO: Make this a random key based on something from chrome thats unique to the extension
    static #pass = 'CarbonLocalSecurityKey';
    
    static async setEncrypted(key, value) {
        let enc = '';
        for(let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i) ^ this.#pass.charCodeAt(i % this.#pass.length);
            enc += c.toString(16).padStart(4, '0');
        }
        await chrome.storage.local.set({ [key]: enc });
        console.log('setEncrypted', key, `[${value.substring(0, 4)}...]`);
    }

    static async getEncrypted(key) {
        const result = await chrome.storage.local.get([key]);
        const enc = result[key];
        if (!enc) return null;
        
        let dec = '';
        for(let i = 0; i < enc.length; i += 4) {
            const c = parseInt(enc.slice(i, i + 4), 16);
            dec += String.fromCharCode(c ^ this.#pass.charCodeAt((i/4) % this.#pass.length));
        }
        console.log('getEncrypted', key, `[${dec.substring(0, 4)}...]`);
        return dec;
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