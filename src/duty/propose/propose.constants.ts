// from https://eth2book.info/bellatrix/part2/incentives/rewards/
import { BigNumber } from '@ethersproject/bignumber';

export const PROPOSER_WEIGHT = 8; // Wp
export const WEIGHT_DENOMINATOR = 64; // W sigma

export const proposerAttPartReward = (
  r: BigNumber, // total rewards to the attesters in this block
) => {
  return r.mul(PROPOSER_WEIGHT).div(WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);
};
