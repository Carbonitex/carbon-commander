class StockTools {
    static name = "StockTools";

    static _CarbonBarPageLoadFilter = (window) => {
        // Support major financial websites
        return window.location.hostname.includes('finance.yahoo.com') ||
               window.location.hostname.includes('marketwatch.com') ||
               window.location.hostname.includes('investing.com');
    }

    static GetStockInfo = {
        function: {
            name: 'get_stock_info',
            description: 'Get detailed information about a stock',
            parameters: {
                properties: {
                    symbol: {
                        type: 'string',
                        description: 'Stock symbol (e.g., AAPL, MSFT)'
                    }
                },
                required: ['symbol']
            }
        },
        execute: async function(scope, args) {
            try {
                // Use Yahoo Finance API
                const response = await scope.$http.get(`https://query1.finance.yahoo.com/v8/finance/chart/${args.symbol}`);
                const quote = response.data.chart.result[0];
                
                if (!quote) {
                    return { success: false, error: 'Stock not found' };
                }

                const meta = quote.meta;
                const indicators = quote.indicators.quote[0];
                const timestamp = quote.timestamp[quote.timestamp.length - 1];
                const lastPrice = meta.regularMarketPrice;
                const previousClose = meta.previousClose;
                const change = lastPrice - previousClose;
                const changePercent = (change / previousClose) * 100;

                return {
                    success: true,
                    result: {
                        symbol: args.symbol.toUpperCase(),
                        price: lastPrice,
                        change: change.toFixed(2),
                        changePercent: changePercent.toFixed(2),
                        open: meta.regularMarketOpen,
                        high: meta.regularMarketDayHigh,
                        low: meta.regularMarketDayLow,
                        volume: meta.regularMarketVolume,
                        marketCap: meta.marketCap,
                        timestamp: new Date(timestamp * 1000).toISOString()
                    }
                };
            } catch (error) {
                scope.logError('Error getting stock info:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetMarketIndices = {
        function: {
            name: 'get_market_indices',
            description: 'Get major market indices information',
            parameters: {}
        },
        execute: async function(scope, args) {
            try {
                const indices = ['^GSPC', '^DJI', '^IXIC', '^FTSE', '^N225']; // S&P 500, Dow, Nasdaq, FTSE, Nikkei
                const results = [];

                for (const index of indices) {
                    const response = await scope.$http.get(`https://query1.finance.yahoo.com/v8/finance/chart/${index}`);
                    const quote = response.data.chart.result[0];
                    
                    if (quote) {
                        const meta = quote.meta;
                        const change = meta.regularMarketPrice - meta.previousClose;
                        const changePercent = (change / meta.previousClose) * 100;

                        results.push({
                            name: meta.symbol,
                            price: meta.regularMarketPrice,
                            change: change.toFixed(2),
                            changePercent: changePercent.toFixed(2)
                        });
                    }
                }

                return { success: true, result: results };
            } catch (error) {
                scope.logError('Error getting market indices:', error);
                return { success: false, error: error.message };
            }
        }
    };

    static GetTopMovers = {
        function: {
            name: 'get_top_movers',
            description: 'Get top gaining and losing stocks',
            parameters: {
                properties: {
                    count: {
                        type: 'number',
                        description: 'Number of stocks to return for each category (default: 5)'
                    }
                }
            }
        },
        execute: async function(scope, args) {
            try {
                const count = args.count || 5;
                const response = await scope.$http.get('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=10');
                
                const gainers = response.data.finance.result[0].quotes
                    .slice(0, count)
                    .map(stock => ({
                        symbol: stock.symbol,
                        name: stock.shortName,
                        price: stock.regularMarketPrice,
                        change: stock.regularMarketChange.toFixed(2),
                        changePercent: stock.regularMarketChangePercent.toFixed(2)
                    }));

                const losers = response.data.finance.result[1].quotes
                    .slice(0, count)
                    .map(stock => ({
                        symbol: stock.symbol,
                        name: stock.shortName,
                        price: stock.regularMarketPrice,
                        change: stock.regularMarketChange.toFixed(2),
                        changePercent: stock.regularMarketChangePercent.toFixed(2)
                    }));

                return {
                    success: true,
                    result: {
                        gainers,
                        losers
                    }
                };
            } catch (error) {
                scope.logError('Error getting top movers:', error);
                return { success: false, error: error.message };
            }
        }
    };
}

if(window.sbaiTools) {
    window.sbaiTools['StockTools'] = StockTools;
} else {
    window.sbaiTools = {
        'StockTools': StockTools
    };
}

export { StockTools }; 