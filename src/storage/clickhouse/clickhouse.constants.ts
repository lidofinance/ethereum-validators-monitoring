import { ValStatus } from 'common/eth-providers';

export const validatorBalancesDeltaQuery = (epoch: bigint): string => `
  SELECT
    val_nos_name,
    avg(current.val_balance - previous.val_balance) AS delta
  FROM
    (
      SELECT val_balance, val_id, val_nos_name
      FROM stats.validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
  INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_name
      FROM stats.validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 6)
    ) AS previous
  ON
    previous.val_id = current.val_id
  GROUP BY val_nos_name
  ORDER BY delta DESC
`;

export const validatorQuantile0001BalanceDeltasQuery = (epoch: bigint): string => `
  SELECT
    val_nos_name,
    quantileExact(0.001)(current.val_balance - previous.val_balance) AS delta
  FROM
    (
      SELECT val_balance, val_id, val_nos_name
      FROM stats.validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
  INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_name
      FROM stats.validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 6)
    ) AS previous
  ON
    previous.val_id = current.val_id
  GROUP BY val_nos_name
  ORDER BY delta DESC
`;

export const validatorsCountWithNegativeDeltaQuery = (epoch: bigint): string => `
  SELECT
    val_nos_name,
    COUNT(val_id) AS neg_count
  FROM
    (
      SELECT val_balance, val_id, val_nos_name
      FROM stats.validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
  INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_name
      FROM stats.validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 6)
    ) AS previous
  ON
    previous.val_id = current.val_id
  GROUP BY val_nos_name
  HAVING (current.val_balance - previous.val_balance) < 0
  ORDER BY neg_count DESC
`;

export const validatorsCountWithSyncParticipationLessChainAvgLastNEpochQuery = (
  epoch: bigint,
  epochInterval: number,
  chainAvg: number,
  distance: number,
  validatorIndexes: string[] = [],
): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND val_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      val_nos_name,
      count() as less_chain_avg_count
    FROM (
      SELECT
        val_nos_name,
        count() AS count_fail
      FROM (
        SELECT
          val_id,
          val_nos_name
        FROM
          stats.validators_summary
        WHERE
          is_sync = 1 AND
          sync_percent < (${chainAvg} - ${distance}) AND
          (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
          ${strFilterValIndexes}
      )
      GROUP BY val_id, val_nos_name
      ORDER BY count_fail DESC, val_id
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY val_nos_name
  `;
};

export const validatorCountByConditionAttestationLastNEpochQuery = (
  epoch: bigint,
  epochInterval: number,
  validatorIndexes: string[] = [],
  condition: string,
): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND val_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      val_nos_name,
      count() as amount
    FROM (
      SELECT
        val_id,
        count() as count_fail,
        val_nos_name
      FROM (
        SELECT
          val_id,
          val_nos_name
        FROM stats.validators_summary
        WHERE
          ${condition}
          AND (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
          ${strFilterValIndexes}
        ORDER BY epoch DESC, val_id
      )
      GROUP BY val_id, val_nos_name
      ORDER BY count_fail DESC, val_id
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY val_nos_name
    ORDER BY amount DESC
  `;
};

export const validatorCountHighAvgIncDelayAttestationOfNEpochQuery = (epoch: bigint, epochInterval: number): string => {
  return `
    SELECT
      val_nos_name,
      count() as amount
    FROM (
      SELECT
        val_id,
        avg(att_inc_delay) as avg_inclusion_delay,
        val_nos_name
      FROM stats.validators_summary
      WHERE
        (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
      GROUP BY val_id, val_nos_name
      HAVING avg_inclusion_delay > 2
      ORDER BY avg_inclusion_delay DESC, val_id
    )
    GROUP BY val_nos_name
    ORDER BY amount DESC
  `;
};

export const validatorsCountWithMissProposeQuery = (epoch: bigint, validatorIndexes: string[] = []): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND val_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      val_nos_name,
      count() as miss_propose_count
    FROM (
      SELECT
        val_id,
        val_nos_name
      FROM stats.validators_summary
      WHERE
        is_proposer = 1 AND
        block_proposed = 0 AND
        (epoch <= ${epoch} AND epoch >= (${epoch} - 1))
        ${strFilterValIndexes}
      ORDER BY epoch DESC, val_id
    )
    GROUP BY val_nos_name
    ORDER BY miss_propose_count DESC
  `;
};

export const userSyncParticipationAvgPercentQuery = (epoch: bigint): string => `
    SELECT
        avg(sync_percent) as avg_percent
    FROM
        stats.validators_summary
    WHERE is_sync = 1 AND val_nos_id IS NOT NULL AND epoch = ${epoch}
`;

export const otherSyncParticipationAvgPercentQuery = (epoch: bigint): string => `
    SELECT
        avg(sync_percent) as avg_percent
    FROM
        stats.validators_summary
    WHERE is_sync = 1 AND val_nos_id IS NULL AND epoch = ${epoch}
`;

export const chainSyncParticipationAvgPercentQuery = (epoch: bigint): string => `
    SELECT
        avg(sync_percent) as avg_percent
    FROM
        stats.validators_summary
    WHERE is_sync = 1 AND epoch = ${epoch}
`;

export const operatorsSyncParticipationAvgPercentsQuery = (epoch: bigint): string => `
    SELECT
        val_nos_name,
        avg(sync_percent) as avg_percent
    FROM
        stats.validators_summary
    WHERE is_sync = 1 AND val_nos_id IS NOT NULL AND epoch = ${epoch}
    GROUP BY val_nos_name
`;

export const totalBalance24hDifferenceQuery = (epoch: bigint): string => `
  SELECT (
    SELECT SUM(curr.val_balance)
    FROM
      stats.validators_summary AS curr
    INNER JOIN
      (
        SELECT val_balance, val_id, val_nos_id
        FROM stats.validators_summary
        WHERE
          val_status != '${ValStatus.PendingQueued}' AND
          val_nos_id IS NOT NULL AND
          epoch = ${epoch} - 225
    ) AS previous
    ON
      previous.val_nos_id = curr.val_nos_id AND
      previous.val_id = curr.val_id
    WHERE
      curr.epoch = ${epoch}
      AND curr.val_status != '${ValStatus.PendingQueued}'
      AND curr.val_nos_id IS NOT NULL
  ) as curr_total_balance,
  (
    SELECT SUM(prev.val_balance)
    FROM stats.validators_summary AS prev
    WHERE
      prev.epoch = ${epoch} - 225
      AND prev.val_status != '${ValStatus.PendingQueued}'
      AND prev.val_nos_id IS NOT NULL
  ) as prev_total_balance,
  curr_total_balance - prev_total_balance as total_diff
`;

export const operatorBalance24hDifferenceQuery = (epoch: bigint): string => `
    SELECT
        val_nos_name,
        SUM(curr.val_balance - previous.val_balance) as diff
    FROM
      stats.validators_summary AS curr
    INNER JOIN
      (
        SELECT val_balance, val_id, val_nos_id
        FROM stats.validators_summary
        WHERE
          val_status != '${ValStatus.PendingQueued}' AND
          val_nos_id IS NOT NULL AND
          epoch = ${epoch} - 225
    ) AS previous
    ON
      previous.val_nos_id = curr.val_nos_id AND
      previous.val_id = curr.val_id
    WHERE
      curr.epoch = ${epoch}
      AND curr.val_status != '${ValStatus.PendingQueued}'
      AND curr.val_nos_id IS NOT NULL
    GROUP BY curr.val_nos_name
`;

export const userNodeOperatorsStatsQuery = (epoch: bigint): string => `
  SELECT
    val_nos_name,
    SUM(a) as active_ongoing,
    SUM(p) as pending,
    SUM(s) as slashed
  FROM
  (
    SELECT
      val_nos_name,
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) as a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) as p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) as s
    FROM stats.validators_summary
    WHERE val_nos_id IS NOT NULL and epoch = ${epoch}
    GROUP BY val_nos_name, val_status, val_slashed
  )
  GROUP by val_nos_name
