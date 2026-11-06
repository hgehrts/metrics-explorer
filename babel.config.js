module.exports = {
    presets: [
        ['@babel/preset-env', { targets: { chrome: '110' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
    ],
};
