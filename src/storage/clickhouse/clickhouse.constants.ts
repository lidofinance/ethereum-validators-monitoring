import { ValStatus } from 'common/eth-providers';

export const avgValidatorBalanceDelta = (epoch: bigint): string => `
  SELECT
    val_nos_id,
    avg(current.val_balance - previous.val_balance) AS delta
  FROM
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
  INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 6)
    ) AS previous
  ON
    previous.val_id = current.val_id
  GROUP BY val_nos_id
`;

export const validatorQuantile0001BalanceDeltasQuery = (epoch: bigint): string => `
  SELECT
    val_nos_id,
    quantileExact(0.001)(current.val_balance - previous.val_balance) AS delta
  FROM
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
  INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 6)
    ) AS previous
  ON
    previous.val_id = current.val_id
  GROUP BY val_nos_id
`;

export const validatorsCountWithNegativeDeltaQuery = (epoch: bigint): string => `
  SELECT
    val_nos_id,
    count(val_id) AS neg_count
  FROM
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
  INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 6)
    ) AS previous
  ON
    previous.val_id = current.val_id
  GROUP BY val_nos_id
  HAVING (current.val_balance - previous.val_balance) < 0
`;

export const validatorsCountWithSyncParticipationByConditionLastNEpochQuery = (
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
      val_nos_id,
      count() as amount
    FROM (
      SELECT
        val_nos_id,
        count() AS count_fail
      FROM (
        SELECT val_id, val_nos_id
        FROM validators_summary
        WHERE
          is_sync = 1 AND
          ${condition} AND
          (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
          ${strFilterValIndexes}
      )
      GROUP BY val_id, val_nos_id
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY val_nos_id
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
      val_nos_id,
      count() as amount
    FROM (
      SELECT
        val_nos_id,
        count() as count_fail
      FROM (
        SELECT val_id, val_nos_id
        FROM validators_summary
        WHERE
          ${condition}
          AND (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
          ${strFilterValIndexes}
      )
      GROUP BY val_id, val_nos_id
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY val_nos_id
  `;
};

export const validatorCountHighAvgIncDelayAttestationOfNEpochQuery = (epoch: bigint, epochInterval: number): string => {
  return `
    SELECT
      val_nos_id,
      count() as amount
    FROM (
      SELECT
        val_nos_id,
        avg(att_inc_delay) as avg_inclusion_delay
      FROM (
        SELECT val_id, val_nos_id, att_inc_delay
        FROM validators_summary
        WHERE
          (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
      )
      GROUP BY val_id, val_nos_id
      HAVING avg_inclusion_delay > 2
    )
    GROUP BY val_nos_id
  `;
};

export const validatorsCountByConditionMissProposeQuery = (epoch: bigint, validatorIndexes: string[] = [], condition: string): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND val_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }
  return `
    SELECT
      val_nos_id,
      count() as amount
    FROM (
      SELECT val_nos_id
      FROM validators_summary
      WHERE
        is_proposer = 1 AND
        ${condition} AND
        (epoch <= ${epoch} AND epoch > (${epoch} - 1))
        ${strFilterValIndexes}
    )
    GROUP BY val_nos_id
  `;
};

export const userSyncParticipationAvgPercentQuery = (epoch: bigint): string => `
  SELECT
    avg(sync_percent) as avg_percent
  FROM validators_summary
  WHERE
    is_sync = 1 AND val_nos_id IS NOT NULL AND epoch = ${epoch}
`;

export const otherSyncParticipationAvgPercentQuery = (epoch: bigint): string => `
  SELECT
    avg(sync_percent) as avg_percent
  FROM validators_summary
  WHERE
    is_sync = 1 AND val_nos_id IS NULL AND epoch = ${epoch}
`;

export const chainSyncParticipationAvgPercentQuery = (epoch: bigint): string => `
  SELECT
    avg(sync_percent) as avg_percent
  FROM validators_summary
  WHERE
    is_sync = 1 AND epoch = ${epoch}
`;

export const operatorsSyncParticipationAvgPercentsQuery = (epoch: bigint): string => `
  SELECT
    val_nos_id,
    avg(sync_percent) as avg_percent
  FROM (
    SELECT val_nos_id, sync_percent
    FROM validators_summary
    WHERE
      is_sync = 1 AND val_nos_id IS NOT NULL AND epoch = ${epoch}
  )
  GROUP BY val_nos_id
`;

export const totalBalance24hDifferenceQuery = (epoch: bigint): string => `
  SELECT (
    SELECT SUM(curr.val_balance)
    FROM
      validators_summary AS curr
    INNER JOIN (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
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
    FROM validators_summary AS prev
    WHERE
      prev.epoch = ${epoch} - 225
      AND prev.val_status != '${ValStatus.PendingQueued}'
      AND prev.val_nos_id IS NOT NULL
  ) as prev_total_balance,
  curr_total_balance - prev_total_balance as total_diff
`;

export const operatorBalance24hDifferenceQuery = (epoch: bigint): string => `
  SELECT
    curr.val_nos_id as val_nos_id,
    SUM(curr.val_balance - previous.val_balance) as diff
  FROM
    validators_summary AS curr
  INNER JOIN (
    SELECT val_balance, val_id, val_nos_id
    FROM validators_summary
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
  GROUP BY curr.val_nos_id
`;

export const userNodeOperatorsStatsQuery = (epoch: bigint): string => `
  SELECT
    val_nos_id,
    SUM(a) as active_ongoing,
    SUM(p) as pending,
    SUM(s) as slashed
  FROM (
    SELECT
      val_nos_id,
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) as a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) as p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) as s
    FROM (
      SELECT val_nos_id, val_status, val_slashed
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL and epoch = ${epoch}
    )
    GROUP BY val_nos_id, val_status, val_slashed
  )
  GROUP by val_nos_id
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
    FROM validators_summary
    WHERE
      val_nos_id IS NOT NULL and epoch = ${epoch}
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
    FROM validators_summary
    WHERE
      val_nos_id IS NULL and epoch = ${epoch}
    GROUP BY val_status, val_slashed
  )
`;

export const userNodeOperatorsProposesStatsLastNEpochQuery = (epoch: bigint, epochInterval = 120): string => `
  SELECT
    val_nos_id,
    SUM(a) as all,
    SUM(m) as missed
  FROM
  (
    SELECT
      val_nos_id,
      count(block_proposed) as a,
      IF(block_proposed = 0, count(block_proposed), 0) as m
    FROM (
      SELECT val_nos_id, block_proposed
      FROM validators_summary
      WHERE
        is_proposer = 1 AND (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
    )
    GROUP BY val_nos_id, block_proposed
  )
  GROUP by val_nos_id
`;

export const epochMetadata = (epoch: bigint): string => `
  SELECT *
  FROM epochs_metadata
  WHERE epoch = ${epoch}
`;

export const userNodeOperatorsRewardsAndPenaltiesStats = (epoch: bigint): string => `
  SELECT
    att.val_nos_id as val_nos_id,
    bal.val_nos_name as val_nos_name,
    --
    attestation_reward as att_reward,
    ifNull(prop_reward, 0) as prop_reward,
    ifNull(sync_reward, 0) as sync_reward,
    attestation_missed as att_missed,
    ifNull(prop_missed, 0) as prop_missed,
    ifNull(sync_missed, 0) as sync_missed,
    attestation_penalty as att_penalty,
    ifNull(prop_penalty, 0) as prop_penalty,
    ifNull(sync_penalty, 0) as sync_penalty,
    --
    att_reward + prop_reward + sync_reward as total_reward,
    att_missed + prop_missed + sync_missed as total_missed,
    att_penalty + prop_penalty + sync_penalty as total_penalty,
    total_reward - total_penalty as calculated_balance_change,
    real_balance_change,
    abs(real_balance_change - calculated_balance_change) as calculation_error
  FROM
  (
    SELECT
      val_nos_id,
      sum(att_earned_reward) as attestation_reward,
      sum(att_missed_reward) as attestation_missed,
      sum(att_penalty) as attestation_penalty
    FROM validators_summary
    WHERE val_nos_id IS NOT NULL and epoch = ${epoch} - 2
    GROUP BY val_nos_id
  ) as att
  LEFT JOIN
	(
    SELECT
      val_nos_id,
      sum(propose_earned_reward) as prop_reward,
      sum(propose_missed_reward) as prop_missed,
      sum(propose_penalty) as prop_penalty
    FROM validators_summary
    WHERE val_nos_id IS NOT NULL and epoch = ${epoch} and is_proposer = 1
    GROUP BY val_nos_id
	) as prop ON att.val_nos_id = prop.val_nos_id
  LEFT JOIN
  (
    SELECT
      val_nos_id,
      sum(sync_earned_reward) as sync_reward,
      sum(sync_missed_reward) as sync_missed,
      sum(sync_penalty) as sync_penalty
    FROM validators_summary
    WHERE val_nos_id IS NOT NULL and epoch = ${epoch} and is_sync = 1
    GROUP BY val_nos_id
  ) as sync ON att.val_nos_id = sync.val_nos_id
  LEFT JOIN
  (
    SELECT
      val_nos_id,
      max(current.val_nos_name) as val_nos_name,
      sum(current.val_balance - previous.val_balance) AS real_balance_change
    FROM (
      SELECT val_balance, val_id, val_nos_id, val_nos_name
      FROM validators_summary as curr
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = ${epoch}
    ) AS current
    INNER JOIN
    (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_status != '${ValStatus.PendingQueued}' AND
        val_nos_id IS NOT NULL AND
        epoch = (${epoch} - 1)
    ) AS previous ON previous.val_id = current.val_id
    GROUP BY val_nos_id
  ) as bal ON att.val_nos_id = bal.val_nos_id
`;
