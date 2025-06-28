import { LOGGER_PROVIDER, LoggerService } from '@lido-nestjs/logger';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Metrics, getOrCreateMetric } from '@willsoto/nestjs-prometheus';
import { join } from 'lodash';
import { LabelValues } from 'prom-client';

import { ConfigService } from 'common/config';
import { RegistrySourceOperator } from 'validators-registry';

import { Metric, Options } from './interfaces';
import {
  METRICS_PREFIX,
  METRIC_AVG_CHAIN_MISSED_REWARD,
  METRIC_AVG_CHAIN_PENALTY,
  METRIC_AVG_CHAIN_REWARD,
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
  METRIC_OPERATOR_CALCULATED_BALANCE_CALCULATION_ERROR,
  METRIC_OPERATOR_CALCULATED_BALANCE_DELTA,
  METRIC_OPERATOR_MISSED_REWARD,
  METRIC_OPERATOR_PENALTY,
  METRIC_OPERATOR_REAL_BALANCE_DELTA,
  METRIC_OPERATOR_REWARD,
  METRIC_OPERATOR_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_OPERATOR_WITHDRAWALS_COUNT,
  METRIC_OPERATOR_WITHDRAWALS_SUM,
  METRIC_OTHER_CHAIN_WITHDRAWALS_COUNT,
  METRIC_OTHER_CHAIN_WITHDRAWALS_SUM,
  METRIC_OTHER_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_OTHER_VALIDATOR_COUNT_GOOD_PROPOSE,
  METRIC_OTHER_VALIDATOR_COUNT_INVALID_ATTESTATION,
  METRIC_OTHER_VALIDATOR_COUNT_MISS_ATTESTATION,
  METRIC_OTHER_VALIDATOR_COUNT_MISS_PROPOSE,
  METRIC_OTHER_VALIDATOR_COUNT_PERFECT_ATTESTATION,
  METRIC_OTHER_VALIDATOR_COUNT_WITH_GOOD_SYNC_PARTICIPATION,
  METRIC_OTHER_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG,
  METRIC_OUTGOING_CL_REQUESTS_COUNT,
  METRIC_OUTGOING_CL_REQUESTS_DURATION_SECONDS,
  METRIC_OUTGOING_EL_REQUESTS_COUNT,
  METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS,
  METRIC_OUTGOING_KEYSAPI_REQUESTS_COUNT,
  METRIC_OUTGOING_KEYSAPI_REQUESTS_DURATION_SECONDS,
  METRIC_STETH_BUFFERED_ETHER_TOTAL,
  METRIC_SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG,
  METRIC_TASK_DURATION_SECONDS,
  METRIC_TASK_RESULT_COUNT,
  METRIC_TOTAL_BALANCE_24H_DIFFERENCE,
  METRIC_USER_OPERATORS_IDENTIFIES,
  METRIC_USER_SYNC_PARTICIPATION_AVG_PERCENT,
  METRIC_USER_VALIDATORS,
  METRIC_VALIDATORS,
  METRIC_VALIDATOR_BALANCES_DELTA,
  METRIC_VALIDATOR_COUNT_GOOD_PROPOSE,
  METRIC_VALIDATOR_COUNT_HIGH_INC_DELAY_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION,
  METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_PROPERTY_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_MISS_ATTESTATION,
  METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
  METRIC_VALIDATOR_COUNT_MISS_PROPOSE,
  METRIC_VALIDATOR_COUNT_PERFECT_ATTESTATION,
  METRIC_VALIDATOR_COUNT_WITH_GOOD_SYNC_PARTICIPATION,
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
  WithdrawalPending = 'withdrawal_pending',
  WithdrawalDone = 'withdrawal_done',
  Stuck = 'stuck',
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

  public epochTime = 0; // latest fetched slot time
  public getSlotTimeDiffWithNow = () => Date.now() - Number(this.epochTime) * 1000;

  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, private config: ConfigService) {}

  public async onApplicationBootstrap(): Promise<void> {
    const getSlotTimeDiffWithNow = () => this.getSlotTimeDiffWithNow();
    this.getOrCreateMetric('Gauge', {
      name: METRIC_DATA_ACTUALITY,
      help: 'Application data actuality in ms',
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
    help: 'Information about app build',
    labelNames: ['name', 'version', 'commit', 'branch', 'env', 'network'],
  });

  public outgoingELRequestsDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS,
    help: 'Duration of outgoing execution layer requests in seconds',
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
    help: 'Duration of outgoing consensus layer requests in seconds',
    buckets: [0.01, 0.1, 0.5, 1, 2, 5, 15, 30, 60],
    labelNames: ['name', 'target'] as const,
  });

  public outgoingCLRequestsCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_OUTGOING_CL_REQUESTS_COUNT,
    help: 'Count of outgoing consensus layer requests',
    labelNames: ['name', 'target', 'status', 'code'] as const,
  });

  public outgoingKeysAPIRequestsDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_OUTGOING_KEYSAPI_REQUESTS_DURATION_SECONDS,
    help: 'Duration of outgoing Keys API requests in seconds',
    buckets: [0.01, 0.1, 0.5, 1, 2, 5, 15, 30, 60],
    labelNames: ['name', 'target'] as const,
  });

  public outgoingKeysAPIRequestsCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_OUTGOING_KEYSAPI_REQUESTS_COUNT,
    help: 'Count of outgoing Keys API requests',
    labelNames: ['name', 'target', 'status', 'code'] as const,
  });

  public taskDuration = this.getOrCreateMetric('Histogram', {
    name: METRIC_TASK_DURATION_SECONDS,
    help: 'Duration of task execution',
    buckets: [5, 15, 30, 60, 120, 180, 240, 300, 400, 600],
    labelNames: ['name'],
  });

  public taskCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_TASK_RESULT_COUNT,
    help: 'Count of passed or failed tasks',
    labelNames: ['name', 'status'],
  });

  public epochNumber = this.getOrCreateMetric('Gauge', {
    name: METRIC_EPOCH_NUMBER,
    help: 'Current epoch number in app work process',
    labelNames: [],
  });

  public operatorsIdentifies = this.getOrCreateMetric('Gauge', {
    name: METRIC_USER_OPERATORS_IDENTIFIES,
    help: 'User Node Operators in each module',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public validators = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATORS,
    help: 'Count of validators in the chain',
    labelNames: ['owner', 'nos_module_id', 'status'],
  });

  public userValidators = this.getOrCreateMetric('Gauge', {
    name: METRIC_USER_VALIDATORS,
    help: 'Count of validators for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'status'],
  });

  public avgValidatorBalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_BALANCES_DELTA,
    help: 'Validators balance delta for each user Node Operator (6 epochs delta)',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public operatorRealBalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_REAL_BALANCE_DELTA,
    help: 'Real operator balance change. Between N and N-1 epochs.',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public operatorCalculatedBalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_CALCULATED_BALANCE_DELTA,
    help: 'Calculated operator balance change based on calculated rewards and penalties',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public operatorCalculatedBalanceCalculationError = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_CALCULATED_BALANCE_CALCULATION_ERROR,
    help: 'Diff between calculated and real balance change',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public validatorQuantile001BalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_QUANTILE_001_BALANCES_DELTA,
    help: 'Validators 0.1% quantile balances delta for each user Node Operator (6 epochs delta)',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public validatorsCountWithNegativeBalanceDelta = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_NEGATIVE_BALANCES_DELTA,
    help: 'Number of validators with negative balances delta for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids'],
  });

  public totalBalance24hDifference = this.getOrCreateMetric('Gauge', {
    name: METRIC_TOTAL_BALANCE_24H_DIFFERENCE,
    help: 'Total user validators balance difference (24 hours)',
    labelNames: ['nos_module_id'],
  });

  public operatorBalance24hDifference = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_BALANCE_24H_DIFFERENCE,
    help: 'Total validators balance difference (24 hours) for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public otherValidatorsCountWithGoodSyncParticipation = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_WITH_GOOD_SYNC_PARTICIPATION,
    help: 'Number of non-user validators in the chain with a good sync committee participation',
    labelNames: [],
  });

  public validatorsCountWithGoodSyncParticipation = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_GOOD_SYNC_PARTICIPATION,
    help: 'Number of validators with a good sync committee participation for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public otherValidatorsCountWithSyncParticipationLessAvg = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG,
    help: 'Number of non-user validators with sync committee participation less than average in the chain',
    labelNames: [],
  });

  public validatorsCountWithSyncParticipationLessAvg = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG,
    help: 'Number of validators with sync committee participation less than average in the chain for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public validatorsCountWithSyncParticipationLessAvgLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
    help: 'Number of validators with sync committee participation less than average in the chain in the last N epochs for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids', 'epoch_interval'],
  });

  public highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_HIGH_REWARD_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH,
    help: 'Number of validators with sync committee participation less than average in the chain in the last N epochs (with possible high reward in the future) for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids', 'epoch_interval'],
  });

  public otherSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Average percent of participation of non-user validators in sync committees',
    labelNames: [],
  });

  public userSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_USER_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Average percent of participation of user validators in sync committees',
    labelNames: ['nos_module_id'],
  });

  public operatorSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Average percent of participation of validators in sync committees for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public chainSyncParticipationAvgPercent = this.getOrCreateMetric('Gauge', {
    name: METRIC_CHAIN_SYNC_PARTICIPATION_AVG_PERCENT,
    help: 'Average percent of participation of all validators in the chain in sync committees',
    labelNames: [],
  });

  public otherValidatorsCountPerfectAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_PERFECT_ATTESTATION,
    help: 'Number of non-user validators in the chain with perfect attestations',
    labelNames: [],
  });

  public validatorsCountPerfectAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_PERFECT_ATTESTATION,
    help: 'Number of validators with perfect attestations for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public otherValidatorsCountMissAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_MISS_ATTESTATION,
    help: 'Number of non-user validators in the chain with missed attestations',
    labelNames: [],
  });

  public validatorsCountMissAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_ATTESTATION,
    help: 'Number of validators with missed attestations for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public validatorsCountMissAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
    help: 'Number of validators with missed attestations in the last N epochs for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids', 'epoch_interval'],
  });

  public highRewardValidatorsCountMissAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH,
    help: 'Number of validators with missed attestations in the last N epochs (with possible high reward in the future) for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids', 'epoch_interval'],
  });

  public otherValidatorsCountInvalidAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_INVALID_ATTESTATION,
    help: 'Number of non-user validators in the chain with invalid properties (head, target, source) or high inclusion delay in attestations',
    labelNames: ['reason'],
  });

  public validatorsCountInvalidAttestation = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION,
    help: 'Number of validators with invalid properties (head, target, source) or high inclusion delay in attestations for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'reason'],
  });

  public validatorsCountInvalidAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_LAST_N_EPOCH,
    help: 'Number of validators with invalid properties (head, target, source) or high inclusion delay in attestations in the last N epochs for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'reason', 'epoch_interval'],
  });

  public validatorsCountInvalidAttestationPropertyLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_INVALID_ATTESTATION_PROPERTY_LAST_N_EPOCH,
    help: 'Number of validators with two invalid attestation properties (head or target or source) in the last N epochs for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids', 'epoch_interval'],
  });

  public validatorsCountHighIncDelayAttestationLastNEpoch = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_HIGH_INC_DELAY_ATTESTATION_LAST_N_EPOCH,
    help: 'Number of validators with attestations inclusion delay > 2 in the last N epochs for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids', 'epoch_interval'],
  });

  public otherValidatorsCountGoodPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_GOOD_PROPOSE,
    help: 'Number of non-user validators in the chain with good proposals for each user Node Operator',
    labelNames: [],
  });

  public validatorsCountGoodPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_GOOD_PROPOSE,
    help: 'Number of validators with good proposals for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name'],
  });

  public otherValidatorsCountMissPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_VALIDATOR_COUNT_MISS_PROPOSE,
    help: 'Number of non-user validators in the chain with missed proposals',
    labelNames: [],
  });

  public validatorsCountMissPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_VALIDATOR_COUNT_MISS_PROPOSE,
    help: 'Number of validators with missed proposals for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids'],
  });

  public highRewardValidatorsCountMissPropose = this.getOrCreateMetric('Gauge', {
    name: METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_PROPOSE,
    help: 'Number of validators with missed proposals (with possible high reward in the future) for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'val_ids'],
  });

  public operatorReward = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_REWARD,
    help: 'Average validators reward for each duty for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'duty'],
  });

  public avgChainReward = this.getOrCreateMetric('Gauge', {
    name: METRIC_AVG_CHAIN_REWARD,
    help: 'Average reward of all validators in the chain for each duty',
    labelNames: ['duty'],
  });

  public operatorMissedReward = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_MISSED_REWARD,
    help: 'Average validators missed reward for each duty for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'duty'],
  });

  public avgChainMissedReward = this.getOrCreateMetric('Gauge', {
    name: METRIC_AVG_CHAIN_MISSED_REWARD,
    help: 'Average missed reward of all validators in the chain for each duty',
    labelNames: ['duty'],
  });

  public operatorPenalty = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_PENALTY,
    help: 'Average validators penalty for each duty for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'duty'],
  });

  public avgChainPenalty = this.getOrCreateMetric('Gauge', {
    name: METRIC_AVG_CHAIN_PENALTY,
    help: 'Average penalty of all validators in the chain for each duty',
    labelNames: ['duty'],
  });

  public operatorWithdrawalsSum = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_WITHDRAWALS_SUM,
    help: 'Total sum of validators withdrawals for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'type'],
  });

  public otherChainWithdrawalsSum = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_CHAIN_WITHDRAWALS_SUM,
    help: 'Total sum of non-user validators withdrawals in the chain',
    labelNames: ['type'],
  });

  public operatorWithdrawalsCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_OPERATOR_WITHDRAWALS_COUNT,
    help: 'Number of validators withdrawals for each user Node Operator',
    labelNames: ['nos_module_id', 'nos_id', 'nos_name', 'type'],
  });

  public otherChainWithdrawalsCount = this.getOrCreateMetric('Gauge', {
    name: METRIC_OTHER_CHAIN_WITHDRAWALS_COUNT,
    help: 'other chain withdrawals count',
    labelNames: ['type'],
  });

  public contractKeysTotal = this.getOrCreateMetric('Gauge', {
    name: METRIC_CONTRACT_KEYS_TOTAL,
    help: 'Total user validators keys of each type',
    labelNames: ['type'],
  });

  public bufferedEther = this.getOrCreateMetric('Gauge', {
    name: METRIC_STETH_BUFFERED_ETHER_TOTAL,
    help: 'Total amount of buffered Ether (ETH) in the Lido contract',
    labelNames: [],
  });
}

