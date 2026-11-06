module.exports = {
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.[jt]sx?$': 'babel-jest',
    },
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/stage/', '/dist/', '/build/'],
};
