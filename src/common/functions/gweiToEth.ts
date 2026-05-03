export function gweiToEth(num: bigint): number {
  const val = Number(num / 10000n);
  const rounded = Math.round(val / 10);
  return rounded / 10000;
}
