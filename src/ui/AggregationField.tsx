import React from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { aggregationMenu, SeriesSource } from '../spl/functions';
import { t } from '../i18n';
import { DropdownMenu, MenuHeading, MenuItem } from './Menu';

const Row = styled.div`
    display: flex;
    gap: 4px;
    align-items: center;
`;

const Input = styled.input`
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px 8px;
    font-family: inherit;
    font-size: ${variables.fontSize};
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const Opener = styled.button`
    flex: 0 0 auto;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    cursor: pointer;
`;

/** A typed aggregation, plus a menu of every function. The native datalist only showed a short filtered slice. */
export function AggregationField(props: {
    source: SeriesSource;
    value: string;
    categorical: boolean;
    onChange: (value: string) => void;
    label: string;
}): React.ReactElement {
    const groups = aggregationMenu(props.source, props.categorical);
    return (
        <Row>
            <Input
                aria-label={props.label}
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
            />
            <DropdownMenu
                alignRight
                label={props.label}
                trigger={(_open, toggle) => (
                    <Opener type="button" aria-label={t('Show all aggregations')} onClick={toggle}>
                        ▾
                    </Opener>
                )}
            >
                {(close) =>
                    groups.map((group) => (
                        <React.Fragment key={group.group}>
                            <MenuHeading>{t(group.label)}</MenuHeading>
                            {group.items.map((item) => (
                                <MenuItem
                                    key={item.name}
                                    $checked={props.value === item.label}
                                    onClick={() => {
                                        props.onChange(item.label);
                                        close();
                                    }}
                                >
                                    {item.label}
                                </MenuItem>
                            ))}
                        </React.Fragment>
                    ))
                }
            </DropdownMenu>
        </Row>
    );
}
