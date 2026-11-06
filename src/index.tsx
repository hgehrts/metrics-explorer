import React from 'react';
import { createRoot } from 'react-dom/client';
import { SplunkThemeProvider } from '@splunk/themes';
import { App } from './App';

function Root(): React.ReactElement {
    return (
        <SplunkThemeProvider family="prisma" colorScheme="light" density="comfortable">
            <App />
        </SplunkThemeProvider>
    );
}

const root = document.getElementById('root');
if (root) {
    createRoot(root).render(<Root />);
}
