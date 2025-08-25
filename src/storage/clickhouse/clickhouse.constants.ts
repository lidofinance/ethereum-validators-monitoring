import { Epoch, ValStatus } from 'common/types/types';

const perfStatuses = [ValStatus.ActiveOngoing, ValStatus.ActiveExiting, ValStatus.ActiveSlashed, ValStatus.PendingInitialized]
  .map((s) => `'${s}'`)
  .join(',');

export const avgValidatorBalanceDelta = (epoch: Epoch): string => `
  SELECT
    current.val_nos_module_id AS val_nos_module_id,
    current.val_nos_id AS val_nos_id,
    avg(current.val_balance - previous.val_balance + ifNull(withdrawals.withdrawn, 0)) AS amount
  FROM (
    SELECT val_balance, val_id, val_nos_module_id, val_nos_id
    FROM validators_summary
    WHERE
      val_status in [${perfStatuses}] AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = ${epoch}
    LIMIT 1 BY val_id
  ) AS current
  INNER JOIN (
    SELECT val_balance, val_id, val_nos_id
    FROM validators_summary
    WHERE
      val_status in [${perfStatuses}] AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = (${epoch} - 6)
    LIMIT 1 BY val_id
  ) AS previous
  ON
    previous.val_id = current.val_id
  LEFT JOIN (
    SELECT
      sum(val_balance_withdrawn) AS withdrawn, val_id, val_nos_id, val_nos_module_id
    FROM (
      SELECT val_balance_withdrawn, val_id, val_nos_module_id, val_nos_id
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND
        val_status in [${perfStatuses}] AND
        val_balance_withdrawn > 0 AND
        val_stuck = 0 AND
        epoch > (${epoch} - 6) AND epoch <= ${epoch}
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_id, val_nos_id, val_nos_module_id
  ) AS withdrawals
  ON
    withdrawals.val_id = current.val_id
  GROUP BY current.val_nos_module_id, current.val_nos_id
`;

export const validatorQuantile0001BalanceDeltasQuery = (epoch: Epoch): string => `
  SELECT
    current.val_nos_module_id AS val_nos_module_id,
    current.val_nos_id AS val_nos_id,
    quantileExact(0.001)(current.val_balance - previous.val_balance + ifNull(withdrawals.withdrawn, 0)) AS amount
  FROM (
    SELECT val_balance, val_id, val_nos_id, val_nos_module_id
    FROM validators_summary
    WHERE
      val_status in [${perfStatuses}] AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = ${epoch}
    LIMIT 1 BY val_id
  ) AS current
  INNER JOIN (
    SELECT val_balance, val_id, val_nos_id
    FROM validators_summary
    WHERE
      val_status in [${perfStatuses}] AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = (${epoch} - 6)
    LIMIT 1 BY val_id
  ) AS previous
  ON
    previous.val_id = current.val_id
  LEFT JOIN (
    SELECT
      sum(val_balance_withdrawn) AS withdrawn, val_id, val_nos_module_id, val_nos_id
    FROM (
      SELECT val_balance_withdrawn, val_id, val_nos_module_id, val_nos_id
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND
        val_status in [${perfStatuses}] AND
        val_balance_withdrawn > 0 AND
        val_stuck = 0 AND
        epoch > (${epoch} - 6) AND epoch <= ${epoch}
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_id, val_nos_id, val_nos_module_id
  ) AS withdrawals
  ON
    withdrawals.val_id = current.val_id
  GROUP BY current.val_nos_module_id, current.val_nos_id
`;

