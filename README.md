# 🐢 ethereum-validators-monitoring (aka balval)

Consensus layer validators monitoring bot, that fetches Lido or Custom Users Node Operators keys
from Execution layer and checks their performance in Consensus
layer by: balance delta, attestations, proposals, sync committee participation.

Bot has two separate working modes: `finalized` and `head` for fetching validator info,
writes data to **Clickhouse**, displays aggregates by **Grafana**
dashboard, alerts about bad performance by **Prometheus + Alertmanger** and
routes notifications to Discord channel via **alertmanager-discord**.

## Working modes

You can switch working mode by providing `WORKING_MODE` environment variable with one of the following values:

### `finalized`
Default working mode. The service will fetch validators info from finalized states (the latest finalized epoch is 2 epochs back from `head`).
It is more stable and reliable because all data is already finalized.

**Pros**:
* No errors due to reorgs
* Less rewards calculation errors
* Accurate data in alerts and dashboard

**Cons**:
* 2 epochs delay in processing and critical alerts will be given with 2 epochs delay
* In case of long finality the app will not monitor and will wait for the finality

### `head`
Alternative working mode. The service will fetch validators info from non-finalized states.
It is less stable and reliable because of data is not finalized yet. There can be some calculation errors because of reorgs.

**Pros**:
* Less delay in processing and critical alerts will be given with less delay
* In case of long finality the app will monitor and will not wait for the finality

**Cons**:
* Errors due to reorgs
* More rewards calculation errors
* Possible inaccurate data in alerts and dashboard

## Dashboards

There are three dashboards in Grafana:
* **Validators** - shows aggregated data about performance for all monitored validators
![Validators](.images/validators-dashboard.png)
* **NodeOperator** - shows aggregated data about performance for each monitored node operator
![NodeOperators](.images/nodeoperators-dashboard.png)
* **Rewards & Penalties** - shows aggregated data about rewards, penalties, and missed rewards for each monitored node operator
![Rewards & Penalties](.images/rewards-penalties-dashboard.png)

## Alerts

There are several default alerts which are triggered by Prometheus rules:

* General:
  * 🔪 Slashed validators
  * 💸 Operators with negative balance delta
* Proposals:
  * 📥 Operators with missed block proposals
  * 📈📥 Operators with missed block proposals (on possible high reward validators)
* Sync committees:
  * 🔄 Operators with bad sync committee participation
  * 📈🔄 Operators with bad sync committee participation (on possible high reward validators)
* Attestations:
  * 📝❌ Operators with missed attestation
  * 📝🐢 Operators with high inclusion delay attestations
  * 📝🏷️ Operators with two invalid attestation properties (head/target/source)
  * 📈📝❌ Operators with missed attestation (on possible high reward validators)

## First run

