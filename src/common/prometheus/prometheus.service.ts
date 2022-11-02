import { LOGGER_PROVIDER, LoggerService } from '@lido-nestjs/logger';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Metrics, getOrCreateMetric } from '@willsoto/nestjs-prometheus';
import { join } from 'lodash';

import { ConfigService } from 'common/config';

import { Metric, Options } from './interfaces';
import {
  METRICS_PREFIX,
  METRIC_BUILD_INFO,
  METRIC_CHAIN_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_CONTRACT_KEYS_TOTAL,
  METRIC_DATA_ACTUALITY,
  METRIC_EPOCH_NUMBER,
  METRIC_FETCH_INTERVAL,
  METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
  METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_PROPOSE,
  METRIC_HIGH_REWARD_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
  METRIC_OPERATOR_BALANCE_24H_DIFFERENCE,
  METRIC_OPERATOR_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_OTHER_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_OUTGOING_CL_REQUESTS_COUNT,
  METRIC_OUTGOING_CL_REQUESTS_DURATION_SECONDS,
  METRIC_OUTGOING_EL_REQUESTS_COUNT,
  METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS,
  METRIC_STETH_BUFFERED_ETHER_TOTAL,
  METRIC_SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG,
  METRIC_TASK_DURATION_SECONDS,
  METRIC_TASK_RESULT_COUNT,
  METRIC_TOTAL_BALANCE_24H_DIFFERENCE,
  METRIC_USER_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_USER_VALIDATORS,
  METRIC_VALIDATORS,
  METRIC_VALIDATOR_BALANCES_DELTA,
  METRIC_VALIDATOR_COUNT_HIGH_AVG_INC_DELAY_ATTESTATION_OF_N_EPOCH,
  METRIC_VALIDATOR_COUNT_HIGH_INC_DELAY_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION,
  METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_PROPERTY_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_MISS_ATTESTATION,
  METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_MISS_PROPOSE,
  METRIC_VALIDATOR_COUNT_WITH_NEGATIVE_BALANCES_DELTA,
  METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG,
  METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
  METRIC_VALIDATOR_QUANTILE_001_BALANCES_DELTA,
} from './prometheus.constants';

export enum Owner {
  USER = 'user',
  OTHER = 'other',
}

export enum RequestStatus {
  COMPLETE = 'complete',
  ERROR = 'error',
}

export enum PrometheusValStatus {
  Ongoing = 'ongoing',
  Pending = 'pending',
  Slashed = 'slashed',
}

enum TaskStatus {
  COMPLETE = 'complete',
  ERROR = 'error',
}

export function requestLabels(apiUrl: string, subUrl: string) {
  const targetName = new URL(apiUrl).hostname;
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
export class PrometheusService implements OnApplicationBootstrap {
  private prefix = METRICS_PREFIX;

  public epochTime = 0n; // latest fetched slot time
  public getSlotTimeDiffWithNow = () => Date.now() - Number(this.epochTime) * 1000;

  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, private config: ConfigService) {}

  public async onApplicationBootstrap(): Promise<void> {
    const getSlotTimeDiffWithNow = () => this.getSlotTimeDiffWithNow();
    this.getOrCreateMetric('Gauge', {
      name: METRIC_DATA_ACTUALITY,
      help: 'Data actuality',
      labelNames: [],
      collect() {
        // Invoked when the validators collects its metrics' values.
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
    labelNames: ['name', 'version', 'commit', 'branch', 'env', 'network'],
  });

  public outgoingELRequestsDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS,
    help: 'Duration of outgoing execution layer requests',
    buckets: [0.01, 0.1, 0.5, 1, 2, 5, 15, 30, 60],
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
    buckets: [0.01, 0.1, 0.5, 1, 2, 5, 15, 30, 60],
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

  public userValidators = this.getOrCreateMetric('Gauge', {
    name: METRIC_USER_VALIDATORS,
    help: 'User validators number',
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

  public validatorsCountInvalidAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION,
    help: 'number of validators with invalid properties or high inc. delay in attestation',
    labelNames: ['nos_name', 'reason'],
  });

  public validatorsCountMissAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
    help: 'number of validators miss attestation last N epoch',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public validatorsCountInvalidAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_LAST_N_EPOCH,
    help: 'number of validators with invalid properties or high inc. delay in attestation last N epoch',
    labelNames: ['nos_name', 'reason', 'epoch_interval'],
  });

  public validatorsCountHighAvgIncDelayAttestationOfNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_HIGH_AVG_INC_DELAY_ATTESTATION_OF_N_EPOCH,
    help: 'number of validators with high avg inc. delay of N epochs',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public validatorsCountHighIncDelayAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_HIGH_INC_DELAY_ATTESTATION_LAST_N_EPOCH,
    help: 'number of validators with high inc. delay last N epochs',
    labelNames: ['nos_name', 'epoch_interval'],
  });

  public validatorsCountInvalidAttestationPropertyLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_PROPERTY_LAST_N_EPOCH,
    help: 'number of validators with two invalid attestation property (head, target, source) last N epochs',
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

  public userSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_USER_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'User sync committee validators participation avg percent',
    labelNames: [],
  });

  public operatorSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Operator sync committee validators participation avg percent',
    labelNames: ['nos_name'],
  });

  public otherSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Other sync committee validators participation avg percent',
    labelNames: [],
  });

  public chainSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_CHAIN_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Chain sync committee validators participation avg percent',
    labelNames: [],
  });

  public epochNumber = this.getOrCreateMetric('Gauge', {
    name: METRIC_EPOCH_NUMBER,
    help: 'Current epoch number',
    labelNames: [],
  });

  public totalBalance24hDifference = this.getOrCreateMetric('Gauge', {
    name: METRIC_TOTAL_BALANCE_24H_DIFFERENCE,
    help: 'Total balance difference (24 hours)',
    labelNames: [],
  });

  public operatorBalance24hDifference = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_BALANCE_24H_DIFFERENCE,
    help: 'Operator balance difference (24 hours)',
    labelNames: ['nos_name'],
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
    this.logger.debug(`Task '${name}' in progress`);
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
      .finally(() => this.logger.debug(`Task '${name}' is complete. Duration: ${stop()}`));
  }

  public async trackCLRequest(apiUrl: string, subUrl: string, callback: () => any) {
    const [targetName, reqName] = requestLabels(apiUrl, subUrl);
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
