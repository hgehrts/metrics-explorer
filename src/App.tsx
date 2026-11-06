import React from 'react';
import Heading from '@splunk/react-ui/Heading';
import P from '@splunk/react-ui/Paragraph';
import { APP_TITLE } from './title';

export function App(): React.ReactElement {
    return (
        <main style={{ padding: 24 }}>
            <Heading level={1}>{APP_TITLE}</Heading>
            <P>Browse metric indexes without writing SPL.</P>
        </main>
    );
}
