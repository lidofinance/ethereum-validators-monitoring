import { APP_NAME } from '../../app';

export const METRICS_URL = '/metrics';
export const METRICS_PREFIX = `${APP_NAME.replace(/[- ]/g, '_')}_`;

export const METRIC_BUILD_INFO = `build_info`;

export const METRIC_OUTGOING_EL_REQUESTS_DURATION_SECONDS = `outgoing_el_requests_duration_seconds`;
export const METRIC_OUTGOING_EL_REQUESTS_COUNT = `outgoing_el_requests_count`;
export const METRIC_OUTGOING_CL_REQUESTS_DURATION_SECONDS = `outgoing_cl_requests_duration_seconds`;
export const METRIC_OUTGOING_CL_REQUESTS_COUNT = `outgoing_cl_requests_count`;
export const METRIC_TASK_DURATION_SECONDS = `task_duration_seconds`;
export const METRIC_TASK_RESULT_COUNT = `task_result_count`;
export const METRIC_DATA_ACTUALITY = `data_actuality`;

export const METRIC_VALIDATORS = `validators`;
export const METRIC_USER_VALIDATORS = `user_validators`;
export const METRIC_FETCH_INTERVAL = `fetch_interval`;
export const METRIC_SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG = `sync_participation_distance_down_from_chain_avg`;
export const METRIC_VALIDATOR_BALANCES_DELTA = `validator_balances_delta`;
export const METRIC_VALIDATOR_QUANTILE_001_BALANCES_DELTA = `validator_quantile_001_balances_delta`;
export const METRIC_VALIDATOR_COUNT_WITH_NEGATIVE_BALANCES_DELTA = `validator_count_with_negative_balances_delta`;
export const METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG = `validator_count_with_sync_participation_less_avg`;
export const METRIC_VALIDATOR_COUNT_MISS_ATTESTATION = `validator_count_miss_attestation`;
export const METRIC_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH = `validator_count_miss_attestation_last_n_epoch`;
export const METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_ATTESTATION_LAST_N_EPOCH = `high_reward_validator_count_miss_attestation_last_n_epoch`;
export const METRIC_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH = `validator_count_with_sync_participation_less_avg_last_n_epoch`;
export const METRIC_HIGH_REWARD_VALIDATOR_COUNT_WITH_SYNC_PARTICIPATION_LESS_AVG_LAST_N_EPOCH = `high_reward_validator_count_with_sync_participation_less_avg_last_n_epoch`;
export const METRIC_VALIDATOR_COUNT_MISS_PROPOSE = `validator_count_miss_propose`;
export const METRIC_HIGH_REWARD_VALIDATOR_COUNT_MISS_PROPOSE = `high_reward_validator_count_miss_propose`;
export const METRIC_USER_SYNC_PARTICIPATION_AVG_PERCENT = `user_sync_participation_avg_percent`;
export const METRIC_OPERATOR_SYNC_PARTICIPATION_AVG_PERCENT = `operator_sync_participation_avg_percent`;
export const METRIC_CHAIN_SYNC_PARTICIPATION_AVG_PERCENT = `chain_sync_participation_avg_percent`;
export const METRIC_SLOT_NUMBER = `slot_number`;
export const METRIC_TOTAL_BALANCE_24H_DIFFERENCE = `total_balance_24h_difference`;
export const METRIC_OPERATOR_BALANCE_24H_DIFFERENCE = `operator_balance_24h_difference`;
export const METRIC_CONTRACT_KEYS_TOTAL = `contract_keys_total`;
export const METRIC_STETH_BUFFERED_ETHER_TOTAL = `steth_buffered_ether_total`;
