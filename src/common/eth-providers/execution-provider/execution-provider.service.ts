import { CHAINS } from '@lido-nestjs/constants';
import { SimpleFallbackJsonRpcBatchProvider } from '@lido-nestjs/execution';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ExecutionProviderService {
  constructor(protected readonly provider: SimpleFallbackJsonRpcBatchProvider) {}

  /**
   * Returns network name
   */
  public async getNetworkName(): Promise<string> {
    const network = await this.provider.getNetwork();
    const name = CHAINS[network.chainId]?.toLocaleLowerCase();
    return name || network.name;
  }

  /**
   * Returns current chain id
   */
  public async getChainId(): Promise<number> {
    const { chainId } = await this.provider.getNetwork();
    return chainId;
  }
}