export const setUserOperatorsMetric = (
  metric: Metric<'Gauge', any>,
  data: any[],
  operators: RegistrySourceOperator[],
  labels: ((operator: RegistrySourceOperator, operatorData?: any) => LabelValues<string>) | LabelValues<string> = {},
  value: (dataItem: any) => number = (dataItem) => dataItem.amount,
) => {
  operators.forEach((operator) => {
    const operatorResult = data.find(
      (p) => p.val_nos_id != null && +p.val_nos_module_id === operator.module && +p.val_nos_id === operator.index,
    );
    const _labels =
      typeof labels == 'function'
        ? labels(operator, operatorResult)
        : { nos_module_id: operator.module, nos_id: operator.index, nos_name: operator.name, ...labels };

    if (operatorResult != null) {
      metric.set(_labels, value(operatorResult));
    } else {
      metric.set(_labels, 0);
    }
  });
  // we should remove 'outdated' metrics (operator renaming or deleting case, for example)
  const registry = Object.values(metric['hashMap']).map((m: any) => m.labels);
  registry.forEach((labels) => {
    if (!operators.find((o) => o.name == labels.nos_name)) metric.remove(labels);
  });
};

export const setOtherOperatorsMetric = (metric: Metric<'Gauge', any>, data: any[], labels: LabelValues<string> = {}) => {
  const other = data.find((p) => p.val_nos_id == null);

  if (other != null) {
    metric.set(labels, other.amount);
  } else {
    metric.set(labels, 0);
  }
};

