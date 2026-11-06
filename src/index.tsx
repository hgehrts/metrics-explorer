import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SplunkThemeProvider } from '@splunk/themes';
import { App } from './App';
import { ColorScheme, readSplunkTheme } from './theme';

const THEME_URL = '/en-US/splunkd/__raw/servicesNS/-/-/data/ui/prefs/general?output_mode=json';

function Root(): React.ReactElement {
    const [colorScheme, setColorScheme] = useState<ColorScheme>('light');

    useEffect(() => {
        let cancelled = false;
        fetch(THEME_URL, { credentials: 'same-origin' })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
                if (!cancelled && payload) {
                    setColorScheme(readSplunkTheme(payload));
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <SplunkThemeProvider family="prisma" colorScheme={colorScheme} density="comfortable">
            <App />
        </SplunkThemeProvider>
    );
}

const root = document.getElementById('root');
if (root) {
    createRoot(root).render(<Root />);
}
