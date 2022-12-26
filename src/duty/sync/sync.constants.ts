// from https://eth2book.info/bellatrix/part2/incentives/rewards/
const SYNC_REWARD_WEIGHT = 2;
const WEIGHT_DENOMINATOR = 64;

export const SYNC_COMMITTEE_SIZE = 512;

export const syncReward = (
  t: bigint, // Total validators increments (effective eths)
  b: number, // Base reward per increment
) => {
  // per synced slot
  return (BigInt(SYNC_REWARD_WEIGHT) * t * BigInt(b)) / BigInt(32 * SYNC_COMMITTEE_SIZE * WEIGHT_DENOMINATOR);
};
