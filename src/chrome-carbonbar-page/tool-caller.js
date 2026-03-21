import { ccLogger } from '../global.js';
import BaseToolCaller from './base-tool-caller.js';

class ToolCaller extends BaseToolCaller {

    async getToolScope(bar) {
        ccLogger.group('Building Tool Scope', "bar.settings:", bar.settings, "bar:", bar);
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
                    ccLogger.info('[ToolScope]', ...args);
                } else {
                    ccLogger.debug('[ToolScope]', ...args);
                }
            },
            logError: (...args) => {
                ccLogger.error('[ToolScope]', ...args);
            },
            promptAccessRequest: async (args) => {
                const { prompt, default_value } = args;
                const promise = new Promise(async (resolve) => {
                    // Generate a unique ID for this request
                    const requestId = Math.random().toString(36).substr(2, 9);

                    const messageHandler = (event) => {
                        // ick, I dont really like how this looks.
                        
                        if(event.data.type && event.data.type === 'CARBON_ACCESS_REQUEST_RESPONSE_RESPONSE' && event.data.payload.payload.requestId === requestId) {
                            ccLogger.debug('CARBON_ACCESS_REQUEST_RESPONSE_RESPONSE2', event, "payload:", event.data.payload.payload);
                            window.removeEventListener('message', messageHandler);
                            const response = event.data.payload.payload;
                            if(response.confirmed) {
                                ccLogger.debug('CONFIRMATION_DIALOG_RESPONSE', 'granted', response);
                                resolve(response);
                            } else {
                                ccLogger.debug('CONFIRMATION_DIALOG_RESPONSE', 'denied', response);
                                resolve(response);
                            }

                        } else {
                            ccLogger.debug('CARBON_ACCESS_REQUEST_RESPONSE_RESPONSE1', requestId, event);
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
                ccLogger.debug('CONFIRMATION_DIALOG_RESPONSE2', 'result:', result);
                return result;
            }
        }
        //Apply the current toolsets scope functions
        for(let toolSet of this.getAllToolSetsForPage()) {
            try {
                if(toolSet.toolSet._CarbonBarBuildScope) {
                    ccLogger.debug(`Building scope for toolset: ${toolSet.name}`);
                    scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                    ccLogger.debug('App name after scope build:', scope.appName);
                }
            } catch (e) {
                ccLogger.error('Error building scope:', e);
            }
        }

        if(!scope.$http) {
            const validateUrl = (url) => {
                const parsed = new URL(url, window.location.origin);
                const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
                const isSameOrigin = parsed.origin === window.location.origin;
                if (!isSameOrigin && parsed.protocol !== 'https:' && !isLocalhost) {
                    ccLogger.error(`[ToolScope] Blocked $http request to non-HTTPS URL: ${url}`);
                    throw new Error(`$http requests must be same-origin, HTTPS, or localhost. Blocked: ${url}`);
                }
                return parsed.href;
            };
            const parseResponse = async (res) => {
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    return { data: await res.json() };
                } else {
                    return { data: await res.text() };
                }
            };
            scope.$http = {
                get: async (url) => {
                    return parseResponse(await fetch(validateUrl(url)));
                },
                post: async (url, data) => {
                    return parseResponse(await fetch(validateUrl(url), {
                        method: 'POST',
                        body: JSON.stringify(data)
                    }));
                },
                put: async (url, data) => {
                    return parseResponse(await fetch(validateUrl(url), {
                        method: 'PUT',
                        body: JSON.stringify(data)
                    }));
                }
            }
        }

        if(!scope.appName) {
            ccLogger.warn('No app name found in scope, using default');
            scope.appName = 'CarbonCommander [Unknown App (2)]';
        }
        ccLogger.debug('Final app name:', scope.appName);
        ccLogger.groupEnd();
        return scope;
    }

    async buildSystemPrompt(basePrompt, scope) {
        ccLogger.group('Building System Prompt');
        let toolSets = this.getAllToolSetsForPage();
        if(toolSets.length > 0) {
            for(let toolSet of toolSets) { 
                if(toolSet.toolSet._CarbonBarSystemPrompt) {
                    ccLogger.debug(`Adding system prompt from toolSet: ${toolSet.name || 'unnamed'}`);
                    if(toolSet.toolSet._CarbonBarBuildScope) {
                        scope = await toolSet.toolSet._CarbonBarBuildScope(scope);
                    }
                    basePrompt = await toolSet.toolSet._CarbonBarSystemPrompt(basePrompt, scope);
                }
            }
        }
        ccLogger.groupEnd();
        return basePrompt;
    }

    static getService(serviceName) {
        ccLogger.debug('Getting service:', serviceName);
        return angular.element(document).injector().get(serviceName);
    }
}
const toolCaller = new ToolCaller();
export default toolCaller;