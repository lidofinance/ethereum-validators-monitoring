# ethereum-validators-monitoring (aka balval)

Consensus layer validators monitoring bot, that fetches Lido or Custom Users Node Operators keys
from Execution layer and checks their performance in Consensus
layer by: balance delta, attestations, proposes, sync committee participation.

Bot uses finalized state (2 epochs back from HEAD) for fetching validator info,
writes data to **Clickhouse**, displays aggregates by **Grafana**
dashboard, alerts about bad performance by **Prometheus + Alertmanger** and
routes notifications to Discord channel via **alertmanager-discord**.

## Run via docker-compose

1. Use `.env.example` file content to create your own `.env` file
2. Build app image via `docker-compose build app`
3. Create `.volumes` directory from `docker` directory:
```bash
cp -r docker .volumes
chown -R 65534:65534 .volumes/prometheus
chown -R 65534:65534 .volumes/alertmanager
chown -R 472:472 .volumes/grafana
```
4. Run `docker-compose up -d`
5. Open Grafana UI at `http://localhost:8082/`
   (login: `admin`, password: `MYPASSWORT`) and wait
   first app cycle execution for display data

## Run via node

1. Install dependencies via `yarn install`
2. Run `yarn build`
3. Tweak `.env` file from `.env.example`
4. Run Clickhouse to use as bot DB
```bash
docker-compose up -d clickhouse
```
5. Change `DB_HOST` value to `http://localhost`
6. Run `yarn start:prod`

## Use custom validators list

By default, monitoring bot fetches validator keys from Lido contract, but you can monitor your own validators:
1. Set `VALIDATOR_REGISTRY_SOURCE` env var to `file`
2. Create file with keys by example [here](docker/validators/custom_mainnet.yaml)
3. Set `VALIDATOR_REGISTRY_FILE_SOURCE_PATH` env var to `<path to your file>`

If you want to implement your own source, it must match [RegistrySource interface](src/common/validators-registry/registry-source.interface.ts) and be included in [RegistryModule providers](src/common/validators-registry/registry.module.ts)

