import pLimit                                          from 'p-limit';
import { JsonRpcBatchProvider }                        from '@ethersproject/providers';
import { inject, injectable, postConstruct }           from 'inversify';
import { Environment }                                 from '../environment/Environment';
import { NodeOperatorsAbi, NodeOperatorsAbi__factory } from '../generated';
import { range }                                       from '../common/utils/range';
import { NodeOpsAddresses }                            from './config';
import { NodeOperator }                                from './NodeOperator';
import { Key, KeyWithOperatorInfo }                    from './Key';
import { BigNumber }                                   from 'ethers';
import { ILogger }                                     from '../logger/ILogger';
import { rejectDelay }                                 from '../common/functions/rejectDelay';
import { performance }                                 from 'perf_hooks';
import { KeysIndexed }                                 from './KeysIndexed';
import { Prometheus }                                  from '../prometheus/Prometheus';

const cache = new Map<string, Key>();

@injectable()
export class NodeOperatorsContract {
  protected rpcUrls: string[];
  protected contractRPCs!: NodeOperatorsAbi[];
  protected operators!: NodeOperator[];

  protected usedKeys: Key[] = [];

  protected activeContractRPC = 0;

  public constructor(
    @inject(Environment) protected environment: Environment,
    @inject(ILogger) protected logger: ILogger,
    @inject(Prometheus) protected prometheus: Prometheus,
  ) {
    this.rpcUrls = [
      environment.ETH1_RPC_URL,
      environment.ETH1_RPC_URL_BACKUP || '',
    ].filter(val => val && val.toString().length > 0);
  }


  @postConstruct()
  public async initialize(): Promise<void> {
    this.logger.info(`Initializing NodeOperatorsContract network [${this.environment.ETH_NETWORK}]`);

    this.contractRPCs = this.rpcUrls.map(
      url => NodeOperatorsAbi__factory.connect(
        NodeOpsAddresses[this.environment.ETH_NETWORK],
        new JsonRpcBatchProvider(url, this.environment.ETH_NETWORK),
      )
    );
  }

  public async getOperatorIds(): Promise<number[]> {
    if (!this.operators || this.operators.length < 1) {
      this.operators = await this.getOperatorsInfo();
    }

    return this.operators.map(op => op.id);
  }

  public async getOperators(): Promise<NodeOperator[]> {
    if (!this.operators || this.operators.length < 1) {
      this.operators = await this.getOperatorsInfo();
    }

    return this.operators;
  }

  public async getAllKeysIndexed(): Promise<KeysIndexed> {
    return this.getOperatorsKeysIndexed()
      .catch(rejectDelay(this.environment.ETH1_RPC_RETRY_DELAY_MS))
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
      this.logger.info('Will not switch to next RPC url for ETH1. No backup RPC provided.');
      return;
    }
    this.activeContractRPC++;
    this.logger.info('Switched to next RPC url for ETH1');
  }

  protected async callWithRetry<T extends unknown>(callback: () => Promise<T>, retryCount = 3): Promise<T> {
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

    this.logger.info(`Concurrent limit [${this.environment.REGISTRY_CONCURRENCY_LIMIT}]`);

    const keys = new Map<string, KeyWithOperatorInfo>();

    for (let i = 0; i < this.operators.length; i++) {
      const startTime = performance.now();
      this.logger.info('Will fetch operator [%d] used keys [%d]',
        this.operators[i].id, Number(this.operators[i].usedSigningKeys));

      const keysByOperator: Key[] = await this.getUsedKeysByOperator(this.operators[i].id, this.operators[i].usedSigningKeys);

      this.logger.info('Fetched operator [%d] used keys [%d] time [%ds]',
        this.operators[i].id, keysByOperator.length, Math.floor((performance.now() - startTime) / 1000));

      for (const k of keysByOperator) {
        if (k.key) {
          keys.set(k.key, {...k, nos_id: this.operators[i].id, nos_name: this.operators[i].name});
        }
      }
    }

    this.logger.info('Total used keys fetched [%d]', keys.size);

    return keys;
  }

  protected async getUsedKeysByOperator(operatorId: number, usedSigningKeys: BigNumber): Promise<Key[]> {
    const max = usedSigningKeys.toNumber();
    const concurrencyLimit = pLimit(
      this.environment.REGISTRY_CONCURRENCY_LIMIT
    );

    return await Promise.all(
      range(0, max).map(async (id) => concurrencyLimit(async () => {
        const cacheKey = `${operatorId}-${id}`;

        if (cache.has(cacheKey)) {
          return <Key>cache.get(cacheKey);
        }

        const {key, depositSignature, used} =
          await this.callWithRetry(
            () => this.prometheus.trackELRequest(
              this.rpcUrls[this.activeContractRPC],
              'getSigningKey',
              () => this.contractRPC.getSigningKey(operatorId, id)
            )
          );

        if (used) {
          cache.set(cacheKey, {key, depositSignature, used, id});
        }

        return {key, depositSignature, used, id};
      })),
    );
  }

  protected async getOperatorsInfo(): Promise<NodeOperator[]> {
    const total = await this.callWithRetry(
      () => this.prometheus.trackELRequest(
        this.rpcUrls[this.activeContractRPC],
        'getNodeOperatorsCount',
        () => this.contractRPC.getNodeOperatorsCount()
      )
    );

    return await Promise.all(
      range(0, total.toNumber()).map(async (id) => {
        const {
          active,
          name,
          rewardAddress,
          stakingLimit,
          stoppedValidators,
          totalSigningKeys,
          usedSigningKeys,
        } = await this.callWithRetry(
          () => this.prometheus.trackELRequest(
            this.rpcUrls[this.activeContractRPC],
            'getNodeOperator',
            () => this.contractRPC.getNodeOperator(id, true)
          )
        );

        return {
          active,
          name,
          rewardAddress,
          stakingLimit,
          stoppedValidators,
          totalSigningKeys,
          usedSigningKeys,
          id
        };
      }),
    );
  }
}
