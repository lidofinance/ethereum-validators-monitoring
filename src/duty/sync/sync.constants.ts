// from https://eth2book.info/bellatrix/part2/incentives/rewards/
const SYNC_REWARD_WEIGHT = 2n;
const WEIGHT_DENOMINATOR = 64n;

export const SYNC_COMMITTEE_SIZE = 512;

export const syncReward = (
  t: bigint, // Total validators increments (effective eths)
  b: number, // Base reward per increment
) => {
  // per synced slot
  return (t * SYNC_REWARD_WEIGHT * BigInt(b)) / (32n * BigInt(SYNC_COMMITTEE_SIZE) * WEIGHT_DENOMINATOR);
};
