import { ConsoleLogSink, LogFormat } from './console-log-sink';
import { LogRecord } from './log-sink';

function setup(format: LogFormat) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sink = new ConsoleLogSink(format, { write: (line: string) => stdout.push(line) } as never, { write: (line: string) => stderr.push(line) } as never);
  return { sink, stdout, stderr };
}

const record = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  time: '2026-11-09T12:00:00.000Z',
  level: 'log',
  context: 'PaymentSynchronizer',
  message: 'Payment p1: CREATED -> SUCCEEDED',
  ...overrides,
});

describe('ConsoleLogSink', () => {
  it('json: writes exactly one parseable object per line, with every field (what log platforms query)', () => {
    const { sink, stdout } = setup(LogFormat.Json);

    sink.write(record());

    expect(stdout).toHaveLength(1);
    expect(stdout[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(stdout[0])).toEqual(record());
  });

  it('json: a multi-line stack trace stays inside its one line', () => {
    const { sink, stderr } = setup(LogFormat.Json);

    sink.write(record({ level: 'error', stack: 'Error: x\n    at a\n    at b' }));

    expect(stderr[0].trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(stderr[0]).stack).toBe('Error: x\n    at a\n    at b');
  });

  it('text: one readable line with time, level and context', () => {
    const { sink, stdout } = setup(LogFormat.Text);

    sink.write(record());

    expect(stdout).toEqual(['2026-11-09T12:00:00.000Z LOG   [PaymentSynchronizer] Payment p1: CREATED -> SUCCEEDED\n']);
  });

  it('text: prints the stack under the line', () => {
    const { sink, stderr } = setup(LogFormat.Text);

    sink.write(record({ level: 'error', message: 'boom', stack: 'Error: boom\n    at a' }));

    expect(stderr[0]).toBe('2026-11-09T12:00:00.000Z ERROR [PaymentSynchronizer] boom\nError: boom\n    at a\n');
  });

  it.each([
    ['log', 'stdout'],
    ['debug', 'stdout'],
    ['warn', 'stderr'],
    ['error', 'stderr'],
    ['fatal', 'stderr'],
  ] as const)('sends %s to %s', (level, stream) => {
    const { sink, stdout, stderr } = setup(LogFormat.Text);

    sink.write(record({ level }));

    expect({ stdout: stdout.length, stderr: stderr.length }).toEqual(stream === 'stdout' ? { stdout: 1, stderr: 0 } : { stdout: 0, stderr: 1 });
  });
});