export const getLabelsForMetricWithValIDs = (
  operator: RegistrySourceOperator,
  operatorData: any,
  fullCLExplorerUrl: string,
  labels: LabelValues<string> = {},
) => {
  let valIds: string;

  if (operatorData == null) {
    valIds = '';
  } else if (fullCLExplorerUrl === '') {
    valIds = operatorData.val_ids;
  } else {
    const valIdsList = operatorData.val_ids.split(',');
    const remainingValidators = operatorData.amount != null ? operatorData.amount - valIdsList.length : 0;
    const suffix = remainingValidators > 0 ? `, ... more ${remainingValidators}` : '';
    valIds = valIdsList.map((valId) => `[${valId}](${fullCLExplorerUrl + valId})`).join(', ') + suffix;
  }

  return {
    nos_module_id: operator.module,
    nos_id: operator.index,
    nos_name: operator.name,
    val_ids: valIds,
    ...labels,
  };
};

export function TrackCLRequest(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalValue = descriptor.value;
  descriptor.value = function (...args) {
    if (!this.prometheus) throw Error(`'${this.constructor.name}' class object must contain 'prometheus' property`);
    const [apiUrl, subUrl] = args;
    const [targetName, reqName] = requestLabels(apiUrl, subUrl);
    const stop = this.prometheus.outgoingCLRequestsDuration.startTimer({
      name: reqName,
      target: targetName,
    });
    return originalValue
      .apply(this, args)
      .then((r: any) => {
        this.prometheus.outgoingCLRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.COMPLETE,
          code: 200,
        });
        return r;
      })
      .catch((e: any) => {
        this.prometheus.outgoingCLRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.ERROR,
          code: e.$httpCode,
        });
        throw e;
      })
      .finally(() => stop());
  };
}

