import { timechartProblem } from '../src/chart/timechartShape';

test('an empty window is still a time chart', () => {
    expect(timechartProblem([])).toBe('');
});

test('time and a number can be drawn', () => {
    expect(timechartProblem([{ _time: 1, count: '3', sum_bytes: 8 }])).toBe('');
});

test('rows without time or without a number are not a time chart', () => {
    expect(timechartProblem([{ host: 'a', count: 1 }])).toBe('This search does not return a time chart.');
    expect(timechartProblem([{ _time: 1, host: 'a' }])).toBe('This search does not return a time chart.');
    expect(timechartProblem([{ _time: 1, _span: 60 }])).toBe('This search does not return a time chart.');
});
