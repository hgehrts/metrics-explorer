import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { splunkDelete, splunkGet } from '../api/splunkd';
import { t } from '../i18n';
import { readRecent, RecentEntry } from '../model/recent';
import { parseSession, sessionKey } from '../model/session';

type SavedWorkspace = { key: string; name: string; updated: string };

const Page = styled.main`
    box-sizing: border-box;
    height: 100%;
    overflow: auto;
    padding: 24px 28px 40px;
    background: ${variables.backgroundColor};
    color: ${variables.contentColorDefault};
    font-family: ${variables.fontFamily};
    font-size: ${variables.fontSize};
    line-height: ${variables.lineHeight};

    button {
        font-family: inherit;
        font-size: inherit;
    }
`;

const Heading = styled.h1`
    margin: 0 0 16px;
    font-size: 20px;
    font-weight: 600;
`;

const Section = styled.section`
    margin: 0 0 24px;
`;

const Title = styled.h2`
    margin: 0 0 8px;
    font-size: ${variables.fontSizeLarge};
    font-weight: 600;
`;

const List = styled.div`
    display: flex;
    flex-direction: column;
    border: 1px solid ${variables.neutral200};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
`;

const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid ${variables.neutral200};

    &:first-child {
        border-top: 0;
    }
`;

const Name = styled.button`
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: ${variables.contentColorActive};
    text-align: left;
    cursor: pointer;
`;

const Quiet = styled.button`
    border: 0;
    background: transparent;
    color: ${variables.contentColorMuted};
    font-size: 12px;
    cursor: pointer;
`;

const Note = styled.p`
    margin: 0;
    padding: 10px 12px;
    color: ${variables.contentColorMuted};
    font-size: 12px;
`;

function userName(): string {
    return (window as unknown as { $C?: { USERNAME?: string } }).$C?.USERNAME ?? '';
}

function explorerHref(query: string): string {
    const locale = window.location.pathname.split('/').filter(Boolean)[0] || 'en-US';
    return `/${locale}/app/metric_explorer_ng/explorer?${query}`;
}

function savedFrom(body: unknown): SavedWorkspace[] {
    if (!Array.isArray(body)) {
        return [];
    }
    return body
        .flatMap((item) => {
            if (!item || typeof item !== 'object') {
                return [];
            }
            const row = item as { _key?: unknown; name?: unknown; updated?: unknown };
            const key = typeof row._key === 'string' ? row._key : '';
            const name = typeof row.name === 'string' ? row.name.trim() : '';
            if (!key || !name) {
                return [];
            }
            return [{ key, name, updated: typeof row.updated === 'string' ? row.updated : '' }];
        })
        .sort((left, right) => right.updated.localeCompare(left.updated));
}

/** Saved workspaces, the always-present default, and the metrics opened most recently. */
export function WorkspacesPage(): React.ReactElement {
    const user = userName();
    const [saved, setSaved] = useState<SavedWorkspace[]>([]);
    const [recent, setRecent] = useState<RecentEntry[]>([]);
    const [error, setError] = useState('');
    const hasDefault = Boolean(parseSession(window.localStorage.getItem(sessionKey(user))));

    function reload(): void {
        setRecent(readRecent(user));
        splunkGet('storage/collections/data/mx_workspaces?limit=100')
            .then((body) => {
                setSaved(savedFrom(body));
                setError('');
            })
            .catch(() => setError(t('Search failed.')));
    }

    useEffect(() => {
        reload();
    }, []);

    return (
        <Page>
            <Heading>{t('Workspaces')}</Heading>
            <Section>
                <Title>{t('Default')}</Title>
                <List>
                    <Row>
                        <Name type="button" onClick={() => window.location.assign(explorerHref('workspace=default'))}>
                            {t('Default')}
                        </Name>
                        <span>{hasDefault ? t('The charts you are working on.') : t('No charts yet.')}</span>
                    </Row>
                </List>
            </Section>
            <Section>
                <Title>{t('Recent')}</Title>
                <List>
                    {recent.length === 0 ? <Note>{t('No recent charts.')}</Note> : null}
                    {recent.map((item) => (
                        <Row key={item.id}>
                            <Name type="button" onClick={() => window.location.assign(explorerHref(`recent=${encodeURIComponent(item.id)}`))}>
                                {item.name}
                            </Name>
                        </Row>
                    ))}
                </List>
            </Section>
            <Section>
                <Title>{t('Saved workspaces')}</Title>
                {error ? <Note role="alert">{error}</Note> : null}
                <List>
                    {saved.length === 0 ? <Note>{t('No saved workspaces.')}</Note> : null}
                    {saved.map((item) => (
                        <Row key={item.key}>
                            <Name type="button" onClick={() => window.location.assign(explorerHref(`workspace=${encodeURIComponent(item.key)}`))}>
                                {item.name}
                            </Name>
                            <Quiet
                                type="button"
                                aria-label={`${t('Delete')} ${item.name}`}
                                onClick={() => {
                                    void splunkDelete(`storage/collections/data/mx_workspaces/${encodeURIComponent(item.key)}`).then(reload);
                                }}
                            >
                                {t('Delete')}
                            </Quiet>
                        </Row>
                    ))}
                </List>
            </Section>
        </Page>
    );
}
