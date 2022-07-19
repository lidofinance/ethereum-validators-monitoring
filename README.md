# eth2-validators-monitoring (aka balval)

Consensus layer validators monitoring bot, that fetches Lido Node Operator keys
from eth1 (Execution layer) and checks their performance in eth2 (Consensus
layer) by: balance delta, attestations, proposes, sync committee participation.

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

1. Install dependencies via `npm ci`
2. Run `npm run build`
3. Tweak `.env` file from `.env.example`
4. Run Clickhouse to use as bot DB
```bash
docker-compose up -d clickhouse
5. Change `DB_HOST` value to `http://localhost`
6. Run `node dist/index.js`
```
## Application Env variables
| **Variable**                                    | **Description**                                                                                                    | **Required** | **Default** |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|--------------|-------------|
| DB_HOST                                         | Clickhouse server host                                                                                             | true         |             |
| DB_USER                                         | Clickhouse server user                                                                                             | true         |             |
| DB_PASSWORD                                     | Clickhouse server password                                                                                         | true         |             |
| DB_NAME                                         | Clickhouse server name                                                                                             | true         |             |
| DB_PORT                                         | Clickhouse server port                                                                                             | false        | 8123        |
| HTTP_PORT                                       | Port for Prometheus HTTP server in Balval                                                                          | false        | 8080        |
| DB_MAX_RETRIES                                  | Max retries for each query to DB                                                                                   | false        | 10          |
| DB_MIN_BACKOFF_SEC                              | Min backoff for DB query retrier                                                                                   | false        | 1           |
| DB_MAX_BACKOFF_SEC                              | Max backoff for DB query retrier                                                                                   | false        | 120         |
| LOG_LEVEL                                       | Logging level                                                                                                      | false        | info        |
| DRY_RUN                                         | Option to run Balval in dry mode. This means that Balval runs a main cycle once every 24 hours                     | false        | false       |
| ETH_NETWORK                                     | Ethereum network ID for connection eth1 RPC                                                                        | true         |             |
| ETH1_RPC_URL                                    | Ethereum execution layer RPC url                                                                                   | true         |             |
| ETH1_RPC_URL_BACKUP                             | Ethereum execution layer backup RPC url                                                                            | false        |             |
| ETH1_RPC_RETRY_DELAY_MS                         | Ethereum execution layer request retry delay                                                                       | false        | 500         |
| REGISTRY_CONCURRENCY_LIMIT                      | Count of concurrency requests to contract for fetching NOs keys                                                    | false        | 200         |
| ETH2_BEACON_RPC_URL                             | Ethereum consensus layer RPC url                                                                                   | true         |             |
| ETH2_BEACON_RPC_URL_BACKUP                      | Ethereum consensus layer backup RPC url                                                                            | false        |             |
| ETH2_BEACON_RPC_RETRY_DELAY_MS                  | Ethereum consensus layer request retry delay                                                                       | false        | 500         |
| ETH2_GET_RESPONSE_TIMEOUT                       | Ethereum consensus layer GET response (header) timeout                                                             | false        | 15 * 1000   |
| ETH2_POST_RESPONSE_TIMEOUT                      | Ethereum consensus layer POST response (header) timeout                                                            | false        | 15 * 1000   |
| ETH2_POST_REQUEST_CHUNK_SIZE                    | Ethereum consensus layer data chunk size for large POST requests                                                   | false        | 30000       |
| FETCH_INTERVAL_SLOTS                            | Count of slots in Ethereum consensus layer epoch                                                                   | false        | 32          |
| CHAIN_SLOT_TIME_SECONDS                         | Ethereum consensus layer time slot size                                                                            | false        | 12          |
| START_SLOT                                      | Ethereum consensus layer slot for start Balval                                                                     | false        | 1518000     |
| SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG | Distance (down) from Blockchain Sync Participation average after which we think that our sync participation is bad | false        | 0           |
| SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG   | Number epochs after which we think that our sync participation is bad and alert about that                         | false        | 3           |
| ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY        | Maximum inclusion delay after which we think that attestation is bad                                               | false        | 5           |
| BAD_ATTESTATION_EPOCHS                          | Number epochs after which we think that our attestation is bad and alert about that                                | false        | 3           |

## Application metrics

| Metric                                                                    | Labels                   | Description                                                                                                                                                                                  |
|---------------------------------------------------------------------------|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| validators                                                                | owner, status            | Count of validators in chain                                                                                                                                                                 |
| lido_validators                                                           | nos_name, status         | Count of validators for each Lido Node Operator                                                                                                                                              |
| data_actuality                                                            |                          | Application data actuality in ms                                                                                                                                                             |
| fetch_interval                                                            |                          | The same as `FETCH_INTERVAL_SLOTS`                                                                                                                                                           |
| sync_participation_distance_down_from_chain_avg                           |                          | The same as `SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG`                                                                                                                                |
| slot_number                                                               |                          | Current slot number in app work process                                                                                                                                                      |
| contract_keys_total                                                       |                          | Total validators keys in Lido contract                                                                                                                                                       |
| steth_buffered_ether_total                                                |                          | Buffered Ether (ETH) in Lido contract                                                                                                                                                        |
| total_balance_24h_difference                                              |                          | Total Lido validators balance difference (24 hours)                                                                                                                                          |
| validator_balances_delta                                                  | nos_name                 | Validators balance delta for each Lido Node Operator                                                                                                                                         |
| validator_quantile_001_balances_delta                                     | nos_name                 | Validators 0.1% quantile balances delta for each Lido Node Operator                                                                                                                          |
| validator_count_with_negative_balances_delta                              | nos_name                 | Number of validators with negative balances delta for each Lido Node Operator                                                                                                                |
| validator_count_with_sync_participation_less_avg                          | nos_name                 | Number of validators with sync committee participation less avg for each Lido Node Operator                                                                                                  |
| validator_count_miss_attestation                                          | nos_name                 | Number of validators miss attestation for each Lido Node Operator                                                                                                                            |
| validator_count_miss_attestation_last_n_epoch                             | nos_name, epoch_interval | Number of validators miss attestation last `BAD_ATTESTATION_EPOCHS` epoch for each Lido Node Operator                                                                                        |
| high_reward_validator_count_miss_attestation_last_n_epoch                 | nos_name, epoch_interval | Number of validators miss attestation last `BAD_ATTESTATION_EPOCHS` epoch  (with possible high reward in the future) for each Lido Node Operator                                             |
| validator_count_with_sync_participation_less_avg_last_n_epoch             | nos_name, epoch_interval | Number of validators with sync participation less than avg last `SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` epoch for each Lido Node Operator                                            |
| high_reward_validator_count_with_sync_participation_less_avg_last_n_epoch | nos_name, epoch_interval | Number of validators with sync participation less than avg last `SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG` epoch  (with possible high reward in the future) for each Lido Node Operator |
| validator_count_miss_propose                                              | nos_name                 | Number of validators miss propose for each Lido Node Operator                                                                                                                                |
| high_reward_validator_count_miss_propose                                  | nos_name                 | Number of validators miss propose (with possible high reward in the future)                                                                                                                  |
| lido_sync_participation_avg_percent                                       |                          | Lido sync committee validators participation avg percent                                                                                                                                     |
| chain_sync_participation_avg_percent                                      |                          | All sync committee validators participation avg percent                                                                                                                                      |

## Release flow

To create new release:

1. Merge all changes to the `master` branch
1. Navigate to Repo => Actions
1. Run action "Prepare release" action against `master` branch
1. When action execution is finished, navigate to Repo => Pull requests
1. Find pull request named "chore(release): X.X.X" review and merge it with "Rebase and merge" (or "Squash and merge")
1. After merge release action will be triggered automatically
1. Navigate to Repo => Actions and see last actions logs for further details 