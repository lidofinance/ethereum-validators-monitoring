export const range = (from: number, to: number): number[] => {
  const delta = to - from;
  const step = delta > 0 ? 1 : -1;

  return Array.from(new Array(Math.abs(delta)), (_value, index) => from + index * step);
};
