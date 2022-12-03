// from https://eth2book.info/bellatrix/part2/incentives/rewards/
const TIMELY_SOURCE_WEIGHT = 14; // Ws
const TIMELY_TARGET_WEIGHT = 26; // Wt
const TIMELY_HEAD_WEIGHT = 14; // Wh
const WEIGHT_DENOMINATOR = 64; // W sigma

// Rewards
export const timelySource = (att_inc_delay: number, att_valid_source: boolean): number => {
  if (att_valid_source && att_inc_delay <= 5) return TIMELY_SOURCE_WEIGHT;
  else return 0;
};
export const timelyTarget = (att_inc_delay: number, att_valid_target: boolean): number => {
  if (att_valid_target && att_inc_delay <= 32) return TIMELY_TARGET_WEIGHT;
  else return 0;
};
export const timelyHead = (att_inc_delay: number, att_valid_head: boolean): number => {
  if (att_valid_head && att_inc_delay == 1) return TIMELY_HEAD_WEIGHT;
  else return 0;
};
export const attestationRewards = (
  att_inc_delay: number,
  att_valid_source: boolean,
  att_valid_target: boolean,
  att_valid_head: boolean,
) => {
  return {
    source: timelySource(att_inc_delay, att_valid_source) / WEIGHT_DENOMINATOR,
    target: timelyTarget(att_inc_delay, att_valid_target) / WEIGHT_DENOMINATOR,
    head: timelyHead(att_inc_delay, att_valid_head) / WEIGHT_DENOMINATOR,
  };
};

// Penalties
const untimelySource = (att_inc_delay: number, att_valid_source: boolean): number => {
  if (!timelySource(att_inc_delay, att_valid_source)) return TIMELY_SOURCE_WEIGHT;
  else return 0;
};
const untimelyTarget = (att_inc_delay: number, att_valid_target: boolean): number => {
  if (!timelyTarget(att_inc_delay, att_valid_target)) return TIMELY_TARGET_WEIGHT;
  else return 0;
};
const untimelyHead = (att_inc_delay: number, att_valid_head: boolean): number => {
  if (!timelyHead(att_inc_delay, att_valid_head)) return 0;
  else return 0;
};
export const attestationPenalties = (
  att_inc_delay: number,
  att_valid_source: boolean,
  att_valid_target: boolean,
  att_valid_head: boolean,
) => {
  return {
    source: untimelySource(att_inc_delay, att_valid_source) / WEIGHT_DENOMINATOR,
    target: untimelyTarget(att_inc_delay, att_valid_target) / WEIGHT_DENOMINATOR,
    head: untimelyHead(att_inc_delay, att_valid_head) / WEIGHT_DENOMINATOR,
  };
};
