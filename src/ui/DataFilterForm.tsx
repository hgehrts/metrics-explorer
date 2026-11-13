import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { t } from '../i18n';
import { buildCatalogValueSearch, DataFilter, dimensionFilter, validateFilter } from '../model/dataFilters';
import { collectFieldValues, runSearch } from '../search/runSearch';
import { Button, Hint, Input, Picker } from './Modal';

const Wrap = styled.form`
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1 1 auto;
`;

const Scroll = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 12px 12px;
    overflow: auto;
    font-size: ${variables.fontSize};
`;

const Title = styled.div`
    padding: 4px 12px 8px;
    font-size: ${variables.fontSize};

    strong {
        display: block;
        font-size: ${variables.fontSizeLarge};
    }
`;

const Section = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;

    > strong {
        font-size: ${variables.fontSize};
    }
`;

const Choices = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow: auto;
    padding: 4px 6px;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
`;

const DimRow = styled.div`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 52px 22px;
    gap: 4px;
    align-items: center;

    > input {
        grid-column: 1 / 3;
    }
`;

const Remove = styled.button`
    border: 0;
    background: transparent;
    color: ${variables.contentColorMuted};
    font-size: 15px;
    cursor: pointer;
`;

const Link = styled.button`
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: transparent;
    color: ${variables.contentColorActive};
    font-family: inherit;
    font-size: ${variables.fontSize};
    cursor: pointer;
`;

const Foot = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding: 10px 12px;
    border-top: 1px solid ${variables.neutral200};
`;

type Draft = { dimension: string; op: '=' | '!='; values: string };

function splitValues(text: string): string[] {
    return text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/** Values of the chosen dimension, offered while typing. Typed values may still use `*`. */
function ValueSuggestions(props: { id: string; dimension: string; filters: DataFilter[]; metricIndexes?: string[]; range: string }): React.ReactElement {
    const [values, setValues] = useState<string[]>([]);
    const filterKey = JSON.stringify(props.filters);
    useEffect(() => {
        setValues([]);
        if (!props.dimension) {
            return undefined;
        }
        try {
            return runSearch(
                buildCatalogValueSearch(props.dimension, props.filters, props.metricIndexes),
                props.range,
                (payload) => setValues(collectFieldValues(payload, props.dimension)),
                () => setValues([])
            );
        } catch {
            return undefined;
        }
    }, [props.dimension, filterKey, props.metricIndexes, props.range]);
    return (
        <datalist id={props.id}>
            {values.map((value) => (
                <option key={value} value={value} />
            ))}
        </datalist>
    );
}

/**
 * "Filter by indexes and other fields": index filters, then "dimension = value(s)" pairs.
 * The metric name patterns from the configuration stay as they are, so they can be reset separately.
 */
export function DataFilterForm(props: {
    filters: DataFilter[];
    indexes: string[];
    dimensions: string[];
    metricIndexes?: string[];
    range: string;
    onApply: (filters: DataFilter[]) => void;
    onCancel: () => void;
}): React.ReactElement {
    const [picked, setPicked] = useState<string[]>(() => props.filters.flatMap((item) => (item.kind === 'index' ? [item.value] : [])));
    const [rows, setRows] = useState<Draft[]>(() => {
        const existing = props.filters.flatMap((item) =>
            item.kind === 'dimension' ? [{ dimension: item.dimension, op: item.op, values: item.values.join(', ') }] : []
        );
        return existing.length > 0 ? existing : [{ dimension: '', op: '=', values: '' }];
    });
    const [error, setError] = useState('');
    const indexFilters: DataFilter[] = picked.map((value) => ({ kind: 'index', value }));
    const indexChoices = [...new Set([...props.indexes, ...picked])].sort();

    function apply(): void {
        const dims = rows.filter((row) => row.dimension || row.values.trim());
        const built = dims.map((row) => dimensionFilter(row.dimension, row.op, splitValues(row.values)));
        const problem = built.map(validateFilter).find((item) => item !== null);
        if (problem) {
            setError(t(problem));
            return;
        }
        const keep = props.filters.filter((item) => item.kind === 'exclude');
        props.onApply([...indexFilters, ...built, ...keep]);
    }

    function patch(index: number, next: Partial<Draft>): void {
        setRows((current) => current.map((row, position) => (position === index ? { ...row, ...next } : row)));
    }

    return (
        <Wrap
            aria-label={t('Filter by indexes and other fields')}
            onSubmit={(event) => {
                event.preventDefault();
                apply();
            }}
        >
            <Title>
                <strong>{t('Filter by indexes and other fields')}</strong>
                {t('Create new filter')}
            </Title>
            <Scroll>
                <Section>
                    <strong>{t('Filter by index')}</strong>
                    <Hint>{t('Start by adding index filters.')}</Hint>
                    <Choices role="group" aria-label={t('Select index filters')}>
                        {indexChoices.length === 0 ? <span>{t('No metric indexes.')}</span> : null}
                        {indexChoices.map((name) => (
                            <label key={name}>
                                <input
                                    type="checkbox"
                                    checked={picked.includes(name)}
                                    onChange={(event) =>
                                        setPicked((current) => (event.target.checked ? [...current, name] : current.filter((item) => item !== name)))
                                    }
                                />{' '}
                                {name}
                            </label>
                        ))}
                    </Choices>
                </Section>
                <Section>
                    <strong>{t('Filter by other fields')}</strong>
                    <Hint>{t('Use "dimension = value(s)" pairs to filter the data further, e.g.: ip=10.1*, 10.2*')}</Hint>
                    {rows.map((row, index) => (
                        <DimRow key={index}>
                            <Picker aria-label={t('Select dimension')} value={row.dimension} onChange={(event) => patch(index, { dimension: event.target.value })}>
                                <option value="">{t('Select dimension')}</option>
                                {[...new Set([...(row.dimension ? [row.dimension] : []), ...props.dimensions])].map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Picker>
                            <Picker aria-label={t('Operator')} value={row.op} onChange={(event) => patch(index, { op: event.target.value === '!=' ? '!=' : '=' })}>
                                <option value="=">=</option>
                                <option value="!=">!=</option>
                            </Picker>
                            <Remove
                                type="button"
                                aria-label={t('Remove dimension filter')}
                                onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
                            >
                                ×
                            </Remove>
                            <Input
                                aria-label={t('Select dimension values')}
                                placeholder={t('Values, comma separated')}
                                list={`mx-dim-values-${index}`}
                                disabled={!row.dimension}
                                value={row.values}
                                onChange={(event) => patch(index, { values: event.target.value })}
                            />
                            <ValueSuggestions
                                id={`mx-dim-values-${index}`}
                                dimension={row.dimension}
                                filters={indexFilters}
                                metricIndexes={props.metricIndexes}
                                range={props.range}
                            />
                        </DimRow>
                    ))}
                    <Link type="button" onClick={() => setRows((current) => [...current, { dimension: '', op: '=', values: '' }])}>
                        {t('+ Add dimension filter')}
                    </Link>
                </Section>
                {error ? <span role="alert">{error}</span> : null}
            </Scroll>
            <Foot>
                <Button type="button" onClick={props.onCancel}>
                    {t('Cancel')}
                </Button>
                <Button type="submit" $primary>
                    {t('Apply')}
                </Button>
            </Foot>
        </Wrap>
    );
}
