import { BigNumber } from '@ethersproject/bignumber';

export function bigNumberSqrt(value: BigNumber): BigNumber {
  const x = BigNumber.from(value);
  let z = x.add(1).div(2);
  let y = BigNumber.from(x);
  while (z.sub(y).isNegative()) {
    y = z;
    z = x.div(z).add(z).div(2);
  }
  return y;
}
