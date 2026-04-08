import { TOOL_CONTEXT } from '../global.js';
import { GeneralTools } from '../tools/GeneralTools.js';
import { CarbonBarHelpTools } from '../tools/CarbonBarHelpTools.js';
import { BitbucketTools } from '../tools/external/BitbucketTools.js';
import { JiraTools } from '../tools/external/JiraTools.js';
import { HackerNewsTools } from '../tools/external/HackerNewsTools.js';
import { StockTools } from '../tools/external/StockTools.js';
import { LinkedInTools } from '../tools/external/LinkedInTools.js';
import { AmazonTools } from '../tools/external/AmazonTools.js';
import { YouTubeTools } from '../tools/external/YouTubeTools.js';
import { RedditTools } from '../tools/external/RedditTools.js';
import { StackOverflowTools } from '../tools/external/StackOverflowTools.js';
import { TwitchTools } from '../tools/external/TwitchTools.js';
import { RocketChatTools } from '../tools/external/RocketChatTools.js';
import { SmarterMailTools } from '../tools/external/SmarterMailTools.js';
import { SmarterTrackPortalTools } from '../tools/external/SmarterTrackPortalTools.js';
import CCLocalStorage from './local-storage.js';
import domProxy from './dom-proxy.js';
import * as domFunctions from './dom-functions.js';

const ccLog = (...args) => console.log('[ToolRegistry]', ...args);
const ccError = (...args) => console.error('[ToolRegistry]', ...args);

const ALL_TOOLSETS = [
    GeneralTools,
    CarbonBarHelpTools,
    BitbucketTools,
    JiraTools,
    HackerNewsTools,
    StockTools,
    LinkedInTools,
    AmazonTools,
    YouTubeTools,
    RedditTools,
    StackOverflowTools,
    TwitchTools,
    RocketChatTools,
    SmarterMailTools,
    SmarterTrackPortalTools
];

// Maps tool function names to their DOM proxy functions.
// Tools not in this map with DOM_READ/DOM_WRITE context will fall through to page execution.
const DOM_FUNCTION_MAP = {
    // GeneralTools
    'get_page_metadata': { fn: domFunctions.domGetPageMetadata, passArgs: false },
    'extract_page_content': { fn: domFunctions.domExtractPageContent, passArgs: true },
    'security_check': { fn: domFunctions.domSecurityCheck, passArgs: true },
    'page_interact': { fn: domFunctions.domPageInteract, passArgs: true },
    'input_text': { fn: domFunctions.domInputText, passArgs: true },
    'navigate_to': { fn: domFunctions.domNavigateTo, passArgs: true },
    'color_picker': { fn: domFunctions.domColorPickerExtract, passArgs: true },
    // LinkedIn
    'get_profile_info': { fn: domFunctions.domGetLinkedInProfile, passArgs: true },
    'get_job_info': { fn: domFunctions.domGetLinkedInJob, passArgs: true },
    'get_company_info': { fn: domFunctions.domGetLinkedInCompany, passArgs: true },
    // Amazon
    'get_product_info': { fn: domFunctions.domGetAmazonProduct, passArgs: true },
    // YouTube
    'get_video_info': { fn: domFunctions.domGetYouTubeVideo, passArgs: true },
    'get_playlist_info': { fn: domFunctions.domGetYouTubePlaylist, passArgs: true },
    // Reddit
    'get_post_info': { fn: domFunctions.domGetRedditPost, passArgs: true },
    // StackOverflow
    'get_so_page_info': { fn: domFunctions.domGetSOPageInfo, passArgs: false },
    'get_answers': { fn: domFunctions.domGetSOAnswers, passArgs: true },
    'get_related_questions': { fn: domFunctions.domGetSORelatedQuestions, passArgs: true },
    'get_question_details': { fn: domFunctions.domGetSOQuestionDetails, passArgs: true },
};

class WorkerToolRegistry {
    constructor() {
        this.toolsets = ALL_TOOLSETS;
        this.toolMap = new Map();
        this.toolContextMap = new Map();
        this.toolsetMap = new Map();
        this._buildMaps();
    }

    _buildMaps() {
        for (const toolsetClass of this.toolsets) {
            const tools = this._extractTools(toolsetClass);
            this.toolsetMap.set(toolsetClass.name, { toolsetClass, tools });
            for (const tool of tools) {
                this.toolMap.set(tool.function.name, { tool, toolsetClass });
                this.toolContextMap.set(tool.function.name, tool.context || TOOL_CONTEXT.PAGE_SCOPE);
            }
        }
        ccLog(`Registered ${this.toolMap.size} tools from ${this.toolsets.length} toolsets`);
    }

    _extractTools(toolsetClass) {
        const tools = [];
        for (const prop of Object.getOwnPropertyNames(toolsetClass)) {
            const val = toolsetClass[prop];
            if (val && typeof val === 'object' && val.function) {
                tools.push(val);
            }
        }
        return tools;
    }

