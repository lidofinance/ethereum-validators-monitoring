// from https://eth2book.info/bellatrix/part2/incentives/rewards/
export const PROPOSER_WEIGHT = 8; // Wp
export const WEIGHT_DENOMINATOR = 64; // W sigma

export const proposerAttPartReward = (
  r: bigint, // total rewards to the attesters in this block
) => {
  return (BigInt(PROPOSER_WEIGHT) * r) / BigInt(WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);
};