You have two options to run this application: `docker-compose` or `node`
and two sources of validator list: `lido` (by default) or `file` (see [here](#use-custom-validators-list)).

Because Lido contract on `mainnet` contains a lot of validators,
fetching and saving them to local storage can take time (depends on EL RPC host) and a lot of RAM.
For avoiding `heap out of memory` error, you can pass `NODE_OPTIONS` env var with `--max-old-space-size=8192` value
and when the application completes its first cycle, you can restart your instance without this env variable.

## Performance optimizations and monitoring the monitor

To tail the logs of your instantiation you can use `docker compose logs -f`. Watch out for connection errors and other issues especially regarding `ethereum-validators-monitoring` process. You can choose to ignore alerting related errors if you haven't configured this feature yet.
To see a real-time, dynamic view of these containers performance use `docker stats`.
After the initial launch you can improve the performance, by using some or all of the following options:
- consider running a local CL+EL.
- remove `--max-old-space-size=8192` from `start:prod` section of `ethereum-validators-monitoring/package.json` file.
- edit `./docker-compose.yml` file and assign more cpus and memory to `app` and `clickhouse` like so:
```
  clickhouse:
    << text omitted >>
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16g
  app:
    << text omitted >>
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16g
```

Do not forget to stop and re-launch docker-compose after performing a modification.


## Run via docker-compose

1. Use `.env.example.compose` file content to create your own `.env` file
2. Build app image via `docker-compose build app`
3. Set owner for validators registry sources
```bash
chown -R 1000:1000 ./docker/validators
```
4. Create `.volumes` directory from `docker` directory:
```bash
cp -r docker .volumes
chown -R 65534:65534 .volumes/prometheus
chown -R 65534:65534 .volumes/alertmanager
chown -R 472:472 .volumes/grafana
```
5. Run `docker-compose up -d`
6. Open Grafana UI at `http://localhost:8082/`
   (login: `admin`, password: `MYPASSWORT`) and wait
   first app cycle execution for display data

## Run via node

1. Install dependencies via `yarn install`
2. Run `yarn build`
3. Tweak `.env` file from `.env.example.local`
4. Run Clickhouse to use as bot DB
```bash
docker-compose up -d clickhouse
```
5. Set owner for validators registry sources
```bash
chown -R 1000:1000 ./docker/validators
```
6. Run `yarn start:prod`

## Use custom validators list

By default, monitoring bot fetches validator keys from Lido contract, but you can monitor your own validators:
1. Set `VALIDATOR_REGISTRY_SOURCE` env var to `file`
2. Create file with keys by example [here](docker/validators/custom_mainnet.yaml)
3. Set `VALIDATOR_REGISTRY_FILE_SOURCE_PATH` env var to `<path to your file>`

If you want to implement your own source, it must match [RegistrySource interface](src/validators-registry/registry-source.interface.ts) and be included in [RegistryModule providers](src/validators-registry/registry.module.ts)

## Clickhouse data retention

By default, storage keep the data with `Inf.` time to live.
It can be changed by the TTL policy for Clickhouse:
```
# Mainnet
ALTER TABLE validators_summary MODIFY TTL toDateTime(1606824023 + (epoch * 32 * 12)) + INTERVAL 3 MONTH;

# Hoodi
ALTER TABLE validators_summary MODIFY TTL toDateTime(1742213400 + (epoch * 32 * 12)) + INTERVAL 3 MONTH;

# Holesky
ALTER TABLE validators_summary MODIFY TTL toDateTime(1695902400 + (epoch * 32 * 12)) + INTERVAL 3 MONTH;
```

## Application Env variables

---
`LOG_LEVEL` - Application log level.
* **Required:** false
* **Values:** error / warning / notice / info / debug
* **Default:** info
---
`LOG_FORMAT` - Application log format.
* **Required:** false
* **Values:** simple / json
* **Default:** json
---
`WORKING_MODE` - Application working mode.
* **Required:** false
* **Values:** finalized / head
* **Default:** finalized
---
`DB_HOST` - Clickhouse server host.
* **Required:** true
---
`DB_USER` - Clickhouse server user.
* **Required:** true
---
`DB_PASSWORD` - Clickhouse server password.
* **Required:** true
---
`DB_NAME` - Clickhouse server DB name.
* **Required:** true
---
`DB_PORT` - Clickhouse server port.
* **Required:** false
* **Default:** 8123
---
`HTTP_PORT` - Port for Prometheus HTTP server in application on the container.
* **Required:** false
* **Default:** 8080
* **Note:** if this variable is changed, it also should be updated in [prometheus.yml](docker/prometheus/prometheus.yml)
---
`EXTERNAL_HTTP_PORT` - Port for Prometheus HTTP server in application that is exposed to the host.
* **Required:** false
* **Default:** `HTTP_PORT`
---
`DB_MAX_RETRIES` - Max retries for each query to DB.
* **Required:** false
* **Default:** 10
---
`DB_MIN_BACKOFF_SEC` - Min backoff for DB query retrier (sec).
* **Required:** false
* **Default:** 1
---
`DB_MAX_BACKOFF_SEC` - Max backoff for DB query retrier (sec).
* **Required:** false
* **Default:** 120
---
`DRY_RUN` - Run application in dry mode. This means that it runs a main cycle once every 24 hours.
* **Required:** false
* **Values:** true / false
* **Default:** false
---
`NODE_ENV` - Node.js environment.
* **Required:** false
* **Values:** development / production / staging / testnet / test
* **Default:** development
---
`ETH_NETWORK` - Ethereum network ID for connection execution layer RPC.
* **Required:** true
* **Values:** 1 (Mainnet) / 5 (Goerli) / 17000 (Holesky)
---
`EL_RPC_URLS` - Ethereum execution layer comma-separated RPC URLs.
* **Required:** true
---
`CL_API_URLS` - Ethereum consensus layer comma-separated API URLs.
* **Required:** true
---
`CL_API_RETRY_DELAY_MS` - Ethereum consensus layer request retry delay (ms).
* **Required:** false
* **Default:** 500
---
`CL_API_GET_RESPONSE_TIMEOUT` - Ethereum consensus layer GET response (header) timeout (ms).
* **Required:** false
* **Default:** 15000
---
`CL_API_MAX_RETRIES` - Ethereum consensus layer max retries for all requests.
* **Required:** false
* **Default:** 1 (means that request will be executed once)
---
`CL_API_GET_BLOCK_INFO_MAX_RETRIES` - Ethereum consensus layer max retries for fetching block info.
Independent of `CL_API_MAX_RETRIES`.
* **Required:** false
* **Default:** 1 (means that request will be executed once)
---
`CL_API_MAX_SLOT_DEEP_COUNT` - Maximum number of slots that the application uses to find a not missed consensus-layer
slot. The application will use this value to find the next (or previous) not-missed slot next to (or behind) the
specific slot. If the processed slot and all next (or previous) `CL_API_MAX_SLOT_DEEP_COUNT` slots are missed, the app
will throw an error.
* **Required:** false
* **Default:** 32
---
`SPARSE_NETWORK_MODE` - Controls how the app searches previous and next not missing slots. If this mode is enabled, to
find the next not missing CL slot, the app gets the number of the EL block next to the EL block corresponding to the
latest known not missing slot, gets the timestamp of this block, and gets the CL slot that corresponds to this
timestamp. If this mode is disabled, to find the next not missing CL slot the app iterates all next (or previous) CL
slots one by one from the currently processed slot to find the not missing one up to the depth specified in the
`CL_API_MAX_SLOT_DEEP_COUNT` variable. It is suggested to use the `SPARSE_NETWORK_MODE` mode only on networks with very
many missed slots.
* **Required:** false
* **Default:** false
---
`FETCH_INTERVAL_SLOTS` - Count of slots in Ethereum consensus layer epoch.
* **Required:** false
* **Default:** 32
---
`CHAIN_SLOT_TIME_SECONDS` - Ethereum consensus layer time slot size (sec).
* **Required:** false
* **Default:** 12
---
`START_EPOCH` - Ethereum consensus layer epoch for start application.
* **Required:** false
* **Default:** 155000
---
`VALIDATOR_REGISTRY_SOURCE` - Validators registry source.
* **Required:** false
* **Values:** lido (Lido NodeOperatorsRegistry module keys) / keysapi (Lido keys from multiple modules) / file
* **Default:** lido
---
`VALIDATOR_REGISTRY_FILE_SOURCE_PATH` - Validators registry file source path.
* **Required:** false
* **Default:** ./docker/validators/custom_mainnet.yaml
* **Note:** it makes sense to change default value if `VALIDATOR_REGISTRY_SOURCE` is set to "file"
---
`VALIDATOR_REGISTRY_LIDO_SOURCE_SQLITE_CACHE_PATH` - Validators registry lido source sqlite cache path.
* **Required:** false
* **Default:** ./docker/validators/lido_mainnet.db
* **Note:** it makes sense to change default value if `VALIDATOR_REGISTRY_SOURCE` is set to "lido"
---
`VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS` - Comma-separated list of URLs to
[Lido Keys API service](https://github.com/lidofinance/lido-keys-api).
* **Required:** false
* **Note:** will be used only if `VALIDATOR_REGISTRY_SOURCE` is set to "keysapi"
---
`VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RETRY_DELAY_MS` - Retry delay for requests to Lido Keys API service (ms).
* **Required:** false
* **Default:** 500
---
`VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RESPONSE_TIMEOUT` - Response timeout (ms) for requests to Lido Keys API service (ms).
* **Required:** false
* **Default:** 30000
---
`VALIDATOR_REGISTRY_KEYSAPI_SOURCE_MAX_RETRIES` - Max retries for each request to Lido Keys API service.
* **Required:** false
* **Default:** 2
---
`VALIDATOR_USE_STUCK_KEYS_FILE` - Use a file with list of validators that are stuck and should be excluded from the
monitoring metrics.
* **Required:** false
* **Values:** true / false
* **Default:** false
---
`VALIDATOR_STUCK_KEYS_FILE_PATH` - Path to file with list of validators that are stuck and should be excluded from the
monitoring metrics.
* **Required:** false
* **Default:** ./docker/validators/stuck_keys.yaml
* **Note:** will be used only if `VALIDATOR_USE_STUCK_KEYS_FILE` is true
---
`SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG` - Distance (down) from Blockchain Sync Participation average after
which we think that our sync committee participation is bad.
* **Required:** false
* **Default:** 0
---
`SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` - Number epochs after which we think that our sync committee
participation is bad and alert about that.
* **Required:** false
* **Default:** 3
---
`BAD_ATTESTATION_EPOCHS` - Number epochs after which we think that our attestation is bad and alert about that.
* **Required:** false
* **Default:** 3
---
`CRITICAL_ALERTS_ALERTMANAGER_URL` - If passed, application sends additional critical alerts about validators
performance to Alertmanager.
* **Required:** false
---
`CRITICAL_ALERTS_MIN_VAL_COUNT` - Critical alerts will be sent for Node Operators with validators count greater or equal
to this value.
* **Required:** false
* **Default:** 100
---
`CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT` - Sets the minimum conditions for triggering critical alerts based on the number
of active validators for node operators in a specific module.

The value must be in JSON format. Example:
`{ "0": { "minActiveCount": 100, "affectedShare": 0.33, "minAffectedCount": 1000 } }`.

The numeric key represents the module ID. Settings under the `0` key apply to all modules unless overridden by settings
for specific module IDs. Settings for specific module IDs take precedence over the `0` key.

A critical alert is sent if:

* The number of active validators for a node operator meets or exceeds `minActiveCount`.
* The number of affected validators:
  * Is at least `affectedShare` of the total validators for the node operator, OR
  * Exceeds or equal to `minAffectedCount`.
* Value in the `CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT` for specific module is not overridden by
  `CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT`.

If no settings are provided for a specific module or the 0 key, default values are used:
`{ "minActiveCount": CRITICAL_ALERTS_MIN_VAL_COUNT, "affectedShare": 0.33, "minAffectedCount": 1000 }`.
* **Required:** false
* **Default:** {}
---
`CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT` - Defines the minimum number of affected validators for a node operator in a
specific module for which a critical alert should be sent.

The value must be in JSON format, for example: `{ "0": 100, "3": 50 }`.  The numeric key represents the module ID. The
value for the key `0` applies to all modules. Values for non-zero keys apply only to the specified module and take
precedence over the `0` key.

This variable takes priority over `CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT` and `CRITICAL_ALERTS_MIN_VAL_COUNT`. If no
value is set for a specific module or the `0` key, the rules from the other two variables will apply instead.
* **Required:** false
* **Default:** {}
---
`CRITICAL_ALERTS_ALERTMANAGER_LABELS` - Additional labels for critical alerts.
Must be in JSON string format. Example: `{ "a": "valueA", "b": "valueB" }`.
* **Required:** false
* **Default:** {}
---

## Application critical alerts (via Alertmanager)

In addition to alerts based on Prometheus metrics you can receive special critical alerts based on Beacon Chain
aggregates from app.

You should pass env var `CRITICAL_ALERTS_ALERTMANAGER_URL=http://<alertmanager_host>:<alertmanager_port>`.

Critical alerts for modules are controlled by three environment variables, listed here with their priority (from lowest
to highest):
```
CRITICAL_ALERTS_MIN_VAL_COUNT: number;
CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT: {
  <moduleIndex>: {
      minActiveCount: number,
      affectedShare: number,
      minAffectedCount: number,
   }
};
CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT: {
   <moduleIndex>: number
};
```

The following rules are applied (listed in order of increasing priority, the next rule overrides the previous one).

1. **Global Fallback** (`CRITICAL_ALERTS_MIN_VAL_COUNT`). If this variable is set, it acts as a default for modules by
   creating an implicit rule:
```
{
   "0": {
      "minActiveCount": CRITICAL_ALERTS_MIN_VAL_COUNT,
      "affectedShare": 0.33,
      "minAffectedCount": 1000
   }
}
```

2. **Global Rules for Active Validators** (`CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT`). Default rules apply to all modules
   (key `0`) unless overridden.
```
CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT = {
   "0": {
      "minActiveCount": <integer>,
      "affectedShare": <0.xx>,
      "minAffectedCount": <integer>,
   }
}
```
A critical alert is triggered for a module if **both** conditions are met:
* Active validators exceed or equal to `minActiveCount`.
* Affected validators exceed or equal to either `minAffectedCount` or `affectedShare` of the total active validators.

3. **Global Rules for Affected Validators** (`CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT`). Default rules apply to all
   modules (key `0`) unless overridden.
```
CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT = {
   "0": <integer>
}
```
A critical alert is triggered if the number of affected validators exceeds or equal to this value.

4. **Per-Module Rules for Active Validators** (`CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT`). If specific module keys are
   defined, those values override the global rules for `CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT` and
   `CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT`.
```
CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT = {
   "n": {
      "minActiveCount": <integer>,
      "affectedShare": <0.xx>,
      "minAffectedCount": <integer>,
   }
}
```
A critical alert is triggered for those modules if **both** conditions are met:

* Active validators exceed or equal to `minActiveCount`.
* Affected validators exceed or equal either `minAffectedCount` or `affectedShare` of the total validators.

For modules that don't have keys in the `CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT` the rules defined in the previous steps
are applied.

5. **Per-Module Rules for Affected Validators** (`CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT`). If specific module keys are
   defined, those values override all other rules for the module.
```
CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT = {
   "n": <integer>
}
```
A critical alert is triggered if the number of affected validators exceeds or equal to the specified value.

To illustrate these rules let's consider the following sample config:
```
CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT = {
  "0": {
      "minActiveCount": 100,
      "affectedShare": 0.3,
      "minAffectedCount": 1000,
   },
  "3": {
      "minActiveCount": 10,
      "affectedShare": 0.5,
      "minAffectedCount": 200,
   },
};
CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT = {
   "2": 30
};
```
In this case, critical alerts for any modules except 2 and 3 will be triggered for operators with at least 100 active
validators and only if either at least 1000 or 30% of active validators are affected by a critical alert (depending on
what number is less). However, for operators from the 3-rd module, these rules are weakened: a critical alert will be
triggered for operators with at least 10 active validators and only if either 200 or 50% of validators are affected.

These rules are not applied to the 2-nd module. For this module, critical alerts will be triggered for all operators
with at least 30 affected validators (no matter how many active validators they have).

If `ethereum_validators_monitoring_data_actuality < 1h` alerts from table bellow are sent.

| Alert name                 | Description                                                                                             | If fired repeat | If value increased repeat |
|----------------------------|---------------------------------------------------------------------------------------------------------|-----------------|---------------------------|
| CriticalSlashing           | At least one validator was slashed                                                                      | instant         | -                         |
| CriticalMissedProposes     | More than 1/3 blocks from Node Operator duties was missed in the last 12 hours                          | every 6h        | -                         |
| CriticalNegativeDelta      | A certain number of validators with negative balance delta (between current and 6 epochs ago)           | every 6h        | every 1h                  |
| CriticalMissedAttestations | A certain number of validators with missed attestations in the last `{{BAD_ATTESTATION_EPOCHS}}` epochs | every 6h        | every 1h                  |


## Application metrics

**WARNING: all metrics are prefixed with `ethereum_validators_monitoring_`**

| Metric                                                                    | Labels                                                  | Description                                                                                                                                                                                                                    |
|---------------------------------------------------------------------------|---------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| build_info                                                                | name, version, commit, branch, env, network             | Information about app build                                                                                                                                                                                                    |
| outgoing_el_requests_duration_seconds                                     | name, target                                            | Duration of outgoing execution layer requests in seconds                                                                                                                                                                       |
| outgoing_el_requests_count                                                | name, target, status                                    | Count of outgoing execution layer requests                                                                                                                                                                                     |
| outgoing_cl_requests_duration_seconds                                     | name, target                                            | Duration of outgoing consensus layer requests in seconds                                                                                                                                                                       |
| outgoing_cl_requests_count                                                | name, target, status, code                              | Count of outgoing consensus layer requests                                                                                                                                                                                     |
| outgoing_keysapi_requests_duration_seconds                                | name, target                                            | Duration of outgoing Keys API requests in seconds                                                                                                                                                                              |
| outgoing_keysapi_requests_count                                           | name, target, status, code                              | Count of outgoing Keys API requests                                                                                                                                                                                            |
| task_duration_seconds                                                     | name                                                    | Duration of task execution                                                                                                                                                                                                     |
| task_result_count                                                         | name, status                                            | Count of passed or failed tasks                                                                                                                                                                                                |
| epoch_number                                                              |                                                         | Current epoch number in app work process                                                                                                                                                                                       |
| data_actuality                                                            |                                                         | Application data actuality in ms                                                                                                                                                                                               |
| fetch_interval                                                            |                                                         | The same as `FETCH_INTERVAL_SLOTS`                                                                                                                                                                                             |
| sync_participation_distance_down_from_chain_avg                           |                                                         | The same as `SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG`                                                                                                                                                                  |
| user_operators_identifies                                                 | nos_module_id, nos_id, nos_name                         | User Node Operators in each module                                                                                                                                                                                             |
| validators                                                                | owner, nos_module_id, status                            | Count of validators in the chain                                                                                                                                                                                               |
| user_validators                                                           | nos_module_id, nos_id, nos_name, status                 | Count of validators for each user Node Operator                                                                                                                                                                                |
| validator_balances_delta                                                  | nos_module_id, nos_id, nos_name                         | Validators balance delta for each user Node Operator (6 epochs delta)                                                                                                                                                          |
| operator_real_balance_delta                                               | nos_module_id, nos_id, nos_name                         | Real operator balance change. Between N and N-1 epochs.                                                                                                                                                                        |
| operator_calculated_balance_delta                                         | nos_module_id, nos_id, nos_name                         | Calculated operator balance change based on calculated rewards and penalties                                                                                                                                                   |
| operator_calculated_balance_calculation_error                             | nos_module_id, nos_id, nos_name                         | Diff between calculated and real balance change                                                                                                                                                                                |
| validator_quantile_001_balances_delta                                     | nos_module_id, nos_id, nos_name                         | Validators 0.1% quantile balances delta for each user Node Operator (6 epochs delta)                                                                                                                                           |
| validator_count_with_negative_balances_delta                              | nos_module_id, nos_id, nos_name                         | Number of validators with negative balances delta for each user Node Operator                                                                                                                                                  |
| total_balance_24h_difference                                              | nos_module_id                                           | Total user validators balance difference (24 hours)                                                                                                                                                                            |
| operator_balance_24h_difference                                           | nos_module_id, nos_id, nos_name                         | Total validators balance difference (24 hours) for each user Node Operator                                                                                                                                                     |
| other_validator_count_with_good_sync_participation                        |                                                         | Number of non-user validators in the chain with a good sync committee participation                                                                                                                                            |
| validator_count_with_good_sync_participation                              | nos_module_id, nos_id, nos_name                         | Number of validators with a good sync committee participation for each user Node Operator                                                                                                                                      |
| other_validator_count_with_sync_participation_less_avg                    |                                                         | Number of non-user validators with sync committee participation less than average in the chain                                                                                                                                 |
| validator_count_with_sync_participation_less_avg                          | nos_module_id, nos_id, nos_name                         | Number of validators with sync committee participation less than average in the chain for each user Node Operator                                                                                                              |
| validator_count_with_sync_participation_less_avg_last_n_epoch             | nos_module_id, nos_id, nos_name, epoch_interval         | Number of validators with sync committee participation less than average in the chain in the last `SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` epochs for each user Node Operator                                           |
| high_reward_validator_count_with_sync_participation_less_avg_last_n_epoch | nos_module_id, nos_id, nos_name, epoch_interval         | Number of validators with sync committee participation less than average in the chain in the last `SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` epochs (with possible high reward in the future) for each user Node Operator |
| other_sync_participation_avg_percent                                      |                                                         | Average percent of participation of non-user validators in sync committees                                                                                                                                                     |
| user_sync_participation_avg_percent                                       | nos_module_id                                           | Average percent of participation of user validators in sync committees                                                                                                                                                         |
| operator_sync_participation_avg_percent                                   | nos_module_id, nos_id, nos_name                         | Average percent of participation of validators in sync committees for each user Node Operator                                                                                                                                  |
| chain_sync_participation_avg_percent                                      |                                                         | Average percent of participation of all validators in the chain in sync committees                                                                                                                                             |
| other_validator_count_perfect_attestation                                 |                                                         | Number of non-user validators in the chain with perfect attestations                                                                                                                                                           |
| validator_count_perfect_attestation                                       | nos_module_id, nos_id, nos_name                         | Number of validators with perfect attestations for each user Node Operator                                                                                                                                                     |
| other_validator_count_miss_attestation                                    |                                                         | Number of non-user validators in the chain with missed attestations                                                                                                                                                            |
| validator_count_miss_attestation                                          | nos_module_id, nos_id, nos_name                         | Number of validators with missed attestations for each user Node Operator                                                                                                                                                      |
| validator_count_miss_attestation_last_n_epoch                             | nos_module_id, nos_id, nos_name, epoch_interval         | Number of validators with missed attestations in the last `BAD_ATTESTATION_EPOCHS` epochs for each user Node Operator                                                                                                          |
| high_reward_validator_count_miss_attestation_last_n_epoch                 | nos_module_id, nos_id, nos_name, epoch_interval         | Number of validators with missed attestations in the last `BAD_ATTESTATION_EPOCHS` epochs (with possible high reward in the future) for each user Node Operator                                                                |
| other_validator_count_invalid_attestation                                 | reason                                                  | Number of non-user validators in the chain with invalid properties (head, target, source) or high inclusion delay in attestations                                                                                              |
| validator_count_invalid_attestation                                       | nos_module_id, nos_id, nos_name, reason                 | Number of validators with invalid properties (head, target, source) or high inclusion delay in attestations for each user Node Operator                                                                                        |
| validator_count_invalid_attestation_last_n_epoch                          | nos_module_id, nos_id, nos_name, reason, epoch_interval | Number of validators with invalid properties (head, target, source) or high inclusion delay in attestations in the last `BAD_ATTESTATION_EPOCHS` epochs for each user Node Operator                                            |
| validator_count_invalid_attestation_property_last_n_epoch                 | nos_module_id, nos_id, nos_name, epoch_interval         | Number of validators with two invalid attestation properties (head or target or source) in the last `BAD_ATTESTATION_EPOCHS` epochs for each user Node Operator                                                                |
| validator_count_high_inc_delay_last_n_epoch                               | nos_module_id, nos_id, nos_name, epoch_interval         | Number of validators with attestations inclusion delay > 2 in the last `BAD_ATTESTATION_EPOCHS` epochs for each user Node Operator                                                                                             |
| other_validator_count_good_propose                                        |                                                         | Number of non-user validators in the chain with good proposals                                                                                                                                                                 |
| validator_count_good_propose                                              | nos_module_id, nos_id, nos_name                         | Number of validators with good proposals for each user Node Operator                                                                                                                                                           |
| other_validator_count_miss_propose                                        |                                                         | Number of non-user validators in the chain with missed proposals                                                                                                                                                               |
| validator_count_miss_propose                                              | nos_module_id, nos_id, nos_name                         | Number of validators with missed proposals for each user Node Operator                                                                                                                                                         |
| high_reward_validator_count_miss_propose                                  | nos_module_id, nos_id, nos_name                         | Number of validators with missed proposals (with possible high reward in the future) for each user Node Operator                                                                                                               |
| operator_reward                                                           | nos_module_id, nos_id, nos_name, duty                   | Average validators reward for each duty for each user Node Operator                                                                                                                                                            |
| avg_chain_reward                                                          | duty                                                    | Average reward of all validators in the chain for each duty                                                                                                                                                                    |
| operator_missed_reward                                                    | nos_module_id, nos_id, nos_name, duty                   | Average validators missed reward for each duty for each user Node Operator                                                                                                                                                     |
| avg_chain_missed_reward                                                   | duty                                                    | Average missed reward of all validators in the chain for each duty                                                                                                                                                             |
| operator_penalty                                                          | nos_module_id, nos_id, nos_name, duty                   | Average validators penalty for each duty for each user Node Operator                                                                                                                                                           |
| avg_chain_penalty                                                         | duty                                                    | Average penalty of all validators in the chain for each duty                                                                                                                                                                   |
| operator_withdrawals_sum                                                  | nos_module_id, nos_id, nos_name, type                   | Total sum of validators withdrawals for each user Node Operator                                                                                                                                                                |
| other_chain_withdrawals_sum                                               | type                                                    | Total sum of non-user validators withdrawals in the chain                                                                                                                                                                      |
| operator_withdrawals_count                                                | nos_module_id, nos_id, nos_name, type                   | Number of validators withdrawals for each user Node Operator                                                                                                                                                                   |
| other_chain_withdrawals_count                                             | type                                                    | Number of non-user validators withdrawals in the chain                                                                                                                                                                         |
| contract_keys_total                                                       | type                                                    | Total user validators keys of each type                                                                                                                                                                                        |
| steth_buffered_ether_total                                                |                                                         | Total amount of buffered Ether (ETH) in the Lido contract                                                                                                                                                                      |


## Release flow

To create new release:

1. Merge all changes to the `master` branch
1. Navigate to Repo => Actions
1. Run action "Prepare release" action against `master` branch
1. When action execution is finished, navigate to Repo => Pull requests
1. Find pull request named "chore(release): X.X.X" review and merge it with "Rebase and merge" (or "Squash and merge")
1. After merge release action will be triggered automatically
1. Navigate to Repo => Actions and see last actions logs for further details
