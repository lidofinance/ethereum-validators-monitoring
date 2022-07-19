


Get balance deltas percentiles
```clickhouse
select
    nos_id,
    nos_name,
    quantileExact(0)(curr.balance - prev.balance),
    quantileExact(0.1)(curr.balance - prev.balance),
    quantileExact(0.2)(curr.balance - prev.balance),
    quantileExact(0.3)(curr.balance - prev.balance),
    quantileExact(0.4)(curr.balance - prev.balance),
    quantileExact(0.5)(curr.balance - prev.balance),
    quantileExact(0.6)(curr.balance - prev.balance),
    quantileExact(0.7)(curr.balance - prev.balance),
    quantileExact(0.8)(curr.balance - prev.balance),
    quantileExact(0.9)(curr.balance - prev.balance),
    quantileExact(1)(curr.balance - prev.balance)
from validator_balances as curr
LEFT JOIN validator_balances AS prev ON prev.slot = (SELECT max(slot) - 32 * 6 FROM validator_balances) AND prev.validator_id = curr.validator_id
WHERE curr.slot = (SELECT max(slot) FROM validator_balances) AND curr.status != 'pending_queued' AND curr.nos_id IS NOT NULL
GROUP by nos_id, nos_name
ORDER BY nos_id
```

Get worst 10 validators
```clickhouse
SELECT nos_id, nos_name, curr.validator_id, (curr.balance - prev.balance) as delta FROM
    stats.validator_balances AS curr
    LEFT JOIN stats.validator_balances AS prev ON prev.slot = (SELECT max(slot) - 32 * 4 FROM stats.validator_balances) AND prev.nos_id = curr.nos_id AND prev.validator_id = curr.validator_id
WHERE curr.slot = (SELECT max(slot) FROM stats.validator_balances)
AND curr.status != 'pending_queued'
AND curr.nos_id IS NOT NULL
AND curr.nos_id = 1
ORDER BY delta ASC
LIMIT 10
```

Balances count for Lido validators
```clickhouse
SELECT count(*) FROM stats.validator_balances WHERE nos_id IS NOT NULL
```

Get all slots
```clickhouse
SELECT DISTINCT(slot) FROM stats.validator_balances
```

```clickhouse
SELECT toTimeZone(curr.slot_time, timeZone()) as time, timeZone() as TZ, nos_id, nos_name, curr.validator_id, concat('https://beaconcha.in/validator/',curr.validator_pubkey) as url, curr.balance - prev.balance as delta FROM
  stats.validator_balances AS curr
    LEFT JOIN stats.validator_balances AS prev ON prev.slot = (SELECT max(slot) - 32 * 6 FROM stats.validator_balances) AND prev.nos_id = curr.nos_id AND prev.validator_id = curr.validator_id
WHERE curr.slot = (SELECT max(slot) FROM stats.validator_balances)
  AND curr.status != 'pending_queued'
  AND curr.nos_id IS NOT NULL
  AND delta < 0
ORDER BY delta ASC
LIMIT 300
```


```clickhouse
SELECT (
    SELECT SUM(curr.balance) FROM
        stats.validator_balances AS curr
    WHERE
        curr.slot = (SELECT max(slot) FROM stats.validator_balances)
        AND curr.status != 'pending_queued'
        AND curr.nos_id IS NOT NULL
    ) as curr_total_balance,
    (

    SELECT SUM(prev.balance) FROM
        stats.validator_balances AS prev
    WHERE
        prev.slot = (SELECT max(slot) - 7200 FROM stats.validator_balances)
        AND prev.status != 'pending_queued'
        AND prev.nos_id IS NOT NULL
    ) as prev_total_balance,
    curr_total_balance - prev_total_balance as total_diff
```
