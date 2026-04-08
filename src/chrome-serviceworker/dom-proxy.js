const ccLog = (...args) => console.log('[DOMProxy]', ...args);
const ccError = (...args) => console.error('[DOMProxy]', ...args);

class DOMProxy {
    async executeInTab(tabId, func, args = []) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func,
                args
            });

            if (!results || results.length === 0) {
                return { success: false, error: 'No result from tab execution' };
            }

            const result = results[0].result;
            return result;
        } catch (error) {
            ccError(`executeInTab failed for tab ${tabId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async getTabUrl(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            return tab.url;
        } catch (error) {
            ccError('getTabUrl failed:', error);
            return null;
        }
    }
}

const domProxy = new DOMProxy();
export default domProxy;
