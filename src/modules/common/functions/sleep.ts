export const sleep = (delayMs: number) => {
  return new Promise<void>(function(resolve) {
    setTimeout(() => resolve(), delayMs);
  });
}
