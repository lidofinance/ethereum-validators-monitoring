import { BigNumber } from 'ethers';

export type NodeOperator = {
  id: number;
  active: boolean;
  name: string;
  rewardAddress: string;
  stakingLimit: BigNumber;
  stoppedValidators: BigNumber;
  totalSigningKeys: BigNumber;
  usedSigningKeys: BigNumber;
}
