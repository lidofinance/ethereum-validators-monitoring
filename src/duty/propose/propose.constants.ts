// from https://eth2book.info/bellatrix/part2/incentives/rewards/
const PROPOSER_WEIGHT = 8; // Wp
const WEIGHT_DENOMINATOR = 64; // W sigma

export const proposerReward = (
  r: bigint, // total rewards to the attesters in this block
  ry: bigint, // total rewards to the sync committee in this block
) => {
  return (
    (BigInt(PROPOSER_WEIGHT) * r) / BigInt(WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) +
    (BigInt(PROPOSER_WEIGHT) * ry) / BigInt(WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)
  );
};