## Application Env variables
| **Variable**                                     | **Description**                                                                                                                            | **Required** | **Default**                             |
|--------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|--------------|-----------------------------------------|
| LOG_LEVEL                                        | Balval log level                                                                                                                           |              |                                         |
| LOG_FORMAT                                       | Balval log format (simple or json)                                                                                                         |              |                                         |
| DB_HOST                                          | Clickhouse server host                                                                                                                     | true         |                                         |
| DB_USER                                          | Clickhouse server user                                                                                                                     | true         |                                         |
| DB_PASSWORD                                      | Clickhouse server password                                                                                                                 | true         |                                         |
| DB_NAME                                          | Clickhouse server name                                                                                                                     | true         |                                         |
| DB_PORT                                          | Clickhouse server port                                                                                                                     | false        | 8123                                    |
| HTTP_PORT                                        | Port for Prometheus HTTP server in Balval                                                                                                  | false        | 8080                                    |
| DB_MAX_RETRIES                                   | Max retries for each query to DB                                                                                                           | false        | 10                                      |
| DB_MIN_BACKOFF_SEC                               | Min backoff for DB query retrier                                                                                                           | false        | 1                                       |
| DB_MAX_BACKOFF_SEC                               | Max backoff for DB query retrier                                                                                                           | false        | 120                                     |
| LOG_LEVEL                                        | Logging level                                                                                                                              | false        | info                                    |
| DRY_RUN                                          | Option to run Balval in dry mode. This means that Balval runs a main cycle once every 24 hours                                             | false        | false                                   |
| ETH_NETWORK                                      | Ethereum network ID for connection execution layer RPC                                                                                     | true         |                                         |
| EL_RPC_URLS                                      | Ethereum execution layer comma separated RPC urls                                                                                          | true         |                                         |
| CL_API_URLS                                      | Ethereum consensus layer comma separated API urls                                                                                          | true         |                                         |
| CL_API_RETRY_DELAY_MS                            | Ethereum consensus layer request retry delay                                                                                               | false        | 500                                     |
| CL_API_GET_RESPONSE_TIMEOUT                      | Ethereum consensus layer GET response (header) timeout                                                                                     | false        | 15 * 1000                               |
| CL_API_POST_RESPONSE_TIMEOUT                     | Ethereum consensus layer POST response (header) timeout                                                                                    | false        | 15 * 1000                               |
| CL_API_POST_REQUEST_CHUNK_SIZE                   | Ethereum consensus layer data chunk size for large POST requests                                                                           | false        | 30000                                   |
| CL_API_MAX_RETRIES                               | Ethereum consensus layer max retries for all requests                                                                                      | false        | 1                                       |
| CL_API_GET_BLOCK_INFO_MAX_RETRIES                | Ethereum consensus layer max retries for fetching block info. Independent of `CL_API_MAX_RETRIES`                                          | false        | 1                                       |
| FETCH_INTERVAL_SLOTS                             | Count of slots in Ethereum consensus layer epoch                                                                                           | false        | 32                                      |
| CHAIN_SLOT_TIME_SECONDS                          | Ethereum consensus layer time slot size                                                                                                    | false        | 12                                      |
| START_SLOT                                       | Ethereum consensus layer slot for start Balval                                                                                             | false        | 1518000                                 |
| VALIDATOR_REGISTRY_SOURCE                        | Validators registry source. Possible values: lido (Lido contract), file                                                                    | false        | lido                                    |
| VALIDATOR_REGISTRY_FILE_SOURCE_PATH              | Validators registry file source path. It makes sense to change default value if you set `VALIDATOR_REGISTRY_SOURCE` to `file`              | false        | ./docker/validators/custom_mainnet.yaml |
| VALIDATOR_REGISTRY_LIDO_SOURCE_SQLITE_CACHE_PATH | Validators registry lido source sqlite cache path. It makes sense to change default value if you set `VALIDATOR_REGISTRY_SOURCE` to `lido` | false        | ./docker/validators/lido_mainnet.db     |
| SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG  | Distance (down) from Blockchain Sync Participation average after which we think that our sync participation is bad                         | false        | 0                                       |
| SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG    | Number epochs after which we think that our sync participation is bad and alert about that                                                 | false        | 3                                       |
| ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY         | Maximum inclusion delay after which we think that attestation is bad                                                                       | false        | 5                                       |
| BAD_ATTESTATION_EPOCHS                           | Number epochs after which we think that our attestation is bad and alert about that                                                        | false        | 3                                       |
| CRITICAL_ALERTS_ALERTMANAGER_URL                 | If passed, Balval sends additional critical alerts about validators performance to Alertmanager                                            | false        |                                         |
| CRITICAL_ALERTS_MIN_VAL_COUNT                    | Critical alerts will be sent for Node Operators with validators count greater this value                                                   | false        |                                         |


## Application critical alerts (via Alertmanager)

In addition to alerts based on Prometheus metrics you can receive special critical alerts based on beaconchain aggregates from app.

You should pass env var `CRITICAL_ALERTS_ALERTMANAGER_URL=http://<alertmanager_host>:<alertmanager_port>`.

And if `ethereum_validators_monitoring_data_actuality < 1h` it allows you to receive alerts from table bellow

| Alert name                 | Description                                                                                                     | If fired repeat | If value increased repeat |
|----------------------------|-----------------------------------------------------------------------------------------------------------------|-----------------|---------------------------|
| CriticalSlashing           | At least one validator was slashed                                                                              | instant         | -                         |
| CriticalMissedProposes     | More than 1/3 blocks from Node Operator duties was missed in the last 12 hours                                  | every 6h        | -                         |
| CriticalNegativeDelta      | More than 1/3 Node Operator validators with negative balance delta (between current and 6 epochs ago)           | every 6h        | every 1h                  |
| CriticalMissedAttestations | More than 1/3 Node Operator validators with missed attestations in the last {{ BAD_ATTESTATION_EPOCHS }} epochs | every 6h        | every 1h                  |


## Application metrics