`;

export const userValidatorsSummaryStatsQuery = (epoch: bigint): string => `
  SELECT
    SUM(a) as active_ongoing,
    SUM(p) as pending,
    SUM(s) as slashed
  FROM
  (
    SELECT
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) as a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) as p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) as s
    FROM stats.validators_summary
    WHERE val_nos_id IS NOT NULL and epoch = ${epoch}
    GROUP BY val_status, val_slashed
  )
`;

export const otherValidatorsSummaryStatsQuery = (epoch: bigint): string => `
  SELECT
    SUM(a) as active_ongoing,
    SUM(p) as pending,
    SUM(s) as slashed
  FROM
  (
    SELECT
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) as a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) as p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) as s
    FROM stats.validators_summary
    WHERE val_nos_id IS NULL and epoch = ${epoch}
    GROUP BY val_status, val_slashed
  )
`;

export const userNodeOperatorsProposesStatsLastNEpochQuery = (fetchInterval: number, slot: string, epochInterval = 120): string => `
  SELECT
    val_nos_name,
    SUM(a) as all,
    SUM(m) as missed
  FROM
  (
    SELECT
      val_nos_name,
      count(proposed) as a,
      IF(proposed = 0, count(proposed), 0) as m
    FROM stats.validator_proposes
    WHERE (slot_to_propose <= ${slot} AND slot_to_propose > (${slot} - ${fetchInterval} * ${epochInterval}))
    GROUP BY val_nos_name, proposed
  )
  GROUP by val_nos_name
`;

export const userValidatorIDsQuery = (slot: string): string => `
  SELECT validator_id, validator_pubkey
  FROM stats.validator_balances
  WHERE nos_id IS NOT NULL and slot = ${slot}
`;
