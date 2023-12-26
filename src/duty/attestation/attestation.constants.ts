// from https://eth2book.info/bellatrix/part2/incentives/rewards/
export const TIMELY_SOURCE_WEIGHT = 14; // Ws
export const TIMELY_TARGET_WEIGHT = 26; // Wt
export const TIMELY_HEAD_WEIGHT = 14; // Wh
const WEIGHT_DENOMINATOR = 64; // W sigma

const timelySource = (att_inc_delay: number, att_valid_source: boolean): boolean => {
  return att_valid_source && att_inc_delay <= 5;
};
const timelyTarget = (att_inc_delay: number, att_valid_source: boolean, att_valid_target: boolean, before_dencun): boolean => {
  return att_valid_source && att_valid_target && (!before_dencun || att_inc_delay <= 32);
};
const timelyHead = (att_inc_delay: number, att_valid_source: boolean, att_valid_target: boolean, att_valid_head: boolean): boolean => {
  return att_valid_source && att_valid_target && att_valid_head && att_inc_delay == 1;
};

export const getFlags = (
  att_inc_delay: number,
  att_valid_source: boolean,
  att_valid_target: boolean,
  att_valid_head: boolean,
  before_dencun: boolean,
) => {
  return {
    source: timelySource(att_inc_delay, att_valid_source),
    target: timelyTarget(att_inc_delay, att_valid_source, att_valid_target, before_dencun),
    head: timelyHead(att_inc_delay, att_valid_source, att_valid_target, att_valid_head),
  };
};

// Rewards
export const getRewards = (flags: {
  source: boolean;
  target: boolean;
  head: boolean;
}): { source: number; target: number; head: number } => {
  return {
    source: flags.source ? TIMELY_SOURCE_WEIGHT / WEIGHT_DENOMINATOR : 0,
    target: flags.target ? TIMELY_TARGET_WEIGHT / WEIGHT_DENOMINATOR : 0,
    head: flags.head ? TIMELY_HEAD_WEIGHT / WEIGHT_DENOMINATOR : 0,
  };
};

// Penalties
export const getPenalties = (flags: {
  source: boolean;
  target: boolean;
  head: boolean;
}): { source: number; target: number; head: number } => {
  return {
    source: flags.source ? 0 : TIMELY_SOURCE_WEIGHT / WEIGHT_DENOMINATOR,
    target: flags.target ? 0 : TIMELY_TARGET_WEIGHT / WEIGHT_DENOMINATOR,
    head: 0,
  };
};
