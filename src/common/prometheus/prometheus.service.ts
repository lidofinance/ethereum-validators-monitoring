import { getOrCreateMetric, Metrics } from '@willsoto/nestjs-prometheus';
import {
  METRICS_PREFIX,
  METRIC_TASK_DURATION_SECONDS,
  METRIC_TASK_RESULT_COUNT,
  METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS,
  METRIC_OUTGOING_EL_REQUESTS_COUNT,
  METRIC_OUTGOING_CL_REQUESTS_DURATION_SECONDS,
  METRIC_OUTGOING_CL_REQUESTS_COUNT,
  METRIC_VALIDATORS,
  METRIC_LIDO_VALIDATORS,
  METRIC_DATA_ACTUALITY,
  METRIC_FETCH_INTERVAL,
  METRIC_SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG,
  METRIC_VALIDATOR_BALANCES_DELTA,
  METRIC_VALIDATOR_QUANTILE_001_BALANCES_DELTA,
  METRIC_VALIDATOR_COUNT_WITH_NEGATIVE_BALANCES_DELTA,
  METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG,
  METRIC_VALIDATOR_COUNT_MISS_ATTESTATION,
  METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
  METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
  METRIC_HIGH_REWARD_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_MISS_PROPOSE,
  METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_PROPOSE,
  METRIC_LIDO_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_CHAIN_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_SLOT_NUMBER,
  METRIC_TOTAL_BALANCE_24H_DIFFERENCE,
  METRIC_CONTRACT_KEYS_TOTAL,
  METRIC_STETH_BUFFERED_ETHER_TOTAL,
  METRIC_BUILD_INFO,
} from './prometheus.constants';
import { Metric, Options } from './interfaces';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../config';
import { join } from 'lodash';
import { LOGGER_PROVIDER, LoggerService } from '@lido-nestjs/logger';

export enum Owner {
  LIDO = 'lido',
  OTHER = 'other',
}

export enum RequestStatus {
  COMPLETE = 'complete',
  ERROR = 'error',
}

enum TaskStatus {
  COMPLETE = 'complete',
  ERROR = 'error',
}

export function requestLabels(rpcUrl: string, subUrl: string) {
  const targetName = new URL(rpcUrl).hostname;
  const reqName = join(
    subUrl
      .split('?')[0]
      .split('/')
      .map((p) => {
        if (p.includes('0x') || +p) return '{param}';
        return p;
      }),
    '/',
  );
  return [targetName, reqName];
}

@Injectable()
export class PrometheusService {
  private prefix = METRICS_PREFIX;

