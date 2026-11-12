const path = require('path');
const { merge } = require('webpack-merge');
const { create } = require('@splunk/webpack-configs/base.config');

const config = merge(create({ babelTypescript: true }), {
    entry: {
        explorer: path.resolve(__dirname, 'src/index.tsx'),
    },
    output: {
        path: path.resolve(__dirname, 'build/appserver/static/build'),
        filename: '[name].js',
        chunkFilename: '[name].js',
        publicPath: '/static/app/metric_explorer_ng/build/',
        clean: true,
    },
    optimization: {
        splitChunks: false,
        runtimeChunk: false,
    },
});

// The Splunk base config still sets webpack-4 node polyfills. Webpack 5 rejects them.
delete config.node;

module.exports = config;
