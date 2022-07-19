import { inject, injectable, postConstruct } from 'inversify';
import { Environment }                       from '../environment/Environment';
import { ILogger }                           from '../logger/ILogger';
import * as client                           from 'prom-client';
import { join }                              from 'lodash';

export enum RequestStatus {
  COMPLETE = 'complete',
  ERROR = 'error',
}

export enum TaskStatus {
  COMPLETE = 'complete',
  ERROR = 'error',
}

export function requestLabels(rpcUrl: string, subUrl: string) {
  const targetName = new URL(rpcUrl).hostname;
  const reqName = join(subUrl.split('?')[0].split('/').map((p) => {
    if (p.includes('0x') || +p) return '{param}';
    return p;
  }), '/');
  return [targetName, reqName];
}

@injectable()
export class Prometheus {
  public slotTime: BigInt = 0n; // latest fetched slot time

  public outgoingELRequestsDuration!: client.Histogram<string>;
  public outgoingELRequestsCount!: client.Counter<string>;
  public outgoingCLRequestsDuration!: client.Histogram<string>;
  public outgoingCLRequestsCount!: client.Counter<string>;
  public taskDuration!: client.Histogram<string>;
  public taskCount!: client.Gauge<string>
  public validators!: client.Gauge<string>;
  public lidoValidators!: client.Gauge<string>;
  public validatorBalanceDelta!: client.Gauge<string>;
  public validatorQuantile001BalanceDelta!: client.Gauge<string>;
  public validatorsCountWithNegativeBalanceDelta!: client.Gauge<string>;
  public validatorsCountWithSyncParticipationLessAvg!: client.Gauge<string>;
  public validatorsCountMissAttestation!: client.Gauge<string>;
  public validatorsCountMissAttestationLastNEpoch!: client.Gauge<string>;
  public highRewardValidatorsCountMissAttestationLastNEpoch!: client.Gauge<string>;
  public validatorsCountMissPropose!: client.Gauge<string>;
  public highRewardValidatorsCountMissPropose!: client.Gauge<string>;
  public validatorsCountWithSyncParticipationLessAvgLastNEpoch!: client.Gauge<string>;
  public highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch!: client.Gauge<string>;
  public lidoSyncParticipationAvgPercent!: client.Gauge<string>;
  public chainSyncParticipationAvgPercent!: client.Gauge<string>;
  public totalBalance24hDifference!: client.Gauge<string>;
  public contractKeysTotal!: client.Gauge<string>;
  public bufferedEther!: client.Gauge<string>;
  public slotNumber!: client.Gauge<string>;
  public registry!: client.Registry;

  protected dataActuality!: client.Gauge<string>;
  protected fetchInterval!: client.Gauge<string>;
  protected syncParticipationDistanceDownFromChainAvg!: client.Gauge<string>;

  public constructor(
    @inject(Environment) protected environment: Environment,
    @inject(ILogger) protected logger: ILogger,
  ) {}

