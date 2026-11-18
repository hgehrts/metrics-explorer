/** Chart title line: comma-separated series, formulas, and optional AS labels. Never executed as SPL. */

const IDENTIFIER = /^[A-Za-z0-9_.:-]+$/;
const NUMBER = /^\d+(?:\.\d+)?/;

export type TitlePart = {
    kind: 'metric' | 'calc';
    /** Canonical metric name or formula, without AS. */
    text: string;
    metrics: string[];
    /** Eval expression using m1, m2, … Empty for a plain metric. */
    evalExpr: string;
    label?: string;
};

type Expr =
    | { kind: 'metric'; name: string }
    | { kind: 'number'; value: string }
    | { kind: 'unary'; inner: Expr }
    | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

export class TitleParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TitleParseError';
    }
}

function fail(message: string): never {
    throw new TitleParseError(message);
}

function lastSegment(name: string): string {
    const parts = name.split('.');
    return parts[parts.length - 1] ?? name;
}

function suggestions(token: string, catalog: string[]): string {
    const lower = token.toLowerCase();
    const hits = catalog.filter((name) => name.toLowerCase().includes(lower)).slice(0, 3);
    return hits.length > 0 ? ` Did you mean ${hits.join(', ')}?` : '';
}

class Parser {
    private readonly catalog: string[];
    private readonly shorts: Map<string, string[]>;
    private i = 0;

    constructor(
        private readonly text: string,
        catalog: string[]
    ) {
        this.catalog = [...new Set(catalog.filter((name) => IDENTIFIER.test(name)))].sort(
            (left, right) => right.length - left.length
        );
        this.shorts = new Map();
        for (const name of this.catalog) {
            const short = lastSegment(name);
            const list = this.shorts.get(short) ?? [];
            list.push(name);
            this.shorts.set(short, list);
        }
    }

    parseLine(): TitlePart[] {
        this.skipWs();
        if (this.i >= this.text.length) {
            fail('Enter a metric name or a formula.');
        }
        const parts = [this.parsePart()];
        while (this.peek() === ',') {
            this.i += 1;
            this.skipWs();
            if (this.i >= this.text.length || this.peek() === ',') {
                fail('Enter a metric name or a formula.');
            }
            parts.push(this.parsePart());
        }
        this.skipWs();
        if (this.i < this.text.length) {
            fail('Unexpected character.');
        }
        return parts;
    }

    private parsePart(): TitlePart {
        const expr = this.parseExpr();
        this.skipWs();
        let label: string | undefined;
        if (this.keyword('AS')) {
            this.skipWs();
            const comma = this.text.indexOf(',', this.i);
            const raw = (comma < 0 ? this.text.slice(this.i) : this.text.slice(this.i, comma)).trim();
            if (!raw) {
                fail('Enter a name after AS.');
            }
            if (/[\r\n]/.test(raw) || raw.length > 80) {
                fail('That label is not allowed.');
            }
            label = raw;
            this.i = comma < 0 ? this.text.length : comma;
        }
        const metrics = uniqueMetrics(expr);
        if (metrics.length === 0) {
            fail('A formula needs a metric.');
        }
        const calc = expr.kind !== 'metric';
        if (calc) {
            return {
                kind: 'calc',
                text: printExpr(expr),
                metrics,
                evalExpr: compileExpr(expr, aliasesFor(metrics)),
                ...(label ? { label } : {}),
            };
        }
        return { kind: 'metric', text: metrics[0], metrics, evalExpr: '', ...(label ? { label } : {}) };
    }

    private parseExpr(): Expr {
        let left = this.parseTerm();
        for (;;) {
            this.skipWs();
            const op = this.peek();
            if (op !== '+' && op !== '-') {
                return left;
            }
            this.i += 1;
            left = { kind: 'binary', op, left, right: this.parseTerm() };
        }
    }

    private parseTerm(): Expr {
        let left = this.parseFactor();
        for (;;) {
            this.skipWs();
            const op = this.peek();
            if (op !== '*' && op !== '/') {
                return left;
            }
            this.i += 1;
            left = { kind: 'binary', op, left, right: this.parseFactor() };
        }
    }

    private parseFactor(): Expr {
        this.skipWs();
        if (this.peek() === '(') {
            this.i += 1;
            const inner = this.parseExpr();
            this.skipWs();
            if (this.peek() !== ')') {
                fail('This formula has unbalanced parentheses.');
            }
            this.i += 1;
            return inner;
        }
        if (this.peek() === '-') {
            this.i += 1;
            return { kind: 'unary', inner: this.parseFactor() };
        }
        const number = NUMBER.exec(this.text.slice(this.i));
        if (number) {
            this.i += number[0].length;
            return { kind: 'number', value: number[0] };
        }
        return { kind: 'metric', name: this.metric() };
    }

    private metric(): string {
        this.skipWs();
        if (this.peek() === '"') {
            return this.quoted();
        }
        const catalogHit = this.catalogMatch();
        if (catalogHit) {
            return catalogHit;
        }
        const greedy = this.greedyIdent();
        if (!greedy) {
            fail('Enter a metric name or a formula.');
        }
        if (!IDENTIFIER.test(greedy)) {
            fail('Metric name is not allowed.');
        }
        if (this.catalog.length === 0) {
            return greedy;
        }
        if (this.catalog.includes(greedy)) {
            return greedy;
        }
        const shorts = this.shorts.get(greedy) ?? [];
        if (shorts.length === 1) {
            return shorts[0];
        }
        if (shorts.length > 1) {
            fail(`"${greedy}" matches more than one metric: ${shorts.slice(0, 5).join(', ')}.`);
        }
        fail(`Unknown metric "${greedy}".${suggestions(greedy, this.catalog)}`);
    }

