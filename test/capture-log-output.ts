/**
 * Everything the logger wrote during a test.
 *
 * winston's Console transport writes to console._stdout when the console has one — under jest that
 * is jest's own stream rather than process.stdout — and falls back to console.log when it does not.
 */
export function captureLogOutput(): { output: () => string; restore: () => void } {
  const written: string[] = [];
  const capture = (chunk: any) => {
    written.push(String(chunk));
    return true;
  };

  const streams = [(console as any)._stdout, (console as any)._stderr].filter(Boolean);
  const spies = [
    ...streams.map((stream: any) => jest.spyOn(stream, 'write').mockImplementation(capture)),
    jest.spyOn(console, 'log').mockImplementation(capture),
    jest.spyOn(console, 'error').mockImplementation(capture),
  ];

  return {
    output: () => written.join(''),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}
