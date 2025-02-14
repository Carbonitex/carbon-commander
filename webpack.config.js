const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'carbon-commander': './src/chrome-carbonbar-page/carbon-commander.js',
    'service': './src/chrome-extension/service.js',
    'chrome-serviceworker': './src/chrome-serviceworker/chrome-ai-service.js',
    'secure-messaging': './src/chrome-carbonbar-page/secure-messaging.js'
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    sourceMapFilename: '[name].js.map',
  },
  mode: 'development',
  //Dont do any minification or uglification or anything
  optimization: {
    minimize: false,
  },
  devtool: 'source-map',
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    hot: true,
    open: true,
    port: 9000,
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: 'asset/source'
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'src/chrome-carbonbar-page/carbon-commander.css', to: 'carbon-commander.css' }
      ],
    }),
  ]
};