export const range = (from: number, to: number): number[] => {
  const delta = to - from;
  const step = delta > 0 ? 1 : -1;

  return Array.from(
    new Array(Math.abs(delta)),
    (_value, index) => from + index * step,
  );
};

export const bigintRange = (from: bigint, to: bigint): bigint[] => {
  const delta = to - from;
  const step = delta > 0n ? 1n : -1n;
  return Array.from(
    new Array((delta < 0n? Number(delta * -1n): Number(delta))),
    (_value, index) => from + BigInt(index) * step,
  );
};