  @postConstruct()
  public async initialize(): Promise<void> {
    const getSlotTime = () => Number(this.slotTime) * 1000;
    const fetchIntervalEnv = Number(this.environment.FETCH_INTERVAL_SLOTS);
    const syncDistanceEnv = Number(this.environment.SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG);

    this.outgoingELRequestsDuration = new client.Histogram({
      name: 'outgoing_el_requests_duration_seconds',
      help: 'Duration of outgoing execution layer requests',
      buckets: [0.01, 0.1, 0.2, 0.5, 1, 1.5, 2, 5, 15],
      labelNames: ['name', 'target'] as const,
    });

    this.outgoingELRequestsCount = new client.Gauge({
      name: 'outgoing_el_requests_count',
      help: 'Count of outgoing execution layer requests',
      labelNames: ['name', 'target', 'status'] as const,
    });

    this.outgoingCLRequestsDuration = new client.Histogram({
      name: 'outgoing_cl_requests_duration_seconds',
      help: 'Duration of outgoing consensus layer requests',
      buckets: [0.01, 0.1, 0.2, 0.5, 1, 1.5, 2, 5, 15],
      labelNames: ['name', 'target'] as const,
    });

    this.outgoingCLRequestsCount = new client.Gauge({
      name: 'outgoing_cl_requests_count',
      help: 'Count of outgoing consensus layer requests',
      labelNames: ['name', 'target', 'status', 'code'] as const,
    });

    this.taskDuration = new client.Histogram({
      name: 'task_duration_seconds',
      help: 'Duration of task execution',
      buckets: [30, 60, 120, 180, 240, 300, 400, 600],
      labelNames: ['name'],
    });

    this.taskCount = new client.Gauge({
      name: 'task_result_count',
      help: 'Count of passed or failed tasks',
      labelNames: ['name', 'status'],
    });

    this.validators = new client.Gauge({
      name: 'validators',
      help: 'Validators number',
      labelNames: ['owner', 'status'],
    });

    this.lidoValidators = new client.Gauge({
      name: 'lido_validators',
      help: 'Validators number',
      labelNames: ['nos_name', 'status'],
    });

    this.dataActuality = new client.Gauge({
      name: 'data_actuality',
      help: 'Data actuality',
      labelNames: [],
      collect() {
        // Invoked when the registry collects its metrics' values.
        // This can be synchronous or it can return a promise/be an async function.
        this.set(Date.now() - getSlotTime());
      },
    });

    this.fetchInterval = new client.Gauge({
      name: 'fetch_interval',
      help: 'Fetch interval',
      labelNames: [],
      collect() {
        this.set(fetchIntervalEnv);
      },
    });

    this.syncParticipationDistanceDownFromChainAvg = new client.Gauge({
      name: 'sync_participation_distance_down_from_chain_avg',
      help: 'Sync participation distance down from Blockchain average',
      labelNames: [],
      collect() {
        this.set(syncDistanceEnv);
      },
    });

    this.validatorBalanceDelta = new client.Gauge({
      name: 'validator_balances_delta',
      help: 'validator balances delta',
      labelNames: ['nos_name'],
    });

    this.validatorQuantile001BalanceDelta = new client.Gauge({
      name: 'validator_quantile_001_balances_delta',
      help: 'validator 0.1% quantile balances delta',
      labelNames: ['nos_name'],
    });

    this.validatorsCountWithNegativeBalanceDelta = new client.Gauge({
      name: 'validator_count_with_negative_balances_delta',
      help: 'number of validators with negative balances delta',
      labelNames: ['nos_name'],
    });

    this.validatorsCountWithSyncParticipationLessAvg = new client.Gauge({
      name: 'validator_count_with_sync_participation_less_avg',
      help: 'number of validators with sync committee participation less avg',
      labelNames: ['nos_name'],
    });

    this.validatorsCountMissAttestation = new client.Gauge({
      name: 'validator_count_miss_attestation',
      help: 'number of validators miss attestation',
      labelNames: ['nos_name'],
    });

    this.validatorsCountMissAttestationLastNEpoch = new client.Gauge({
      name: 'validator_count_miss_attestation_last_n_epoch',
      help: 'number of validators miss attestation last N epoch',
      labelNames: ['nos_name', 'epoch_interval'],
    });

    this.highRewardValidatorsCountMissAttestationLastNEpoch = new client.Gauge({
      name: 'high_reward_validator_count_miss_attestation_last_n_epoch',
      help: 'number of validators miss attestation last N epoch (with possible high reward in the future)',
      labelNames: ['nos_name', 'epoch_interval'],
    });

    this.validatorsCountWithSyncParticipationLessAvgLastNEpoch = new client.Gauge({
      name: 'validator_count_with_sync_participation_less_avg_last_n_epoch',
      help: 'number of validators with sync participation less than avg last N epoch',
      labelNames: ['nos_name', 'epoch_interval'],
    });

    this.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch = new client.Gauge({
      name: 'high_reward_validator_count_with_sync_participation_less_avg_last_n_epoch',
      help: 'number of validators with sync participation less than avg last N epoch (with possible high reward in the future)',
      labelNames: ['nos_name', 'epoch_interval'],
    });

    this.validatorsCountMissPropose = new client.Gauge({
      name: 'validator_count_miss_propose',
      help: 'number of validators miss propose',
      labelNames: ['nos_name'],
    });

    this.highRewardValidatorsCountMissPropose = new client.Gauge({
      name: 'high_reward_validator_count_miss_propose',
      help: 'number of validators miss propose (with possible high reward in the future)',
      labelNames: ['nos_name'],
    });


    this.lidoSyncParticipationAvgPercent = new client.Gauge({
      name: 'lido_sync_participation_avg_percent',
      help: 'Lido sync committee validators participation avg percent',
      labelNames: [],
    });


    this.chainSyncParticipationAvgPercent = new client.Gauge({
      name: 'chain_sync_participation_avg_percent',
      help: 'All sync committee validators participation avg percent',
      labelNames: [],
    });

    this.slotNumber = new client.Gauge({
      name: 'slot_number',
      help: 'Current slot number',
      labelNames: [],
    });

    this.totalBalance24hDifference = new client.Gauge({
      name: 'total_balance_24h_difference',
      help: 'Total balance difference (24 hours)',
      labelNames: [],
    });

    this.contractKeysTotal = new client.Gauge({
      name: 'contract_keys_total',
      help: 'Contract keys',
      labelNames: ['type'],
    });

    this.bufferedEther = new client.Gauge({
      name: 'steth_buffered_ether_total',
      help: 'Buffered Ether (ETH)',
      labelNames: [],
    });

    this.registry = new client.Registry();
    [
      this.outgoingELRequestsCount,
      this.outgoingELRequestsDuration,
      this.outgoingCLRequestsCount,
      this.outgoingCLRequestsDuration,
      this.taskCount,
      this.taskDuration,
      this.lidoValidators,
      this.validators,
      this.validatorBalanceDelta,
      this.validatorQuantile001BalanceDelta,
      this.validatorsCountWithNegativeBalanceDelta,
      this.validatorsCountWithSyncParticipationLessAvg,
      this.validatorsCountWithSyncParticipationLessAvgLastNEpoch,
      this.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch,
      this.validatorsCountMissAttestation,
      this.validatorsCountMissAttestationLastNEpoch,
      this.highRewardValidatorsCountMissAttestationLastNEpoch,
      this.validatorsCountMissPropose,
      this.highRewardValidatorsCountMissPropose,
      this.lidoSyncParticipationAvgPercent,
      this.chainSyncParticipationAvgPercent,
      this.dataActuality,
      this.fetchInterval,
      this.syncParticipationDistanceDownFromChainAvg,
      this.slotNumber,
      this.totalBalance24hDifference,
      this.contractKeysTotal,
      this.bufferedEther
    ].map((m) => this.registry.registerMetric(m));
  }

