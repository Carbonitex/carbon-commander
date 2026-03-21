import { ccLogger } from '../global.js';

class BaseToolCaller {
    currentPageTools = null;

    reset() {
        ccLogger.debug('Resetting tool caller state');
        this.currentPageTools = null;
    }

    getToolSets() {
        return this.getAllToolsets();
    }

    getTools(onlyFunctionInfo = false) {
        ccLogger.group('Getting Tools');
        let allTools = [];
        let pageTools = this.getAllToolSetsForPage();
        pageTools.forEach(toolSet => {
            toolSet.tools.forEach(prop => {
                allTools.push(onlyFunctionInfo ? prop.function : prop);
            });
        });
        ccLogger.debug(`Found ${allTools.length} tools`);
        ccLogger.groupEnd();
        return allTools;
    }

    getTool(toolName, onlyFunctionInfo = false) {
        ccLogger.debug('Getting tool:', toolName);
        const allTools = this.getTools(onlyFunctionInfo);
        const tool = allTools.find(tool => onlyFunctionInfo ? tool.name == toolName : tool.function.name == toolName);
        if (!tool) {
            ccLogger.warn(`Tool not found: ${toolName}`);
        }
        return tool;
    }

    getAllToolSetsForPage() {
        if(this.currentPageTools) {
            return this.currentPageTools;
        }

        ccLogger.group('Getting Tool Sets for Page');
        this.currentPageTools = this.getAllToolsets().filter(toolSet =>
            (toolSet.tools && toolSet.tools.length > 0) &&
            (toolSet.toolSet._CarbonBarPageLoadFilter && toolSet.toolSet._CarbonBarPageLoadFilter(window))
        );

        ccLogger.debug(`Found ${this.currentPageTools.length} tool sets for current page`);
        ccLogger.groupEnd();
        return this.currentPageTools;
    }

    getAllToolsets() {
        ccLogger.group('Getting All Tool Sets');
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

                    ccLogger.debug('Processing toolset:', {
                        name: toolset.name,
                        toolCount: toolset.tools.length
                    });

                    if(toolset.tools && toolset.tools.length > 0) {
                        allTools.push(toolset);
                    }
                } catch (e) {
                    ccLogger.error(`Error getting tools from ${toolSet.name}:`, e);
                }
            });
        }
        ccLogger.debug(`Total tool sets found: ${allTools.length}`);
        ccLogger.groupEnd();
        return allTools;
    }

    getToolHtml(chunk) {
        ccLogger.group('Generating Tool HTML');
        const toolName = chunk.name;
        const toolArgs = chunk.arguments;
        let toolResult = chunk.result;
        const toolCallIndex = chunk.index;
        const toolCallStarted = chunk.callStarted;
        const toolCallFinished = chunk.callFinished;
        const tool = this.getTool(toolName, true);

        ccLogger.debug('Tool chunk info:', {
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

        ccLogger.debug('Tool result status:', {
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
                                <td>${tool.parameters.required?.includes(name) ? '\u2713' : ''}</td>
                                <td>${param.description || ''}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            `;
        }

        ccLogger.debug('parametersHtmlTest', toolResult?.result ? toolResult.result : 'No result');

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
                    <div class="tool-simple-icon ${status}">\uD83D\uDD27</div>
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

        ccLogger.debug('Generated HTML with status:', status);
        ccLogger.groupEnd();
        return { simpleHtml, advancedHtml };
    }
}

export default BaseToolCaller;
