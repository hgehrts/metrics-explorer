import React, { useEffect, useRef, useState } from 'react';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';

const Anchor = styled.div<{ $right: boolean }>`
    position: relative;
    display: inline-flex;
    ${(props) =>
        props.$right &&
        css`
            margin-left: auto;
        `}
`;

/** Fixed to the window, so a scrolling stage or a chart card cannot clip it. */
const List = styled.div`
    position: fixed;
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    overflow: auto;
    padding: 4px 0;
    border: 1px solid ${variables.neutral200};
    border-radius: 4px;
    background: ${variables.backgroundColorPopup};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
`;

export const MenuHeading = styled.div`
    padding: 6px 12px 2px;
    color: ${variables.contentColorMuted};
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
`;

export const MenuItem = styled.button.attrs({ type: 'button', role: 'menuitem' })<{ $checked?: boolean }>`
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 12px 6px 28px;
    border: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    position: relative;
    ${(props) =>
        props.$checked &&
        css`
            &::before {
                content: '✓';
                position: absolute;
                left: 10px;
            }
        `}
    &:hover:not(:disabled),
    &:focus-visible {
        background: ${variables.interactiveColorOverlayHover};
        outline: none;
    }
    &:disabled {
        color: ${variables.contentColorDisabled};
        cursor: default;
    }
`;

/**
 * A button that opens a list below it. Clicking outside or pressing Escape closes it.
 * `children` gets a close function, so an item can close the menu after it ran.
 */
export function DropdownMenu(props: {
    trigger: (open: boolean, toggle: () => void) => React.ReactElement;
    children: (close: () => void) => React.ReactNode;
    alignRight?: boolean;
    pushRight?: boolean;
    label?: string;
}): React.ReactElement {
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<React.CSSProperties>({});
    const anchor = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open || !anchor.current) {
            return;
        }
        const box = anchor.current.getBoundingClientRect();
        const top = box.bottom + 4;
        setPlace({
            top,
            maxHeight: Math.max(160, Math.min(420, window.innerHeight - top - 8)),
            ...(props.alignRight ? { right: Math.max(4, window.innerWidth - box.right) } : { left: Math.max(4, box.left) }),
        });
    }, [open, props.alignRight]);
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onMove = (event: Event): void => {
            if (!(event.target instanceof Node && anchor.current?.contains(event.target))) {
                setOpen(false);
            }
        };
        const onDown = (event: MouseEvent): void => {
            if (anchor.current && !anchor.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onMove);
        document.addEventListener('scroll', onMove, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onMove);
            document.removeEventListener('scroll', onMove, true);
        };
    }, [open]);
    return (
        <Anchor ref={anchor} $right={Boolean(props.pushRight)}>
            {props.trigger(open, () => setOpen((current) => !current))}
            {open ? (
                <List role="menu" aria-label={props.label} style={place}>
                    {props.children(() => setOpen(false))}
                </List>
            ) : null}
        </Anchor>
    );
}