  public get metrics(): Promise<string> {
    return this.registry.metrics();
  }

  public async trackTask(name: string, callback: () => any) {
    const stop = this.taskDuration.startTimer({
      name: name,
    });
    return await callback()
      .then((r: any) => {
        this.taskCount.inc({
          name: name,
          status: TaskStatus.COMPLETE,
        });
        return r;
      })
      .catch((e: any) => {
        this.taskCount.inc({
          name: name,
          status: TaskStatus.ERROR,
        });
        throw e;
      })
      .finally(() => stop());
  }

  public async trackELRequest(rpcUrl: string, subUrl: string, callback: () => any) {
    const [targetName, reqName] = requestLabels(rpcUrl, subUrl);
    const stop = this.outgoingELRequestsDuration.startTimer({
      name: reqName,
      target: targetName,
    });
    return await callback()
      .then((r: any) => {
        this.outgoingELRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.COMPLETE,
        });
        return r;
      })
      .catch((e: any) => {
        this.outgoingELRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.ERROR,
        });
        throw e;
      })
      .finally(() => stop());
  }

  public async trackCLRequest(rpcUrl: string, subUrl: string, callback: () => any) {
    const [targetName, reqName] = requestLabels(rpcUrl, subUrl);
    const stop = this.outgoingCLRequestsDuration.startTimer({
      name: reqName,
      target: targetName,
    });
    return await callback()
      .then((r: any) => {
        this.outgoingCLRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.COMPLETE,
          code: 200,
        });
        return r;
      })
      .catch((e: any) => {
        this.outgoingCLRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.ERROR,
          code: e.$httpCode,
        });
        throw e;
      })
      .finally(() => stop());
  }
}
