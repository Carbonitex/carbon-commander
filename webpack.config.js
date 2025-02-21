const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

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
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  optimization: {
    minimize: process.env.NODE_ENV === 'production',
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  },
  devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',
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
        { from: 'src/chrome-carbonbar-page/carbon-commander.css', to: 'carbon-commander.css' },
        { from: 'src/chrome-carbonbar-page/settings.css', to: 'settings.css' }
      ],
    }),
  ]
};