// from https://eth2book.info/bellatrix/part2/incentives/rewards/
import { BigNumber } from '@ethersproject/bignumber';

const SYNC_REWARD_WEIGHT = 2;
const WEIGHT_DENOMINATOR = 64;

export const SYNC_COMMITTEE_SIZE = 512;

export const syncReward = (
  t: BigNumber, // Total validators increments (effective eths)
  b: number, // Base reward per increment
) => {
  // per synced slot
  return t
    .mul(SYNC_REWARD_WEIGHT)
    .mul(b)
    .div(32 * SYNC_COMMITTEE_SIZE * WEIGHT_DENOMINATOR);
};
