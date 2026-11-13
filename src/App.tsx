import React from 'react';
import { Explorer } from './ui/Explorer';
import { WorkspacesPage } from './ui/WorkspacesPage';

export function App(): React.ReactElement {
    const workspaces = window.location.pathname.split('/').includes('workspaces');
    return workspaces ? <WorkspacesPage /> : <Explorer />;
}