    private quoted(): string {
        this.i += 1;
        let name = '';
        while (this.i < this.text.length) {
            const ch = this.text[this.i];
            if (ch === '"') {
                this.i += 1;
                if (!name) {
                    fail('Enter a metric name or a formula.');
                }
                if (!IDENTIFIER.test(name)) {
                    fail('Metric name is not allowed.');
                }
                if (this.catalog.length > 0 && !this.catalog.includes(name) && (this.shorts.get(name) ?? []).length === 0) {
                    fail(`Unknown metric "${name}".${suggestions(name, this.catalog)}`);
                }
                const shorts = this.shorts.get(name) ?? [];
                if (!this.catalog.includes(name) && shorts.length === 1) {
                    return shorts[0];
                }
                if (!this.catalog.includes(name) && shorts.length > 1) {
                    fail(`"${name}" matches more than one metric: ${shorts.slice(0, 5).join(', ')}.`);
                }
                return name;
            }
            if (ch === '\n' || ch === '\r') {
                fail('Line breaks are not allowed.');
            }
            name += ch;
            this.i += 1;
        }
        fail('This formula has unbalanced quotes.');
    }

    private catalogMatch(): string | null {
        const rest = this.text.slice(this.i);
        for (const name of this.catalog) {
            if (!rest.startsWith(name)) {
                continue;
            }
            const next = rest[name.length];
            if (next && /[A-Za-z0-9_.:-]/.test(next)) {
                continue;
            }
            this.i += name.length;
            return name;
        }
        return null;
    }

    private greedyIdent(): string {
        const match = /^[A-Za-z0-9_.:-]+/.exec(this.text.slice(this.i));
        if (!match) {
            return '';
        }
        this.i += match[0].length;
        return match[0];
    }

    private keyword(word: string): boolean {
        const rest = this.text.slice(this.i);
        if (!rest.toUpperCase().startsWith(word.toUpperCase())) {
            return false;
        }
        const next = rest[word.length];
        if (next && /[A-Za-z0-9_]/.test(next)) {
            return false;
        }
        this.i += word.length;
        return true;
    }

    private skipWs(): void {
        while (this.i < this.text.length && /[ \t]/.test(this.text[this.i])) {
            this.i += 1;
        }
    }

    private peek(): string {
        return this.text[this.i] ?? '';
    }
}

function uniqueMetrics(expr: Expr): string[] {
    const names: string[] = [];
    walk(expr, (node) => {
        if (node.kind === 'metric' && !names.includes(node.name)) {
            names.push(node.name);
        }
    });
    return names;
}

function walk(expr: Expr, visit: (node: Expr) => void): void {
    visit(expr);
    if (expr.kind === 'unary') {
        walk(expr.inner, visit);
    } else if (expr.kind === 'binary') {
        walk(expr.left, visit);
        walk(expr.right, visit);
    }
}

function aliasesFor(metrics: string[]): Map<string, string> {
    return new Map(metrics.map((name, index) => [name, `m${index + 1}`]));
}

function compileExpr(expr: Expr, aliases: Map<string, string>): string {
    switch (expr.kind) {
        case 'number':
            return expr.value;
        case 'metric':
            return aliases.get(expr.name) ?? fail('Formula is not allowed.');
        case 'unary':
            return `-(${compileExpr(expr.inner, aliases)})`;
        case 'binary': {
            const left = compileExpr(expr.left, aliases);
            const right = compileExpr(expr.right, aliases);
            if (expr.op === '/') {
                return `if((${right})==0,null(),(${left})/(${right}))`;
            }
            return `(${left})${expr.op}(${right})`;
        }
        default:
            return fail('Formula is not allowed.');
    }
}

function printExpr(expr: Expr): string {
    switch (expr.kind) {
        case 'number':
            return expr.value;
        case 'metric':
            return expr.name;
        case 'unary':
            return `-${printExpr(expr.inner)}`;
        case 'binary':
            return `(${printExpr(expr.left)} ${expr.op} ${printExpr(expr.right)})`;
        default:
            return fail('Formula is not allowed.');
    }
}

/** Parses the title row into series. `catalog` resolves short names and rejects unknown metrics. */
export function parseTitleLine(text: string, catalog: string[] = []): TitlePart[] {
    if (/[\r\n]/.test(text)) {
        fail('Line breaks are not allowed.');
    }
    return new Parser(text.trim(), catalog).parseLine();
}

/** Operand metric names of a stored formula. Unknown text returns an empty list. */
export function formulaMetrics(formula: string, catalog: string[] = []): string[] {
    try {
        return parseTitleLine(formula, catalog).flatMap((part) => part.metrics);
    } catch {
        return [];
    }
}

const SAFE_EVAL = /^(?:m[1-9]\d*|if|null|==|\d+(?:\.\d+)?|[+\-*/(),\s])+$/;

/** Rejects an eval expression that is not the parser's own output. */
export function assertEvalExpr(expr: string, metricCount: number): void {
    if (!expr || !SAFE_EVAL.test(expr)) {
        fail('Formula is not allowed.');
    }
    const used = [...expr.matchAll(/\bm([1-9]\d*)\b/g)].map((match) => Number(match[1]));
    if (used.some((index) => index > metricCount)) {
        fail('Formula is not allowed.');
    }
}
