import React from 'react';
import { createRoot } from 'react-dom/client';
import { SplunkThemeProvider } from '@splunk/themes';
import { App } from './App';
import './ui/page.css';

function Root(): React.ReactElement {
    return (
        <SplunkThemeProvider family="prisma" colorScheme="light" density="comfortable">
            <App />
        </SplunkThemeProvider>
    );
}

function fitWorkspace(node: HTMLElement): void {
    const top = Math.max(0, node.getBoundingClientRect().top);
    node.style.height = `${Math.max(320, window.innerHeight - top)}px`;
}

function mount(attempt = 0): void {
    const node = document.getElementById('root');
    if (!node) {
        if (attempt < 100) {
            window.setTimeout(() => mount(attempt + 1), 50);
        }
        return;
    }
    if (node.dataset.mxMounted === '1') {
        return;
    }
    node.dataset.mxMounted = '1';
    fitWorkspace(node);
    window.addEventListener('resize', () => fitWorkspace(node));
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    createRoot(node).render(<Root />);
}

mount();
