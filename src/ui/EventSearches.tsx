import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { splunkDelete, splunkGet, splunkPostJson } from '../api/splunkd';
import { t } from '../i18n';
import { eventSearchNameOk, eventSearchesFrom, SavedEventSearch, savedSearchSpl, searchesByApp, AppSearchGroup } from '../model/eventSearches';
import { matchesQuery } from '../catalog/metricTree';

const Block = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 12px 8px;
`;

const Label = styled.div`
    color: ${variables.contentColorMuted};
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
`;

const Input = styled.input`
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const Area = styled.textarea`
    min-height: 72px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    resize: vertical;
`;

const Row = styled.div`
    display: flex;
    gap: 8px;
    align-items: center;
`;

const Item = styled.button`
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 4px 12px;
    color: ${variables.contentColorDefault};
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
    color: ${variables.contentColorMuted};
    font-size: 12px;
`;

const Check = styled.label`
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: ${variables.contentColorDefault};
`;

/** Named SPL kept in the app, and optionally saved searches from other apps. */
export function EventSearches(props: { open: boolean; query: string; onOpen: (name: string, spl: string) => void }): React.ReactElement | null {
    const [saved, setSaved] = useState<SavedEventSearch[]>([]);
    const [name, setName] = useState('');
    const [spl, setSpl] = useState('');
    const [editing, setEditing] = useState('');
    const [error, setError] = useState('');
    const [showOthers, setShowOthers] = useState(false);
    const [others, setOthers] = useState<AppSearchGroup[]>([]);
    const [othersError, setOthersError] = useState('');

    function reload(): void {
        splunkGet('storage/collections/data/mx_event_searches?limit=200')
            .then((body) => setSaved(eventSearchesFrom(body)))
            .catch(() => setSaved([]));
    }

    useEffect(() => {
        if (!props.open) {
            return;
        }
        reload();
    }, [props.open]);

    useEffect(() => {
        if (!props.open || !showOthers) {
            return;
        }
        let alive = true;
        splunkGet('saved/searches?count=-1')
            .then((body) => {
                if (alive) {
                    setOthers(searchesByApp(body, 'metric_explorer_ng'));
                    setOthersError('');
                }
            })
            .catch(() => {
                if (alive) {
                    setOthers([]);
                    setOthersError(t('Search failed.'));
                }
            });
        return () => {
            alive = false;
        };
    }, [props.open, showOthers]);

    if (!props.open) {
        return null;
    }

    const shown = saved.filter((item) => matchesQuery(item.name, props.query));

    async function save(): Promise<void> {
        const nextName = name.trim();
        const nextSpl = spl.trim();
        if (!eventSearchNameOk(nextName)) {
            setError(t('Name is not allowed.'));
            return;
        }
        if (!nextSpl) {
            setError(t('Search is empty.'));
            return;
        }
        setError('');
        try {
            if (editing) {
                await splunkPostJson(`storage/collections/data/mx_event_searches/${encodeURIComponent(editing)}`, {
                    _key: editing,
                    name: nextName,
                    spl: nextSpl,
                });
            } else {
                await splunkPostJson('storage/collections/data/mx_event_searches', { name: nextName, spl: nextSpl });
            }
            setName('');
            setSpl('');
            setEditing('');
            reload();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : t('The search cannot be stored.'));
        }
    }

    return (
        <>
            <Block>
                <Label>{t('Saved in this app')}</Label>
                <Input
                    aria-label={t('Event search name')}
                    value={name}
                    placeholder={t('Event search name')}
                    onChange={(event) => setName(event.target.value)}
                />
                <Area
                    aria-label={t('Event search')}
                    value={spl}
                    placeholder={t('A time chart, for example timechart count')}
                    onChange={(event) => setSpl(event.target.value)}
                />
                <Row>
                    <Quiet type="button" onClick={() => void save()}>
                        {editing ? t('Save event search') : t('Save event search')}
                    </Quiet>
                    {editing ? (
                        <Quiet
                            type="button"
                            onClick={() => {
                                setEditing('');
                                setName('');
                                setSpl('');
                                setError('');
                            }}
                        >
                            {t('Cancel')}
                        </Quiet>
                    ) : null}
                </Row>
                {error ? <Note role="alert">{error}</Note> : null}
            </Block>
            {shown.map((item) => (
                <Row key={item.key}>
                    <Item type="button" onClick={() => props.onOpen(item.name, item.spl)}>
                        {item.name}
                    </Item>
                    <Quiet
                        type="button"
                        aria-label={`${t('Edit')} ${item.name}`}
                        onClick={() => {
                            setEditing(item.key);
                            setName(item.name);
                            setSpl(item.spl);
                            setError('');
                        }}
                    >
                        {t('Edit')}
                    </Quiet>
                    <Quiet
                        type="button"
                        aria-label={`${t('Delete')} ${item.name}`}
                        onClick={() => {
                            void splunkDelete(`storage/collections/data/mx_event_searches/${encodeURIComponent(item.key)}`).then(reload);
                        }}
                    >
                        {t('Delete')}
                    </Quiet>
                </Row>
            ))}
            {shown.length === 0 ? (
                <Block>
                    <Note>{t('No saved event searches.')}</Note>
                </Block>
            ) : null}
            <Block>
                <Check>
                    <input
                        type="checkbox"
                        aria-label={t('Saved searches from other apps')}
                        checked={showOthers}
                        onChange={(event) => setShowOthers(event.target.checked)}
                    />
                    {t('Saved searches from other apps')}
                </Check>
                {othersError ? <Note role="alert">{othersError}</Note> : null}
            </Block>
            {showOthers
                ? others.map((group) => {
                      const names = group.searches.filter((item) => matchesQuery(item, props.query) || matchesQuery(group.app, props.query));
                      if (names.length === 0) {
                          return null;
                      }
                      return (
                          <React.Fragment key={group.app}>
                              <Block>
                                  <Label>{group.app}</Label>
                              </Block>
                              {names.map((item) => (
                                  <Item
                                      key={`${group.app}:${item}`}
                                      type="button"
                                      onClick={() => {
                                          try {
                                              props.onOpen(item, savedSearchSpl(item));
                                          } catch (caught) {
                                              setOthersError(caught instanceof Error ? caught.message : t('Search failed.'));
                                          }
                                      }}
                                  >
                                      {item}
                                  </Item>
                              ))}
                          </React.Fragment>
                      );
                  })
                : null}
        </>
    );
}
