import { ValStatus } from 'common/eth-providers';

export const validatorBalancesDeltaQuery = (fetchInterval: number, slot: string): string => `
  SELECT
    nos_name,
    avg(current.balance - previous.balance) AS delta
  FROM
    (
      SELECT balance, validator_id, nos_name
      FROM stats.validator_balances
      WHERE
        status != '${ValStatus.PendingQueued}' AND
        nos_name IS NOT NULL AND
        slot = ${slot}
    ) AS current
  INNER JOIN
    (
      SELECT balance, validator_id, nos_name
      FROM stats.validator_balances
      WHERE
        status != '${ValStatus.PendingQueued}' AND
        nos_name IS NOT NULL AND
        slot = (${slot} - ${fetchInterval} * 6)
    ) AS previous
  ON
    previous.validator_id = current.validator_id
  GROUP BY nos_name
  ORDER BY delta DESC
`;

export const validatorQuantile0001BalanceDeltasQuery = (fetchInterval: number, slot: string): string => `
  SELECT
    nos_name,
    quantileExact(0.001)(current.balance - previous.balance) AS delta
  FROM
    (
      SELECT balance, validator_id, nos_name
      FROM stats.validator_balances
      WHERE
        status != '${ValStatus.PendingQueued}' AND
        nos_name IS NOT NULL AND
        slot = ${slot}
    ) AS current
  INNER JOIN
    (
      SELECT balance, validator_id, nos_name
      FROM stats.validator_balances
      WHERE
        status != '${ValStatus.PendingQueued}' AND
        nos_name IS NOT NULL AND
        slot = (${slot} - ${fetchInterval} * 6)
    ) AS previous
  ON
    previous.validator_id = current.validator_id
  GROUP BY nos_name
  ORDER BY delta DESC
`;

export const validatorsCountWithNegativeDeltaQuery = (fetchInterval: number, slot: string): string => `
  SELECT
    nos_name,
    COUNT(validator_id) AS neg_count
  FROM
    (
      SELECT balance, validator_id, nos_name
      FROM stats.validator_balances
      WHERE
        status != '${ValStatus.PendingQueued}' AND
        nos_name IS NOT NULL AND
        slot = ${slot}
    ) AS current
  INNER JOIN
    (
      SELECT balance, validator_id, nos_name
      FROM stats.validator_balances
      WHERE
        status != '${ValStatus.PendingQueued}' AND
        nos_name IS NOT NULL AND
        slot = (${slot} - ${fetchInterval} * 6)
    ) AS previous
  ON
    previous.validator_id = current.validator_id
  GROUP BY nos_name
  HAVING (current.balance - previous.balance) < 0
  ORDER BY neg_count DESC
`;

export const validatorsCountWithSyncParticipationLessChainAvgLastNEpochQuery = (
  slot: string | bigint | number,
  fetchInterval: number,
  epochInterval: number,
  distance: number,
  validatorIndexes: string[] = [],
): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND validator_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      nos_name,
      count() as less_chain_avg_count
    FROM (
      SELECT
        nos_name,
        count() AS count_fail
      FROM (
        SELECT
          validator_pubkey,
          nos_name
        FROM
          stats.validator_sync
        WHERE
          epoch_participation_percent < (epoch_chain_participation_percent_avg - ${distance}) AND
          (last_slot_of_epoch <= ${slot} AND last_slot_of_epoch > (${slot} - ${fetchInterval} * ${epochInterval}))
          ${strFilterValIndexes}
      )
      GROUP BY validator_pubkey, nos_name
      ORDER BY count_fail DESC, validator_pubkey
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY nos_name
  `;
};

export const validatorCountByConditionAttestationLastNEpochQuery = (
  fetchInterval: number,
  slot: string,
  epochInterval: number,
  validatorIndexes: string[] = [],
  condition: string,
): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND validator_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      nos_name,
      count() as suitable
    FROM (
      SELECT
        validator_pubkey,
        count() as count_fail,
        nos_name
      FROM (
        SELECT
          validator_pubkey,
          nos_name
        FROM stats.validator_attestations
        WHERE
          ${condition}
          AND (slot_to_attestation <= ${slot} AND slot_to_attestation > (${slot} - ${fetchInterval} * ${epochInterval}))
          ${strFilterValIndexes}
        ORDER BY slot_to_attestation DESC, validator_pubkey
      )
      GROUP BY validator_pubkey, nos_name
      ORDER BY count_fail DESC, validator_pubkey
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY nos_name
    ORDER BY suitable DESC
  `;
};

export const validatorCountHighAvgIncDelayAttestationOfNEpochQuery = (
  fetchInterval: number,
  slot: string,
  epochInterval: number,
): string => {
  return `
    SELECT
      nos_name,
      count() as suitable
    FROM (
      SELECT
        validator_pubkey,
        avg(inclusion_delay) as avg_inclusion_delay,
        nos_name
      FROM (
        SELECT
          validator_pubkey,
          nos_name,
          inclusion_delay
        FROM stats.validator_attestations
        WHERE
          (slot_to_attestation <= ${slot} AND slot_to_attestation > (${slot} - ${fetchInterval} * ${epochInterval}))
        ORDER BY slot_to_attestation DESC, validator_pubkey
      )
      GROUP BY validator_pubkey, nos_name
      ORDER BY avg_inclusion_delay DESC, validator_pubkey
    )
    WHERE avg_inclusion_delay > 2
    GROUP BY nos_name
    ORDER BY suitable DESC
  `;
};