  public slotTime = 0n; // latest fetched slot time
  public getSlotTimeDiffWithNow = () => Date.now() - Number(this.slotTime) * 1000;

  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, private config: ConfigService) {
    const getSlotTimeDiffWithNow = () => this.getSlotTimeDiffWithNow();
    this.getOrCreateMetric('Gauge', {
      name: METRIC_DATA_ACTUALITY,
      help: 'Data actuality',
      labelNames: [],
      collect() {
        // Invoked when the registry collects its metrics' values.
        // This can be synchronous or it can return a promise/be an async function.
        this.set(getSlotTimeDiffWithNow());
      },
    });

    const fetchIntervalEnv = Number(this.config.get('FETCH_INTERVAL_SLOTS'));
    this.getOrCreateMetric('Gauge', {
      name: METRIC_FETCH_INTERVAL,
      help: 'Fetch interval',
      labelNames: [],
      collect() {
        this.set(fetchIntervalEnv);
      },
    });

    const syncDistanceEnv = Number(this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG'));
    this.getOrCreateMetric('Gauge', {
      name: METRIC_SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG,
      help: 'Sync participation distance down from Blockchain average',
      labelNames: [],
      collect() {
        this.set(syncDistanceEnv);
      },
    });
  }

  private getOrCreateMetric<T extends Metrics, L extends string>(type: T, options: Options<L>): Metric<T, L> {
    const nameWithPrefix = this.prefix + options.name;

    return getOrCreateMetric(type, {
      ...options,
      name: nameWithPrefix,
    }) as Metric<T, L>;
  }

  public buildInfo = this.getOrCreateMetric('Counter', {
    name: METRIC_BUILD_INFO,
    help: 'Build information',
    labelNames: ['name', 'version', 'env', 'network'],
  });

  public outgoingELRequestsDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS,
    help: 'Duration of outgoing execution layer requests',
    buckets: [0.01, 0.1, 0.2, 0.5, 1, 1.5, 2, 5, 15],
    labelNames: ['name', 'target'] as const,
  });

  public outgoingELRequestsCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_OUTGOING_EL_REQUESTS_COUNT,
    help: 'Count of outgoing execution layer requests',
    labelNames: ['name', 'target', 'status'] as const,
  });

  public outgoingCLRequestsDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_OUTGOING_CL_REQUESTS_DURATION_SECONDS,
    help: 'Duration of outgoing consensus layer requests',
    buckets: [0.01, 0.1, 0.2, 0.5, 1, 1.5, 2, 5, 15],
    labelNames: ['name', 'target'] as const,
  });

  public outgoingCLRequestsCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_OUTGOING_CL_REQUESTS_COUNT,
    help: 'Count of outgoing consensus layer requests',
    labelNames: ['name', 'target', 'status', 'code'] as const,
  });

  public taskDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_TASK_DURATION_SECONDS,
    help: 'Duration of task execution',
    buckets: [30, 60, 120, 180, 240, 300, 400, 600],
    labelNames: ['name'],
  });

  public taskCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_TASK_RESULT_COUNT,
    help: 'Count of passed or failed tasks',
    labelNames: ['name', 'status'],
  });

  public validators = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATORS,
    help: 'Validators number',
    labelNames: ['owner', 'status'],
  });

  public lidoValidators = this.getOrCreateMetric('Gauge', {
    name: METRIC_LIDO_VALIDATORS,
    help: 'Validators number',
    labelNames: ['nos_name', 'status'],
  });

  public validatorBalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_BALANCES_DELTA,
    help: 'validator balances delta',
    labelNames: ['nos_name'],
  });

  public validatorQuantile001BalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_QUANTILE_001_BALANCES_DELTA,
    help: 'validator 0.1% quantile balances delta',
    labelNames: ['nos_name'],
  });

  public validatorsCountWithNegativeBalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_NEGATIVE_BALANCES_DELTA,
    help: 'number of validators with negative balances delta',
    labelNames: ['nos_name'],
  });

  public validatorsCountWithSyncParticipationLessAvg = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG,
    help: 'number of validators with sync committee participation less avg',
    labelNames: ['nos_name'],
  });

  public validatorsCountMissAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_ATTESTATION,
    help: 'number of validators miss attestation',
    labelNames: ['nos_name'],
  });

  public validatorsCountMissAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
    help: 'number of validators miss attestation last N epoch',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public highRewardValidatorsCountMissAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
    help: 'number of validators miss attestation last N epoch (with possible high reward in the future)',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public validatorsCountWithSyncParticipationLessAvgLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
    help: 'number of validators with sync participation less than avg last N epoch',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_HIGH_REWARD_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
    help: 'number of validators with sync participation less than avg last N epoch (with possible high reward in the future)',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public validatorsCountMissPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_PROPOSE,
    help: 'number of validators miss propose',
    labelNames: ['nos_name'],
  });

  public highRewardValidatorsCountMissPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_PROPOSE,
    help: 'number of validators miss propose (with possible high reward in the future)',
    labelNames: ['nos_name'],
  });

  public lidoSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_LIDO_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Lido sync committee validators participation avg percent',
    labelNames: [],
  });

  public chainSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_CHAIN_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'All sync committee validators participation avg percent',
    labelNames: [],
  });

  public slotNumber = this.getOrCreateMetric('Gauge', {
    name: METRIC_SLOT_NUMBER,
    help: 'Current slot number',
    labelNames: [],
  });

  public totalBalance24hDifference = this.getOrCreateMetric('Gauge', {
    name: METRIC_TOTAL_BALANCE_24H_DIFFERENCE,
    help: 'Total balance difference (24 hours)',
    labelNames: [],
  });

  public contractKeysTotal = this.getOrCreateMetric('Gauge', {
    name: METRIC_CONTRACT_KEYS_TOTAL,
    help: 'Contract keys',
    labelNames: ['type'],
  });

  public bufferedEther = this.getOrCreateMetric('Gauge', {
    name: METRIC_STETH_BUFFERED_ETHER_TOTAL,
    help: 'Buffered Ether (ETH)',
    labelNames: [],
  });

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
