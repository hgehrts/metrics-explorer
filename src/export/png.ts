/** Export scale. 2 keeps the text sharp on high-density screens. */
const SCALE = 2;
const PADDING = 16;
const TITLE_HEIGHT = 28;

/** The chart drawing is the largest svg inside the chart card. Menu icons and other small svgs are smaller. */
export function chartSvg(root: HTMLElement | null): SVGSVGElement | null {
    if (!root) {
        return null;
    }
    let best: SVGSVGElement | null = null;
    let bestArea = 0;
    root.querySelectorAll('svg').forEach((svg) => {
        const box = svg.getBoundingClientRect();
        if (box.width * box.height > bestArea) {
            best = svg as SVGSVGElement;
            bestArea = box.width * box.height;
        }
    });
    return best;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The chart could not be drawn for export.'));
        image.src = src;
    });
}

/** Draws the chart svg onto a white canvas with its title and returns a PNG blob. */
export async function chartPng(svg: SVGSVGElement, title: string): Promise<Blob> {
    const box = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const markup = new XMLSerializer().serializeToString(clone);
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);

    const canvas = document.createElement('canvas');
    canvas.width = (width + PADDING * 2) * SCALE;
    canvas.height = (height + PADDING * 2 + TITLE_HEIGHT) * SCALE;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('The canvas is not available in this browser.');
    }
    context.scale(SCALE, SCALE);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width / SCALE, canvas.height / SCALE);
    context.fillStyle = '#1e1e1e';
    context.font = '600 14px sans-serif';
    context.textBaseline = 'middle';
    context.fillText(title, PADDING, PADDING + TITLE_HEIGHT / 2, width);
    context.drawImage(image, PADDING, PADDING + TITLE_HEIGHT, width, height);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be created.'))), 'image/png');
    });
}

export function safeFileName(name: string): string {
    // Slashes are already replaced, so no path can escape the download folder. Leading dots would still hide the file.
    return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'chart';
}