export function TrackKeysAPIRequest(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalValue = descriptor.value;
  descriptor.value = function (...args) {
    if (!this.prometheus) throw Error(`'${this.constructor.name}' class object must contain 'prometheus' property`);
    const [apiUrl, subUrl] = args;
    const [targetName, reqName] = requestLabels(apiUrl, subUrl);
    const stop = this.prometheus.outgoingKeysAPIRequestsDuration.startTimer({
      name: reqName,
      target: targetName,
    });
    return originalValue
      .apply(this, args)
      .then((r: any) => {
        this.prometheus.outgoingKeysAPIRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.COMPLETE,
          code: 200,
        });
        return r;
      })
      .catch((e: any) => {
        this.prometheus.outgoingKeysAPIRequestsCount.inc({
          name: reqName,
          target: targetName,
          status: RequestStatus.ERROR,
          code: e.$httpCode,
        });
        throw e;
      })
      .finally(() => stop());
  };
}

export function TrackTask(name: string) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalValue = descriptor.value;

    descriptor.value = function (...args) {
      // "this" here will refer to the class instance
      if (!this.prometheus) throw Error(`'${this.constructor.name}' class object must contain 'prometheus' property`);
      const stop = this.prometheus.taskDuration.startTimer({
        name: name,
      });
      this.logger.debug(`Task '${name}' in progress`);
      return originalValue
        .apply(this, args)
        .then((r) => {
          this.prometheus.taskCount.inc({
            name: name,
            status: TaskStatus.COMPLETE,
          });
          return r;
        })
        .catch((e) => {
          this.logger.error(`Task '${name}' ended with an error`, e.stack);
          this.prometheus.taskCount.inc({
            name: name,
            status: TaskStatus.ERROR,
          });
          throw e;
        })
        .finally(() => {
          const duration = stop();
          const used = process.memoryUsage().heapUsed / 1024 / 1024;
          this.logger.debug(`Task '${name}' is complete. Used MB: ${used}. Duration: ${duration}`);
        });
    };
  };
}