    discoverTools(tabUrl) {
        const url = typeof tabUrl === 'string' ? new URL(tabUrl) : tabUrl;
        const results = [];

        for (const [name, { toolsetClass, tools }] of this.toolsetMap) {
            if (!toolsetClass._matchesUrl) continue;
            try {
                if (!toolsetClass._matchesUrl(url)) continue;
            } catch (e) {
                ccError(`Error in _matchesUrl for ${name}:`, e);
                continue;
            }
            results.push({
                name,
                tools: tools.map(t => ({
                    name: t.function.name,
                    description: t.function.description,
                    parameters: t.function.parameters,
                    context: t.context || TOOL_CONTEXT.PAGE_SCOPE
                }))
            });
        }

        return results;
    }

    getToolDefinitions(tabUrl) {
        const toolsets = this.discoverTools(tabUrl);
        const defs = [];
        for (const ts of toolsets) {
            for (const tool of ts.tools) {
                defs.push({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                });
            }
        }
        return defs;
    }

    getToolContext(toolName) {
        return this.toolContextMap.get(toolName) || TOOL_CONTEXT.PAGE_SCOPE;
    }

    async executeInWorker(toolName, args, tabId) {
        const entry = this.toolMap.get(toolName);
        if (!entry) {
            return { success: false, error: `Tool not found: ${toolName}` };
        }

        const { tool } = entry;
        const context = tool.context || TOOL_CONTEXT.PAGE_SCOPE;

        if (context !== TOOL_CONTEXT.WORKER) {
            return { success: false, error: `Tool ${toolName} cannot run in worker (context: ${context})` };
        }

        const scope = await this._buildWorkerScope();

        try {
            const result = await tool.execute(scope, args);
            return result;
        } catch (error) {
            ccError(`Error executing ${toolName} in worker:`, error);
            return { success: false, error: error.message };
        }
    }

    async executeViaDOM(toolName, args, tabId) {
        const domEntry = DOM_FUNCTION_MAP[toolName];
        if (!domEntry) {
            ccLog(`No DOM function for ${toolName}, needs page delegation`);
            return null; // Signal to caller: fall through to page execution
        }

        if (!tabId) {
            return { success: false, error: 'No tab ID available for DOM execution' };
        }

        ccLog(`Executing ${toolName} via DOM proxy in tab ${tabId}`);
        try {
            const executeArgs = domEntry.passArgs ? [args || {}] : [];
            const result = await domProxy.executeInTab(tabId, domEntry.fn, executeArgs);
            return result;
        } catch (error) {
            ccError(`DOM execution failed for ${toolName}:`, error);
            return { success: false, error: error.message };
        }
    }

    async _buildWorkerScope() {
        const scope = {
            isWorkerContext: true,
            logMessage: (...args) => {
                let important = false;
                if (typeof args[0] === 'boolean') {
                    important = args[0];
                    args = args.slice(1);
                }
                if (important) {
                    console.info('[WorkerTool]', ...args);
                } else {
                    console.debug('[WorkerTool]', ...args);
                }
            },
            logError: (...args) => {
                console.error('[WorkerTool]', ...args);
            },
            $http: {
                get: async (url) => {
                    const res = await fetch(url);
                    const contentType = res.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        return { data: await res.json() };
                    }
                    return { data: await res.text() };
                },
                post: async (url, data) => {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const contentType = res.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        return { data: await res.json() };
                    }
                    return { data: await res.text() };
                },
                put: async (url, data) => {
                    const res = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const contentType = res.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        return { data: await res.json() };
                    }
                    return { data: await res.text() };
                }
            }
        };

        // Load settings from storage
        try {
            const allData = await CCLocalStorage.getAll();
            const keyValuePairs = new Map();
            const encryptedKeys = new Map();

            for (const [key, value] of Object.entries(allData)) {
                if (key.startsWith('encrypted_')) {
                    encryptedKeys.set(key.substring(10), true);
                } else if (!key.startsWith('_cc_')) {
                    keyValuePairs.set(key, value);
                }
            }

            scope.settings = { keyValuePairs, encryptedKeys };
        } catch (e) {
            ccError('Error loading settings for worker scope:', e);
            scope.settings = { keyValuePairs: new Map(), encryptedKeys: new Map() };
        }

        return scope;
    }

    buildSystemPrompt(basePrompt, tabUrl) {
        const url = typeof tabUrl === 'string' ? new URL(tabUrl) : tabUrl;
        let prompt = basePrompt;

        for (const [name, { toolsetClass }] of this.toolsetMap) {
            if (!toolsetClass._matchesUrl) continue;
            try {
                if (!toolsetClass._matchesUrl(url)) continue;
            } catch (e) {
                continue;
            }
            if (toolsetClass._CarbonBarSystemPrompt) {
                try {
                    // System prompts that need DOM can't run here — skip those
                    prompt = toolsetClass._CarbonBarSystemPrompt(prompt, {});
                } catch (e) {
                    ccError(`Error building system prompt for ${name}:`, e);
                }
            }
        }

        return prompt;
    }
}

const toolRegistry = new WorkerToolRegistry();
export default toolRegistry;
