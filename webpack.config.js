const path = require('path');

module.exports = {
  entry: {
    'carbon-commander': './src/carbon-commander.js',
    'service': './src/service.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-dist.js',
  },
  mode: 'production',
  //Dont do any minification or uglification or anything
  optimization: {
    minimize: false,
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: 'asset/source'
      }
    ]
  }
};