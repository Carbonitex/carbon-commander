class CCLocalStorage {
    // Kept temporarily for migration of old XOR-encrypted values
    static #pass = 'CarbonLocalSecurityKey';

    static ccLogger = {
        log: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        group: () => {},
        groupEnd: () => {},
    }

    static ccLoggerFull = {
        log: console.log.bind(console, '[CARBON-STORAGE]'),
        info: console.info.bind(console, '[CARBON-STORAGE]'),
        warn: console.warn.bind(console, '[CARBON-STORAGE]'),
        error: console.error.bind(console, '[CARBON-STORAGE]'),
        debug: console.debug.bind(console, '[CARBON-STORAGE]'),
        group: console.group.bind(console, '[CARBON-STORAGE]'),
        groupEnd: console.groupEnd.bind(console, '[CARBON-STORAGE]'),
      }

    static #encryptionKeyCache = null;

    static async getOrCreateEncryptionKey() {
        if (this.#encryptionKeyCache) {
            return this.#encryptionKeyCache;
        }

        const result = await chrome.storage.local.get(['_cc_encryption_key']);
        if (result._cc_encryption_key) {
            const key = await crypto.subtle.importKey(
                'jwk',
                result._cc_encryption_key,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
            this.#encryptionKeyCache = key;
            return key;
        }

        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        const exported = await crypto.subtle.exportKey('jwk', key);
        await chrome.storage.local.set({ _cc_encryption_key: exported });
        this.#encryptionKeyCache = key;
        return key;
    }

    static #arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    static #base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    static #decryptOldXOR(enc) {
        let dec = '';
        for (let i = 0; i < enc.length; i += 4) {
            const c = parseInt(enc.slice(i, i + 4), 16);
            dec += String.fromCharCode(c ^ this.#pass.charCodeAt((i / 4) % this.#pass.length));
        }
        return dec;
    }

    static #isOldXORFormat(value) {
        if (typeof value !== 'string') return false;
        // Old format is a hex string with length divisible by 4
        if (value.length === 0 || value.length % 4 !== 0) return false;
        return /^[0-9a-fA-F]+$/.test(value);
    }

    static async setEncrypted(key, value) {
        const encryptedKey = `encrypted_${key}`;
        const cryptoKey = await this.getOrCreateEncryptionKey();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(value);
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            encoded
        );
        const stored = JSON.stringify({
            v: 2,
            iv: this.#arrayBufferToBase64(iv),
            ct: this.#arrayBufferToBase64(ciphertext)
        });
        await chrome.storage.local.set({ [encryptedKey]: stored });
        this.ccLogger.log('setEncrypted', encryptedKey, `[${value.substring(0, 4)}...]`);
    }

    static async getEncrypted(key) {
        const encryptedKey = `encrypted_${key}`;
        const result = await chrome.storage.local.get([encryptedKey]);
        const enc = result[encryptedKey];
        if (!enc) return null;

        // Try to parse as new AES-GCM format
        try {
            const parsed = JSON.parse(enc);
            if (parsed && parsed.v === 2 && parsed.iv && parsed.ct) {
                const cryptoKey = await this.getOrCreateEncryptionKey();
                const iv = new Uint8Array(this.#base64ToArrayBuffer(parsed.iv));
                const ciphertext = this.#base64ToArrayBuffer(parsed.ct);
                const decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    cryptoKey,
                    ciphertext
                );
                const dec = new TextDecoder().decode(decrypted);
                this.ccLogger.log('getEncrypted', encryptedKey, `[${dec.substring(0, 4)}...]`);
                return dec;
            }
        } catch (e) {
            // Not JSON or not v2 format — fall through to old XOR migration
        }

        // Old XOR format: migrate to AES-GCM
        if (this.#isOldXORFormat(enc)) {
            const dec = this.#decryptOldXOR(enc);
            this.ccLogger.log('getEncrypted (migrating from XOR)', encryptedKey, `[${dec.substring(0, 4)}...]`);
            // Re-encrypt with AES-GCM
            await this.setEncrypted(key, dec);
            return dec;
        }

        // Unknown format
        this.ccLogger.warn('getEncrypted: unknown format for', encryptedKey);
        return null;
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