export const validatorsCountWithNegativeDeltaQuery = (epoch: Epoch): string => `
  SELECT
    current.val_nos_module_id AS val_nos_module_id,
    current.val_nos_id AS val_nos_id,
    count(current.val_id) AS amount
  FROM (
      SELECT val_balance, val_id, val_nos_module_id, val_nos_id, val_slashed
      FROM validators_summary
      WHERE
        val_status in [${perfStatuses}] AND
        val_nos_id IS NOT NULL AND
        val_stuck = 0 AND
        epoch = ${epoch}
      LIMIT 1 BY val_id
  ) AS current
  INNER JOIN (
    SELECT val_balance, val_id, val_nos_id
    FROM validators_summary
    WHERE
      val_status in [${perfStatuses}] AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = (${epoch} - 6)
    LIMIT 1 BY val_id
  ) AS previous
  ON
    previous.val_id = current.val_id
  LEFT JOIN (
    SELECT
      sum(val_balance_withdrawn) AS withdrawn, val_id, val_nos_module_id, val_nos_id
    FROM (
      SELECT val_balance_withdrawn, val_id, val_nos_module_id, val_nos_id
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND
        val_status in [${perfStatuses}] AND
        val_balance_withdrawn > 0 AND
        val_stuck = 0 AND
        (${epoch} - 6) < epoch AND epoch <= ${epoch}
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_id, val_nos_id, val_nos_module_id
  ) AS withdrawals
  ON
    withdrawals.val_id = current.val_id
  GROUP BY current.val_nos_module_id, current.val_nos_id
  HAVING (current.val_balance - previous.val_balance + ifNull(withdrawals.withdrawn, 0)) < 0 AND current.val_slashed = 0
`;

