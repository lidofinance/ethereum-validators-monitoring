import { SimpleFallbackJsonRpcBatchProvider } from '@lido-nestjs/execution';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ExecutionProviderService {
  constructor(protected readonly provider: SimpleFallbackJsonRpcBatchProvider) {}

  public async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.provider.getBlock(blockNumber);
    return Number(block.timestamp);
  }

  public async getBlockNumberByHash(blockHash: string): Promise<number> {
    const block = await this.provider.getBlock(blockHash);
    if (block == null) {
      throw new Error(`Execution layer block [${blockHash}] is not found`);
    }

    return Number(block.number);
  }
}
