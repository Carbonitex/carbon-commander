const path = require('path');

module.exports = {
    mode: 'development',
    entry: {
        'carbon-commander': './src/chrome-carbonbar-page/carbon-commander.js',
        'test-bundle': './tests/RunAllTests.js'
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        library: {
            type: 'module'
        }
    },
    experiments: {
        outputModule: true
    },
    resolve: {
        extensions: ['.js'],
        alias: {
            'marked': path.resolve(__dirname, '../node_modules/marked/lib/marked.esm.js')
        }
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                type: 'asset/source'
            }
        ]
    },
    devtool: 'source-map'
}; 