| Metric                                                                                                   | Labels                   | Description                                                                                                                                                                                  |
|----------------------------------------------------------------------------------------------------------|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ethereum_validators_monitoring_validators                                                                | owner, status            | Count of validators in chain                                                                                                                                                                 |
| ethereum_validators_monitoring_user_validators                                                           | nos_name, status         | Count of validators for each user Node Operator                                                                                                                                              |
| ethereum_validators_monitoring_data_actuality                                                            |                          | Application data actuality in ms                                                                                                                                                             |
| ethereum_validators_monitoring_fetch_interval                                                            |                          | The same as `FETCH_INTERVAL_SLOTS`                                                                                                                                                           |
| ethereum_validators_monitoring_sync_participation_distance_down_from_chain_avg                           |                          | The same as `SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG`                                                                                                                                |
| ethereum_validators_monitoring_slot_number                                                               |                          | Current slot number in app work process                                                                                                                                                      |
| ethereum_validators_monitoring_contract_keys_total                                                       |                          | Total user validators keys                                                                                                                                                                   |
| ethereum_validators_monitoring_steth_buffered_ether_total                                                |                          | Buffered Ether (ETH) in Lido contract                                                                                                                                                        |
| ethereum_validators_monitoring_total_balance_24h_difference                                              |                          | Total user validators balance difference (24 hours)                                                                                                                                          |
| ethereum_validators_monitoring_validator_balances_delta                                                  | nos_name                 | Validators balance delta for each user Node Operator                                                                                                                                         |
| ethereum_validators_monitoring_validator_quantile_001_balances_delta                                     | nos_name                 | Validators 0.1% quantile balances delta for each user Node Operator                                                                                                                          |
| ethereum_validators_monitoring_validator_count_with_negative_balances_delta                              | nos_name                 | Number of validators with negative balances delta for each user Node Operator                                                                                                                |
| ethereum_validators_monitoring_validator_count_with_sync_participation_less_avg                          | nos_name                 | Number of validators with sync committee participation less avg for each user Node Operator                                                                                                  |
| ethereum_validators_monitoring_validator_count_miss_attestation                                          | nos_name                 | Number of validators miss attestation for each user Node Operator                                                                                                                            |
| ethereum_validators_monitoring_validator_count_miss_attestation_last_n_epoch                             | nos_name, epoch_interval | Number of validators miss attestation last `BAD_ATTESTATION_EPOCHS` epoch for each user Node Operator                                                                                        |
| ethereum_validators_monitoring_high_reward_validator_count_miss_attestation_last_n_epoch                 | nos_name, epoch_interval | Number of validators miss attestation last `BAD_ATTESTATION_EPOCHS` epoch  (with possible high reward in the future) for each user Node Operator                                             |
| ethereum_validators_monitoring_validator_count_with_sync_participation_less_avg_last_n_epoch             | nos_name, epoch_interval | Number of validators with sync participation less than avg last `SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` epoch for each user Node Operator                                            |
| ethereum_validators_monitoring_high_reward_validator_count_with_sync_participation_less_avg_last_n_epoch | nos_name, epoch_interval | Number of validators with sync participation less than avg last `SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` epoch  (with possible high reward in the future) for each user Node Operator |
| ethereum_validators_monitoring_validator_count_miss_propose                                              | nos_name                 | Number of validators miss propose for each user Node Operator                                                                                                                                |
| ethereum_validators_monitoring_high_reward_validator_count_miss_propose                                  | nos_name                 | Number of validators miss propose (with possible high reward in the future)                                                                                                                  |
| ethereum_validators_monitoring_user_sync_participation_avg_percent                                       |                          | User sync committee validators participation avg percent                                                                                                                                     |
| ethereum_validators_monitoring_chain_sync_participation_avg_percent                                      |                          | All sync committee validators participation avg percent                                                                                                                                      |

## Release flow

To create new release:

1. Merge all changes to the `master` branch
1. Navigate to Repo => Actions
1. Run action "Prepare release" action against `master` branch
1. When action execution is finished, navigate to Repo => Pull requests
1. Find pull request named "chore(release): X.X.X" review and merge it with "Rebase and merge" (or "Squash and merge")
1. After merge release action will be triggered automatically
1. Navigate to Repo => Actions and see last actions logs for further details
