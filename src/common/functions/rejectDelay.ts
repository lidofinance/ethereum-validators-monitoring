export const rejectDelay = (delayMs: number) => (err: any) => {
  return new Promise<never>(function (resolve, reject) {
    setTimeout(() => reject(err), delayMs);
  });
};
