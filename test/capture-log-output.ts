/** winston's Console transport writes to console._stdout — under jest that is jest's own stream,
 * not process.stdout — and falls back to console.log when there is none. */
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
