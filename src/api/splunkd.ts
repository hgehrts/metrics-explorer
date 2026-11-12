import { createFetchInit, findErrorMessage } from '@splunk/splunk-utils/fetch';
import { createRESTURL } from '@splunk/splunk-utils/url';

function endpoint(path: string, owner = 'nobody'): string {
    const url = createRESTURL(path.replace(/^\//, ''), { app: 'metric_explorer_ng', owner });
    return url.includes('?') ? `${url}&output_mode=json` : `${url}?output_mode=json`;
}

async function read(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function fail(body: unknown, status: number): Error {
    const message = body && typeof body === 'object' ? findErrorMessage(body as { messages?: { text: string; type: string }[] }) : undefined;
    return new Error(message?.text || `Splunk returned ${status}.`);
}

export async function splunkGet(path: string, owner = 'nobody'): Promise<unknown> {
    const response = await fetch(endpoint(path, owner), createFetchInit());
    const body = await read(response);
    if (!response.ok) {
        throw fail(body, response.status);
    }
    return body;
}

export async function splunkPost(path: string, fields: Record<string, string>, owner = 'nobody'): Promise<unknown> {
    const response = await fetch(
        endpoint(path, owner),
        createFetchInit({ method: 'POST', body: new URLSearchParams(fields) })
    );
    const body = await read(response);
    if (!response.ok) {
        throw fail(body, response.status);
    }
    return body;
}

export async function splunkPostJson(path: string, value: unknown, owner = 'nobody'): Promise<unknown> {
    const response = await fetch(
        endpoint(path, owner),
        createFetchInit({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
        })
    );
    const body = await read(response);
    if (!response.ok) {
        throw fail(body, response.status);
    }
    return body;
}

export async function splunkDelete(path: string, owner = 'nobody'): Promise<void> {
    const response = await fetch(endpoint(path, owner), createFetchInit({ method: 'DELETE' }));
    const body = await read(response);
    if (!response.ok && response.status !== 404) {
        throw fail(body, response.status);
    }
}

export function restEntries(body: unknown): Array<{ name: string; id: string; author: string; content: Record<string, unknown> }> {
    const entries = body && typeof body === 'object' && Array.isArray((body as { entry?: unknown }).entry) ? (body as { entry: unknown[] }).entry : [];
    return entries.flatMap((item) => {
        if (!item || typeof item !== 'object') {
            return [];
        }
        const record = item as { name?: unknown; id?: unknown; author?: unknown; content?: unknown };
        return [
            {
                name: typeof record.name === 'string' ? record.name : '',
                id: typeof record.id === 'string' ? record.id : '',
                author: typeof record.author === 'string' ? record.author : '',
                content: record.content && typeof record.content === 'object' ? (record.content as Record<string, unknown>) : {},
            },
        ];
    });
}