export const validatorsCountWithMissProposeQuery = (fetchInterval: number, slot: string, validatorIndexes: string[] = []): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND validator_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      nos_name,
      count() as miss_propose_count
    FROM (
      SELECT
        validator_pubkey,
        nos_name
      FROM stats.validator_proposes
      WHERE
        proposed = 0 AND
        (slot_to_propose <= ${slot} AND slot_to_propose >= (${slot} - ${fetchInterval}))
        ${strFilterValIndexes}
      ORDER BY slot_to_propose DESC, validator_pubkey
    )
    GROUP BY nos_name
    ORDER BY miss_propose_count DESC
  `;
};

export const userSyncParticipationAvgPercentQuery = (slot: string | bigint | number): string => `
    SELECT
        avg(epoch_participation_percent) as avg_percent
    FROM
        stats.validator_sync
    WHERE last_slot_of_epoch = ${slot}
`;

export const operatorsSyncParticipationAvgPercentsQuery = (slot: string | bigint | number): string => `
    SELECT
        nos_name,
        avg(epoch_participation_percent) as avg_percent
    FROM
        stats.validator_sync
    WHERE last_slot_of_epoch = ${slot}
    GROUP BY nos_name
`;

export const totalBalance24hDifferenceQuery = (slot: string): string => `
  SELECT (
    SELECT SUM(curr.balance)
    FROM
      stats.validator_balances AS curr
    INNER JOIN
      (
        SELECT balance, validator_id, nos_id
        FROM stats.validator_balances
        WHERE
          status != '${ValStatus.PendingQueued}' AND
          nos_name IS NOT NULL AND
          slot = ${slot} - 7200
    ) AS previous
    ON
      previous.nos_id = curr.nos_id AND
      previous.validator_id = curr.validator_id
    WHERE
      curr.slot = ${slot}
      AND curr.status != '${ValStatus.PendingQueued}'
      AND curr.nos_id IS NOT NULL
  ) as curr_total_balance,
  (
    SELECT SUM(prev.balance)
    FROM stats.validator_balances AS prev
    WHERE
      prev.slot = ${slot} - 7200
      AND prev.status != '${ValStatus.PendingQueued}'
      AND prev.nos_id IS NOT NULL
  ) as prev_total_balance,
  curr_total_balance - prev_total_balance as total_diff
`;

export const operatorBalance24hDifferenceQuery = (slot: string): string => `
    SELECT
        nos_name,
        SUM(curr.balance - previous.balance) as diff
    FROM
      stats.validator_balances AS curr
    INNER JOIN
      (
        SELECT balance, validator_id, nos_id
        FROM stats.validator_balances
        WHERE
          status != '${ValStatus.PendingQueued}' AND
          nos_name IS NOT NULL AND
          slot = ${slot} - 7200
    ) AS previous
    ON
      previous.nos_id = curr.nos_id AND
      previous.validator_id = curr.validator_id
    WHERE
      curr.slot = ${slot}
      AND curr.status != '${ValStatus.PendingQueued}'
      AND curr.nos_id IS NOT NULL
    GROUP BY curr.nos_name
`;

export const userNodeOperatorsStatsQuery = (slot: string): string => `
  SELECT
    nos_name,
    SUM(a) as active_ongoing,
    SUM(p) as pending,
    SUM(s) as slashed
  FROM
  (
    SELECT
      nos_name,
      IF(status = '${ValStatus.ActiveOngoing}', count(status), 0) as a,
      IF(status = '${ValStatus.PendingQueued}' OR status = '${ValStatus.PendingInitialized}', count(status), 0) as p,
      IF(status = '${ValStatus.ActiveSlashed}' OR status = '${ValStatus.ExitedSlashed}' OR validator_slashed = 1, count(status), 0) as s
    FROM stats.validator_balances
    WHERE nos_id IS NOT NULL and slot = ${slot}
    GROUP BY nos_name, status, validator_slashed
  )
  GROUP by nos_name
`;

export const userValidatorsSummaryStatsQuery = (slot: string): string => `
  SELECT
    SUM(a) as active_ongoing,
    SUM(p) as pending,
    SUM(s) as slashed
  FROM
  (
    SELECT
      IF(status = '${ValStatus.ActiveOngoing}', count(status), 0) as a,
      IF(status = '${ValStatus.PendingQueued}' OR status = '${ValStatus.PendingInitialized}', count(status), 0) as p,
      IF(status = '${ValStatus.ActiveSlashed}' OR status = '${ValStatus.ExitedSlashed}' OR validator_slashed = 1, count(status), 0) as s
    FROM stats.validator_balances
    WHERE nos_id IS NOT NULL and slot = ${slot}
    GROUP BY status, validator_slashed
  )
`;

export const userNodeOperatorsProposesStatsLastNEpochQuery = (fetchInterval: number, slot: string, epochInterval = 120): string => `
  SELECT
    nos_name,
    SUM(a) as all,
    SUM(m) as missed
  FROM
  (
    SELECT
      nos_name,
      count(proposed) as a,
      IF(proposed = 0, count(proposed), 0) as m
    FROM stats.validator_proposes
    WHERE (slot_to_propose <= ${slot} AND slot_to_propose > (${slot} - ${fetchInterval} * ${epochInterval}))
    GROUP BY nos_name, proposed
  )
  GROUP by nos_name
`;

export const userValidatorIDsQuery = (slot: string): string => `
  SELECT validator_id, validator_pubkey
  FROM stats.validator_balances
  WHERE nos_id IS NOT NULL and slot = ${slot}
`;
