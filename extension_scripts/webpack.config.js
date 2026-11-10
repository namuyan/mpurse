const webpack = require('webpack');
const path = require('path');
const glob = require('glob');

const entries = {};

glob.sync('./extension_scripts/**/*.ts', {}).map(file => {
  let key = file.replace(new RegExp(`^./extension_scripts/`), '');
  key = key.replace(new RegExp(`.ts$`), '');
  entries[key] = file;
});

module.exports = {
  mode: 'production',
  entry: entries,
  output: {
    path: path.join(__dirname, '../dist/mpurse/extension_scripts'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader'
      }
    ]
  },
  resolve: {
    modules: ['node_modules', path.resolve(__dirname, 'app')],
    extensions: ['.ts', '.js'],
    alias: {
      // bitcore-message requires bitcore-lib@^0.13, so `npm install` can place
      // a second copy under node_modules/bitcore-message/node_modules.
      // bitcore-lib v8 throws when loaded twice, which stops the service
      // worker from starting. Pin every import to the top-level copy.
      'bitcore-lib': path.resolve(__dirname, '../node_modules/bitcore-lib')
    }
  }
};