export const validatorsCountWithSyncParticipationByConditionLastNEpochQuery = (
  epoch: Epoch,
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
      val_nos_module_id,
      val_nos_id,
      count() AS amount
    FROM (
      SELECT
        val_nos_module_id,
        val_nos_id,
        count() AS count_fail
      FROM (
        SELECT val_id, val_nos_module_id, val_nos_id
        FROM validators_summary
        WHERE
          is_sync = 1 AND
          ${condition} AND
          val_stuck = 0 AND
          (${epoch} - ${epochInterval}) < epoch AND epoch <= ${epoch}
          ${strFilterValIndexes}
        LIMIT 1 BY epoch, val_id
      )
      GROUP BY val_id, val_nos_module_id, val_nos_id
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY val_nos_module_id, val_nos_id
  `;
};

export const validatorCountByConditionAttestationLastNEpochQuery = (
  epoch: Epoch,
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
      val_nos_module_id,
      val_nos_id,
      count() AS amount
    FROM (
      SELECT
        val_nos_module_id,
        val_nos_id,
        count() AS count_fail
      FROM (
        SELECT val_id, val_nos_module_id, val_nos_id
        FROM validators_summary
        WHERE
          ${condition} AND
          val_stuck = 0 AND
          (${epoch} - ${epochInterval}) < epoch AND epoch <= ${epoch}
          ${strFilterValIndexes}
        LIMIT 1 BY epoch, val_id
      )
      GROUP BY val_id, val_nos_module_id, val_nos_id
    )
    WHERE count_fail = ${epochInterval}
    GROUP BY val_nos_module_id, val_nos_id
  `;
};

export const validatorsCountByConditionMissProposeQuery = (epoch: Epoch, validatorIndexes: string[] = [], condition: string): string => {
  let strFilterValIndexes = '';
  if (validatorIndexes.length > 0) {
    strFilterValIndexes = `AND val_id in [${validatorIndexes.map((i) => `'${i}'`).join(',')}]`;
  }

  return `
    SELECT
      val_nos_module_id,
      val_nos_id,
      count() AS amount
    FROM (
      SELECT val_nos_module_id, val_nos_id
      FROM validators_summary
      WHERE
        is_proposer = 1 AND
        ${condition} AND
        val_stuck = 0 AND
        (${epoch} - 1) < epoch AND epoch <= ${epoch}
        ${strFilterValIndexes}
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_nos_module_id, val_nos_id
  `;
};

export const userSyncParticipationAvgPercentQuery = (epoch: Epoch): string => `
  SELECT
    val_nos_module_id,
    avg(sync_percent) AS amount
  FROM (
    SELECT val_nos_module_id, sync_percent
    FROM validators_summary
    WHERE
      is_sync = 1 AND val_nos_id IS NOT NULL AND val_stuck = 0 AND epoch = ${epoch}
    LIMIT 1 BY val_id
  )
  GROUP BY val_nos_module_id
`;

export const otherSyncParticipationAvgPercentQuery = (epoch: Epoch): string => `
  SELECT
    avg(sync_percent) AS amount
  FROM (
    SELECT sync_percent
    FROM validators_summary
    WHERE
      is_sync = 1 AND val_nos_id IS NULL AND epoch = ${epoch}
    LIMIT 1 BY val_id
  )
`;

export const chainSyncParticipationAvgPercentQuery = (epoch: Epoch): string => `
  SELECT
    avg(sync_percent) AS amount
  FROM (
    SELECT sync_percent
    FROM validators_summary
    WHERE
      is_sync = 1 AND epoch = ${epoch}
    LIMIT 1 BY val_id
  )
`;

export const operatorsSyncParticipationAvgPercentsQuery = (epoch: Epoch): string => `
  SELECT
    val_nos_module_id,
    val_nos_id,
    avg(sync_percent) AS amount
  FROM (
    SELECT val_nos_module_id, val_nos_id, sync_percent
    FROM validators_summary
    WHERE
      is_sync = 1 AND val_nos_id IS NOT NULL AND val_stuck = 0 AND epoch = ${epoch}
    LIMIT 1 BY val_id
  )
  GROUP BY val_nos_module_id, val_nos_id
`;

export const totalBalance24hDifferenceQuery = (epoch: Epoch): string => `
  SELECT
    curr.val_nos_module_id AS val_nos_module_id,
    SUM(curr.val_balance - previous.val_balance + ifNull(withdrawals.withdrawn, 0)) AS amount
  FROM (
    SELECT val_balance, val_id, val_nos_module_id
    FROM validators_summary
    WHERE
      val_status != '${ValStatus.PendingQueued}' AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = ${epoch}
    LIMIT 1 BY val_id
  ) AS curr
  INNER JOIN (
    SELECT val_balance, val_id
    FROM validators_summary
    WHERE
      val_status != '${ValStatus.PendingQueued}' AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = ${epoch} - 225
    LIMIT 1 BY val_id
  ) AS previous
  ON
    previous.val_id = curr.val_id
  LEFT JOIN (
    SELECT
      sum(val_balance_withdrawn) AS withdrawn, val_id
    FROM (
      SELECT val_balance_withdrawn, val_id
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND
        val_status != '${ValStatus.WithdrawalDone}' AND
        val_balance_withdrawn > 0 AND
        val_stuck = 0 AND
        epoch > (${epoch} - 225) AND epoch <= ${epoch}
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_id
  ) AS withdrawals
  ON
    withdrawals.val_id = curr.val_id
  GROUP BY curr.val_nos_module_id
`;

export const operatorBalance24hDifferenceQuery = (epoch: Epoch): string => `
  SELECT
    curr.val_nos_module_id AS val_nos_module_id,
    curr.val_nos_id AS val_nos_id,
    SUM(curr.val_balance - previous.val_balance + ifNull(withdrawals.withdrawn, 0)) AS amount
  FROM (
    SELECT val_balance, val_id, val_nos_module_id, val_nos_id
    FROM validators_summary
    WHERE
      val_status != '${ValStatus.PendingQueued}' AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = ${epoch}
    LIMIT 1 BY val_id
  ) AS curr
  INNER JOIN (
    SELECT val_balance, val_id, val_nos_id
    FROM validators_summary
    WHERE
      val_status != '${ValStatus.PendingQueued}' AND
      val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      epoch = ${epoch} - 225
    LIMIT 1 BY val_id
  ) AS previous
  ON
    previous.val_nos_id = curr.val_nos_id AND
    previous.val_id = curr.val_id
  LEFT JOIN (
    SELECT
      sum(val_balance_withdrawn) AS withdrawn, val_id, val_nos_id
    FROM (
      SELECT val_balance_withdrawn, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND
        val_balance_withdrawn > 0 AND
        val_stuck = 0 AND
        epoch > (${epoch} - 225) AND epoch <= ${epoch}
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_id, val_nos_id
  ) AS withdrawals
  ON
    withdrawals.val_nos_id = curr.val_nos_id AND
    withdrawals.val_id = curr.val_id
  GROUP BY curr.val_nos_module_id, curr.val_nos_id
`;

export const userNodeOperatorsStatsQuery = (epoch: Epoch): string => `
  SELECT
    val_nos_module_id,
    val_nos_id,
    SUM(a) AS active_ongoing,
    SUM(p) AS pending,
    SUM(s) AS slashed,
    ifNull(SUM(wp), 0) AS withdraw_pending,
    ifNull(SUM(w), 0) AS withdrawn,
    SUM(st) AS stuck
  FROM (
    SELECT
      val_nos_module_id,
      val_nos_id,
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) AS a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) AS p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) AS s,
      IF(
        (val_status in ['${ValStatus.ActiveExiting}','${ValStatus.ExitedUnslashed}', '${ValStatus.ExitedSlashed}'])
        OR
        (val_status == '${ValStatus.WithdrawalPossible}' AND val_balance != 0),
        count(val_status), 0
      ) AS wp,
      IF(
        (val_status == '${ValStatus.WithdrawalDone}')
        OR
        (val_status == '${ValStatus.WithdrawalPossible}' AND val_balance == 0),
        count(val_status), 0
      ) AS w,
      IF (val_stuck = 1, count(val_stuck), 0) AS st
    FROM (
      SELECT val_nos_module_id, val_nos_id, val_status, val_slashed, val_balance, val_stuck
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND epoch = ${epoch}
      LIMIT 1 BY val_id
    )
    GROUP BY val_nos_module_id, val_nos_id, val_status, val_slashed, val_balance, val_stuck
  )
  GROUP by val_nos_module_id, val_nos_id
`;

export const userValidatorsSummaryStatsQuery = (epoch: Epoch): string => `
  SELECT
    val_nos_module_id,
    SUM(a) AS active_ongoing,
    SUM(p) AS pending,
    SUM(s) AS slashed,
    ifNull(SUM(wp), 0) AS withdraw_pending,
    ifNull(SUM(w), 0) AS withdrawn,
    SUM(st) AS stuck
  FROM (
    SELECT
      val_nos_module_id,
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) AS a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) AS p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) AS s,
      IF(
        (val_status in ['${ValStatus.ActiveExiting}','${ValStatus.ExitedUnslashed}', '${ValStatus.ExitedSlashed}'])
        OR
        (val_status == '${ValStatus.WithdrawalPossible}' AND val_balance != 0),
        count(val_status), 0
      ) AS wp,
      IF(
        (val_status == '${ValStatus.WithdrawalDone}')
        OR
        (val_status == '${ValStatus.WithdrawalPossible}' AND val_balance == 0),
        count(val_status), 0
      ) AS w,
      IF (val_stuck = 1, count(val_stuck), 0) AS st
    FROM (
      SELECT val_nos_module_id, val_status, val_slashed, val_balance, val_stuck
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND epoch = ${epoch}
      LIMIT 1 BY val_id
    )
    GROUP BY val_nos_module_id, val_status, val_slashed, val_balance, val_stuck
  )
  GROUP by val_nos_module_id
`;

export const otherValidatorsSummaryStatsQuery = (epoch: Epoch): string => `
  SELECT
    SUM(a) AS active_ongoing,
    SUM(p) AS pending,
    SUM(s) AS slashed,
    ifNull(SUM(wp), 0) AS withdraw_pending,
    ifNull(SUM(w), 0) AS withdrawn
  FROM (
    SELECT
      IF(val_status = '${ValStatus.ActiveOngoing}', count(val_status), 0) AS a,
      IF(val_status = '${ValStatus.PendingQueued}' OR val_status = '${ValStatus.PendingInitialized}', count(val_status), 0) AS p,
      IF(val_status = '${ValStatus.ActiveSlashed}' OR val_status = '${ValStatus.ExitedSlashed}' OR val_slashed = 1, count(val_status), 0) AS s,
      IF(
        (val_status in ['${ValStatus.ActiveExiting}','${ValStatus.ExitedUnslashed}', '${ValStatus.ExitedSlashed}'])
        OR
        (val_status == '${ValStatus.WithdrawalPossible}' AND val_balance != 0),
        count(val_status), 0
      ) AS wp,
      IF(
        (val_status == '${ValStatus.WithdrawalDone}')
        OR
        (val_status == '${ValStatus.WithdrawalPossible}' AND val_balance == 0),
        count(val_status), 0
      ) AS w
    FROM (
      SELECT val_status, val_slashed, val_balance
      FROM validators_summary
      WHERE
        val_nos_id IS NULL AND epoch = ${epoch}
      LIMIT 1 BY val_id
    )
    GROUP BY val_status, val_slashed, val_balance
  )
`;

export const userNodeOperatorsProposesStatsLastNEpochQuery = (epoch: Epoch, epochInterval = 120): string => `
  SELECT
    val_nos_module_id,
    val_nos_id,
    SUM(a) AS all,
    SUM(m) AS missed
  FROM (
    SELECT
      val_nos_module_id,
      val_nos_id,
      COUNT(block_proposed) AS a,
      IF(block_proposed = 0, count(block_proposed), 0) AS m
    FROM (
      SELECT val_nos_module_id, val_nos_id, block_proposed
      FROM validators_summary
      WHERE
        is_proposer = 1 AND val_stuck = 0 AND (epoch <= ${epoch} AND epoch > (${epoch} - ${epochInterval}))
      LIMIT 1 BY epoch, val_id
    )
    GROUP BY val_nos_module_id, val_nos_id, block_proposed
  )
  GROUP BY val_nos_module_id, val_nos_id
`;

export const epochMetadata = (epoch: Epoch): string => `
  SELECT *
  FROM epochs_metadata
  WHERE epoch = ${epoch}
`;

export const epochProcessing = (epoch: Epoch): string => `
  SELECT *
  FROM epochs_processing
  WHERE epoch = ${epoch}
`;

export const userNodeOperatorsRewardsAndPenaltiesStats = (epoch: Epoch): string => `
  SELECT
    att.val_nos_module_id AS val_nos_module_id,
    att.val_nos_id AS val_nos_id,
    --
    attestation_reward AS att_reward,
    ifNull(prop_reward, 0) AS prop_reward,
    ifNull(sync_reward, 0) AS sync_reward,
    attestation_missed AS att_missed,
    ifNull(prop_missed, 0) AS prop_missed,
    ifNull(sync_missed, 0) AS sync_missed,
    attestation_penalty AS att_penalty,
    ifNull(prop_penalty, 0) AS prop_penalty,
    ifNull(sync_penalty, 0) AS sync_penalty,
    --
    att_reward + prop_reward + sync_reward AS total_reward,
    att_missed + prop_missed + sync_missed AS total_missed,
    att_penalty + prop_penalty + sync_penalty AS total_penalty,
    total_reward - total_penalty AS calculated_balance_change,
    real_balance_change,
    calculated_balance_change - real_balance_change AS calculation_error
  FROM (
    SELECT
      val_nos_module_id,
      val_nos_id,
      sum(att_earned_reward) AS attestation_reward,
      sum(att_missed_reward) AS attestation_missed,
      sum(att_penalty) AS attestation_penalty
    FROM (
      SELECT val_nos_module_id, val_nos_id, att_earned_reward, att_missed_reward, att_penalty
      FROM validators_summary
      WHERE val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      val_status != '${ValStatus.PendingInitialized}' AND
      epoch = ${epoch} - 1
      LIMIT 1 BY val_id
    )
    GROUP BY val_nos_module_id, val_nos_id
  ) AS att
  LEFT JOIN (
    SELECT
      val_nos_module_id,
      val_nos_id,
      sum(propose_earned_reward) AS prop_reward,
      sum(propose_missed_reward) AS prop_missed,
      sum(propose_penalty) AS prop_penalty
    FROM (
      SELECT val_nos_module_id, val_nos_id, propose_earned_reward, propose_missed_reward, propose_penalty
      FROM validators_summary
      WHERE val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      val_status != '${ValStatus.PendingInitialized}' AND
      epoch = ${epoch} AND
      is_proposer = 1
      LIMIT 1 BY val_id
    )
    GROUP BY val_nos_module_id, val_nos_id
	) AS prop
	ON
	  att.val_nos_module_id = prop.val_nos_module_id AND
	  att.val_nos_id = prop.val_nos_id
  LEFT JOIN (
    SELECT
      val_nos_module_id,
      val_nos_id,
      sum(sync_earned_reward) AS sync_reward,
      sum(sync_missed_reward) AS sync_missed,
      sum(sync_penalty) AS sync_penalty
    FROM (
      SELECT val_nos_module_id, val_nos_id, sync_earned_reward, sync_missed_reward, sync_penalty
      FROM validators_summary
      WHERE val_nos_id IS NOT NULL AND
      val_stuck = 0 AND
      val_status != '${ValStatus.PendingInitialized}' AND
      epoch = ${epoch} AND
      is_sync = 1
      LIMIT 1 BY val_id
    )
    GROUP BY val_nos_module_id, val_nos_id
  ) AS sync
  ON
    att.val_nos_module_id = sync.val_nos_module_id AND
    att.val_nos_id = sync.val_nos_id
  LEFT JOIN (
    SELECT
      current.val_nos_module_id AS val_nos_module_id,
      current.val_nos_id AS val_nos_id,
      sum(current.val_balance - previous.val_balance + ifNull(withdrawals.withdrawn, 0)) AS real_balance_change
    FROM (
      SELECT val_balance, val_id, val_nos_module_id, val_nos_id
      FROM validators_summary AS curr
      WHERE
        val_nos_id IS NOT NULL AND
        val_stuck = 0 AND
        val_status != '${ValStatus.PendingInitialized}' AND
        epoch = ${epoch}
      LIMIT 1 BY val_id
    ) AS current
    INNER JOIN (
      SELECT val_balance, val_id, val_nos_id
      FROM validators_summary
      WHERE
        val_nos_id IS NOT NULL AND
        val_stuck = 0 AND
        val_status != '${ValStatus.PendingInitialized}' AND
        epoch = (${epoch} - 1)
      LIMIT 1 BY val_id
    ) AS previous ON previous.val_id = current.val_id
    LEFT JOIN (
      SELECT
        sum(val_balance_withdrawn) AS withdrawn, val_id, val_nos_id
      FROM (
        SELECT val_balance_withdrawn, val_id, val_nos_id
        FROM validators_summary
        WHERE
          val_nos_id IS NOT NULL AND
          val_status != '${ValStatus.WithdrawalDone}' AND
          val_status != '${ValStatus.PendingInitialized}' AND
          val_balance_withdrawn > 0 AND
          val_stuck = 0 AND
          epoch = ${epoch}
        LIMIT 1 BY val_id
      )
      GROUP BY val_id, val_nos_id
    ) AS withdrawals
    ON
      withdrawals.val_id = current.val_id
    GROUP BY current.val_nos_module_id, current.val_nos_id
  ) AS bal
  ON
    att.val_nos_module_id = bal.val_nos_module_id AND
    att.val_nos_id = bal.val_nos_id
`;

export const avgChainRewardsAndPenaltiesStats = (epoch: Epoch): string => `
  SELECT
    attestation_reward AS att_reward,
    ifNull(prop_reward, 0) AS prop_reward,
    ifNull(sync_reward, 0) AS sync_reward,
    attestation_missed AS att_missed,
    ifNull(prop_missed, 0) AS prop_missed,
    ifNull(sync_missed, 0) AS sync_missed,
    attestation_penalty AS att_penalty,
    ifNull(prop_penalty, 0) AS prop_penalty,
    ifNull(sync_penalty, 0) AS sync_penalty
  FROM (
    SELECT
      avgIf(att_earned_reward, att_earned_reward > 0) AS attestation_reward,
      avgIf(att_missed_reward, att_missed_reward > 0) AS attestation_missed,
      avgIf(att_penalty, att_penalty > 0) AS attestation_penalty
    FROM (
      SELECT att_earned_reward, att_missed_reward, att_penalty
      FROM validators_summary
      WHERE epoch = ${epoch} - 1
      LIMIT 1 BY val_id
    )
  ) AS att,
	(
    SELECT
      avgIf(propose_earned_reward, propose_earned_reward > 0) AS prop_reward,
      avgIf(propose_missed_reward, propose_missed_reward > 0) AS prop_missed,
      avg(propose_penalty) AS prop_penalty
    FROM (
      SELECT propose_earned_reward, propose_missed_reward, propose_penalty
      FROM validators_summary
      WHERE epoch = ${epoch} and is_proposer = 1
      LIMIT 1 BY val_id
    )
	) AS prop,
  (
    SELECT
      avgIf(sync_earned_reward, sync_earned_reward > 0) AS sync_reward,
      avgIf(sync_missed_reward, sync_missed_reward > 0) AS sync_missed,
      avgIf(sync_penalty, sync_penalty > 0) AS sync_penalty
    FROM (
      SELECT sync_earned_reward, sync_missed_reward, sync_penalty
      FROM validators_summary
      WHERE epoch = ${epoch} and is_sync = 1
      LIMIT 1 BY val_id
    )
  ) AS sync
`;

export const userNodeOperatorsWithdrawalsStats = (epoch: Epoch): string => `
  SELECT
    val_nos_module_id,
    val_nos_id,
    ifNull(
      sumIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance == 0
      ),
      0
    ) AS full_withdrawn_sum,
    ifNull(
      sumIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance != 0
      ),
      0
    ) AS partial_withdrawn_sum,
    ifNull(
      countIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance == 0
      ),
      0
    ) AS full_withdrawn_count,
    ifNull(
      countIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance != 0
      ),
      0
    ) AS partial_withdrawn_count
  FROM (
    SELECT val_balance_withdrawn, val_balance, val_id, val_nos_module_id, val_nos_id
    FROM validators_summary
    WHERE
      val_nos_id IS NOT NULL AND
      val_balance_withdrawn > 0 AND
      val_stuck = 0 AND
      epoch = ${epoch}
    LIMIT 1 BY val_id
  )
  GROUP BY val_nos_module_id, val_nos_id
`;

export const otherChainWithdrawalsStats = (epoch: Epoch): string => `
  SELECT
    ifNull(
      sumIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance == 0
      ),
      0
    ) AS full_withdrawn_sum,
    ifNull(
      sumIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance != 0
      ),
      0
    ) AS partial_withdrawn_sum,
    ifNull(
      countIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance == 0
      ),
      0
    ) AS full_withdrawn_count,
    ifNull(
      countIf(
        val_balance_withdrawn,
        val_balance_withdrawn > 0 AND val_balance != 0
      ),
      0
    ) AS partial_withdrawn_count
  FROM (
    SELECT val_balance_withdrawn, val_balance, val_id, val_nos_id
    FROM validators_summary
    WHERE
      val_nos_id IS NULL AND
      val_balance_withdrawn > 0 AND
      epoch = ${epoch}
    LIMIT 1 BY val_id
  )
`;
