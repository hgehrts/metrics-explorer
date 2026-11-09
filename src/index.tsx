import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SplunkThemeProvider } from '@splunk/themes';
import { createFetchInit } from '@splunk/splunk-utils/fetch';
import { App } from './App';
import { readPageTheme, readSplunkTheme, themeQuery, themeUrl } from './theme';
import './ui/page.css';

/** True when the browser is leaving this page so the Splunk chrome uses the user's theme. */
async function alignSplunkTheme(): Promise<boolean> {
    try {
        const response = await fetch('/splunkd/__raw/services/authentication/current-context?output_mode=json', createFetchInit());
        if (!response.ok) {
            return false;
        }
        const query = themeQuery(readSplunkTheme(await response.json()), readPageTheme(window));
        if (!query) {
            return false;
        }
        window.location.replace(themeUrl(window.location.href, query));
        return true;
    } catch {
        return false;
    }
}

function Root(): React.ReactElement {
    const [colorScheme] = useState(() => readPageTheme(window) ?? 'light');
    return (
        <SplunkThemeProvider family="prisma" colorScheme={colorScheme} density="comfortable">
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
    void alignSplunkTheme().then((redirecting) => {
        if (redirecting) {
            return;
        }
        fitWorkspace(node);
        window.addEventListener('resize', () => fitWorkspace(node));
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        createRoot(node).render(<Root />);
    });
}

mount();
