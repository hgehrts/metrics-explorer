import React, { useEffect } from 'react';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import { t } from '../i18n';

const Backdrop = styled.div`
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 16px;
    background: rgba(0, 0, 0, 0.35);
`;

const Box = styled.form<{ $width: number }>`
    display: flex;
    flex-direction: column;
    width: min(${(props) => props.$width}px, 100%);
    max-height: calc(100vh - 96px);
    border-radius: 4px;
    background: ${variables.backgroundColorDialog};
    color: ${variables.contentColorDefault};
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
`;

const Head = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid ${variables.neutral200};

    h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
    }
`;

const Body = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 20px;
    overflow: auto;
    font-size: 12px;
`;

const Foot = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid ${variables.neutral200};
`;

const Close = styled.button`
    border: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
`;

export const Button = styled.button<{ $primary?: boolean }>`
    padding: 6px 14px;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
    cursor: pointer;
    ${(props) =>
        props.$primary &&
        css`
            border-color: ${variables.accentColorPositive};
            background: ${variables.accentColorPositive};
            color: ${variables.contentColorInverted};
            font-weight: 600;
        `}
    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
`;

/** One labelled control in a dialog. The label sits left of the control, as in Splunk dialogs. */
export const FormRow = styled.div`
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 12px;
    align-items: start;

    > :first-child {
        padding-top: 6px;
        text-align: right;
        font-weight: 500;
    }
`;

export const Hint = styled.div`
    margin-top: 4px;
    color: ${variables.contentColorMuted};
    font-size: 11px;
`;

export const Inline = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
`;

export const Input = styled.input`
    padding: 5px 8px;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
    min-width: 0;
    box-sizing: border-box;
`;

export const Picker = styled.select`
    width: auto;
    max-width: 100%;
    padding: 5px 8px;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
`;

/** A modal dialog with a title, a close button, and footer buttons. Escape closes it. */
export function Modal(props: {
    title: string;
    width?: number;
    onClose: () => void;
    onSubmit?: () => void;
    footer: React.ReactNode;
    children: React.ReactNode;
}): React.ReactElement {
    const { onClose } = props;
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <Backdrop onMouseDown={props.onClose}>
            <Box
                role="dialog"
                aria-modal="true"
                aria-label={props.title}
                $width={props.width ?? 560}
                onMouseDown={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    props.onSubmit?.();
                }}
            >
                <Head>
                    <h1>{props.title}</h1>
                    <Close type="button" aria-label={t('Close')} onClick={props.onClose}>
                        ×
                    </Close>
                </Head>
                <Body>{props.children}</Body>
                <Foot>{props.footer}</Foot>
            </Box>
        </Backdrop>
    );
}
