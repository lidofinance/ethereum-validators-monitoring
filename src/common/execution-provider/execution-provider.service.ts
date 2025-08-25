import { SimpleFallbackJsonRpcBatchProvider } from '@lido-nestjs/execution';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ExecutionProviderService {
  constructor(protected readonly provider: SimpleFallbackJsonRpcBatchProvider) {}

  public async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.provider.getBlock(blockNumber);
    return Number(block.timestamp);
  }
}
