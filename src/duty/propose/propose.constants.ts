// from https://eth2book.info/bellatrix/part2/incentives/rewards/

export const PROPOSER_WEIGHT = 8n; // Wp
export const WEIGHT_DENOMINATOR = 64n; // W sigma

export const proposerAttPartReward = (
  r: bigint, // total rewards to the attesters in this block
) => {
  return (r * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);
};
