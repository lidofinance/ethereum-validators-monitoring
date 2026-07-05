export function gweiToEth(num: bigint, precision = 4): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > 5) {
    throw Error(`Precision must be integer between 0 and 5, got ${precision}`);
  }

  return gweiToEthBP(num) / 10 ** precision;
}

/**
 * Converts gwei to the integer representation of ETH with a certain number of decimal positions.
 */
export function gweiToEthBP(num: bigint, precision = 4): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > 5) {
    throw Error(`Precision must be integer between 0 and 5, got ${precision}`);
  }

  const decimalsToRemove = 10n ** BigInt(8 - precision);
  const val = Number(num / decimalsToRemove);
  return Math.round(val / 10);
}
