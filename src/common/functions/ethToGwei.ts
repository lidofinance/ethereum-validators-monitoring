export function ethToGwei(num: number): bigint {
  const rounded = Math.round(num * 10000);
  return BigInt(rounded) * 100000n; // rounded * 1_000_000_000 / 10_000
}
