// wait for all promises to resolve and throws if any error occurs
export async function allSettled(values: Promise<any>[] | any[]): Promise<any[]> {
  const results = await Promise.allSettled(values);
  const failed = results.filter((r: PromiseSettledResult<any>) => r.status == 'rejected');
  if (failed.length > 0) {
    throw new global.AggregateError(
      failed.map((r: PromiseRejectedResult) => r.reason),
      failed.flatMap((r: any) => Array.from(r.reason.message, r.reason.stack || '')).join('\n'),
    );
  }

  return results.map((r: PromiseFulfilledResult<any>) => r.value);
}
