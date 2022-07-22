import pLimit from 'p-limit';
import { JsonRpcBatchProvider } from '@ethersproject/providers';
import { NodeOperatorsAbi, NodeOperatorsAbi__factory } from './generated';
import { NodeOpsAddresses } from './execution.constants';
import { BigNumber } from 'ethers';
import { performance } from 'perf_hooks';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from '../../common/config';
import { PrometheusService } from '../../common/prometheus';
import { rejectDelay } from '../../common/functions/rejectDelay';
import { range } from '../../common/functions/range';

const cache = new Map<string, Key>();

export type NodeOperator = {
  id: number;
  active: boolean;
  name: string;
  rewardAddress: string;
  stakingLimit: BigNumber;
  stoppedValidators: BigNumber;
  totalSigningKeys: BigNumber;
  usedSigningKeys: BigNumber;
};

export interface Operator {
  nos_id: number;
  nos_name: string;
}

export type Key = {
  id: number;
  key: string;
  depositSignature: string;
  used: boolean;
};

export type KeyWithOperatorInfo = Key & {
  nos_id: number;
  nos_name: string;
};

export type KeysIndexed = Map<string, KeyWithOperatorInfo>;

@Injectable()
export class NodeOperatorsContractService implements OnModuleInit {
  protected rpcUrls: string[];
  protected contractRPCs!: NodeOperatorsAbi[];
  protected operators!: NodeOperator[];

  protected activeContractRPC = 0;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {
    this.rpcUrls = [this.config.get('ETH1_RPC_URL'), this.config.get('ETH1_RPC_URL_BACKUP') || ''].filter(
      (val) => val && val.toString().length > 0,
    );
  }

  public async onModuleInit(): Promise<void> {
    const ethNetwork = this.config.get('ETH_NETWORK');
    this.logger.log(`Initializing NodeOperatorsContract network [${ethNetwork}]`);

    this.contractRPCs = this.rpcUrls.map((url) =>
      NodeOperatorsAbi__factory.connect(NodeOpsAddresses[ethNetwork], new JsonRpcBatchProvider(url, ethNetwork)),
    );
  }

  public async getOperatorIds(): Promise<number[]> {
    if (!this.operators || this.operators.length < 1) {
      this.operators = await this.getOperatorsInfo();
    }

    return this.operators.map((op) => op.id);
  }

  public async getOperators(): Promise<NodeOperator[]> {
    if (!this.operators || this.operators.length < 1) {
      this.operators = await this.getOperatorsInfo();
    }

    return this.operators;
  }

  public async getAllKeysIndexed(): Promise<KeysIndexed> {
    return this.getOperatorsKeysIndexed()
      .catch(rejectDelay(this.config.get('ETH1_RPC_RETRY_DELAY_MS')))
      .catch(() => this.getOperatorsKeysIndexed())
      .catch((e) => {
        this.logger.error('Error while doing ETH1 RPC request. Will try to switch to another RPC');
        this.logger.error(e);
        this.switchToNextContractRPC();
        throw e;
      })
      .catch(() => this.getOperatorsKeysIndexed());
  }

  protected get contractRPC(): NodeOperatorsAbi {
    // sanity check
    if (this.activeContractRPC > this.contractRPCs.length - 1) {
      this.activeContractRPC = 0;
    }

    return this.contractRPCs[this.activeContractRPC];
  }

  protected switchToNextContractRPC(): void {
    if (this.contractRPCs.length === 1) {
      this.logger.log('Will not switch to next RPC url for ETH1. No backup RPC provided.');
      return;
    }
    this.activeContractRPC++;
    this.logger.log('Switched to next RPC url for ETH1');
  }

  protected async callWithRetry<T>(callback: () => Promise<T>, retryCount = 3): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      const isTimeout = (error as any)?.code === 'TIMEOUT';
      if (!isTimeout) throw error;

      this.logger.warn('Fetch error. Retry', retryCount);

      if (retryCount <= 1) throw error;
      return await this.callWithRetry(callback, retryCount - 1);
    }
  }

  protected async getOperatorsKeysIndexed(): Promise<KeysIndexed> {
    this.operators = await this.getOperatorsInfo();

    this.logger.log(`Concurrent limit [${this.config.get('REGISTRY_CONCURRENCY_LIMIT')}]`);

    const keys = new Map<string, KeyWithOperatorInfo>();

    for (let i = 0; i < this.operators.length; i++) {
      const startTime = performance.now();
      this.logger.log(`Will fetch operator [${this.operators[i].id}] used keys [${Number(this.operators[i].usedSigningKeys)}]`);

      const keysByOperator: Key[] = await this.getUsedKeysByOperator(this.operators[i].id, this.operators[i].usedSigningKeys);

      this.logger.log(
        `Fetched operator [${this.operators[i].id}] used keys [${keysByOperator.length}] time [${Math.floor(
          (performance.now() - startTime) / 1000,
        )}s]`,
      );

      for (const k of keysByOperator) {
        if (k.key) {
          keys.set(k.key, {
            ...k,
            nos_id: this.operators[i].id,
            nos_name: this.operators[i].name,
          });
        }
      }
    }

    this.logger.log(`Total used keys fetched [${keys.size}]`);

    return keys;
  }

  protected async getUsedKeysByOperator(operatorId: number, usedSigningKeys: BigNumber): Promise<Key[]> {
    const max = usedSigningKeys.toNumber();
    const concurrencyLimit = pLimit(this.config.get('REGISTRY_CONCURRENCY_LIMIT'));

    return await Promise.all(
      range(0, max).map(async (id) =>
        concurrencyLimit(async () => {
          const cacheKey = `${operatorId}-${id}`;

          if (cache.has(cacheKey)) {
            return <Key>cache.get(cacheKey);
          }

          const { key, depositSignature, used } = await this.callWithRetry(() =>
            this.prometheus.trackELRequest(this.rpcUrls[this.activeContractRPC], 'getSigningKey', () =>
              this.contractRPC.getSigningKey(operatorId, id),
            ),
          );

          if (used) {
            cache.set(cacheKey, { key, depositSignature, used, id });
          }

          return { key, depositSignature, used, id };
        }),
      ),
    );
  }

  protected async getOperatorsInfo(): Promise<NodeOperator[]> {
    const total = await this.callWithRetry(() =>
      this.prometheus.trackELRequest(this.rpcUrls[this.activeContractRPC], 'getNodeOperatorsCount', () =>
        this.contractRPC.getNodeOperatorsCount(),
      ),
    );

    return await Promise.all(
      range(0, total.toNumber()).map(async (id) => {
        const { active, name, rewardAddress, stakingLimit, stoppedValidators, totalSigningKeys, usedSigningKeys } =
          await this.callWithRetry(() =>
            this.prometheus.trackELRequest(this.rpcUrls[this.activeContractRPC], 'getNodeOperator', () =>
              this.contractRPC.getNodeOperator(id, true),
            ),
          );

        return {
          active,
          name,
          rewardAddress,
          stakingLimit,
          stoppedValidators,
          totalSigningKeys,
          usedSigningKeys,
          id,
        };
      }),
    );
  }
}
