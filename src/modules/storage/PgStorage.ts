import pgPromise, { ColumnSet, IConnected, IDatabase, IMain } from 'pg-promise';
import { inject, injectable, postConstruct }                  from 'inversify';
import { StateValidatorResponse }                             from '../lighthouse/types/StateValidatorResponse';
import { Environment }                                        from '../environment/Environment';
import { ILogger }                                            from '../logger/ILogger';
import { IClient } from 'pg-promise/typescript/pg-subset';
import migration_000001_init         from './migrations/migration_000001_init';

@injectable()
export class PgStorage {

  private readonly pgp: IMain;
  private readonly balances: ColumnSet;
  private readonly db: IDatabase<any>;
  private connection: IConnected<any, IClient> | undefined;

  public constructor(
    @inject(Environment) protected environment: Environment,
    @inject(ILogger) protected logger: ILogger,
  ) {
    this.pgp = pgPromise({
      capSQL: true,
    });

    this.db = this.pgp({
      host: this.environment.DB_HOST,
      user: this.environment.DB_USER,
      database: this.environment.DB_NAME,
      password: this.environment.DB_PASSWORD,
      port: parseInt(this.environment.DB_PORT, 10),
    });

    this.balances = new this.pgp.helpers.ColumnSet([
      {name: 'validator_pubkey'},
      {name: 'validator_id'},
      {name: 'validator_slashed'},
      {name: 'status'},
      {name: 'balance', cast: 'BIGINT'},
      {name: 'slot', cast: 'BIGINT'},
      {name: 'slot_time'},
    ], {table: {table: 'balances', schema: 'stats'}});
  }

  @postConstruct()
  public async initialize() {
    this.connection = await this.db.connect();
    await this.migrate();
  }

  public async close() {
    this.logger.info(`Closing DB connection`);
    await this.connection!.done();
  }

  public async getMaxSlot(): Promise<bigint> {
    const data = await this.db.query<[{ max: string }]>('SELECT max(slot) FROM stats.balances');
    const slot = BigInt(parseInt(data[0].max, 10) || 0);

    this.logger.info('Max (latest) stored slot in DB [%d] ', slot);

    return slot;
  }

  public async getMinSlot(): Promise<bigint> {
    const data = await this.db.query<[{ min: string }]>('SELECT min(slot) FROM stats.balances');
    const slot = BigInt(parseInt(data[0].min, 10) || 0);

    this.logger.info('Min (first) stored slot in DB [%d] ', slot);

    return slot;
  }

  public async writeBalances(slot: bigint, slotTime: bigint, balances: StateValidatorResponse[]) {
    this.logger.info('Writing [%d] balances to DB for slot [%d]', balances.length, slot);

    if (await this.slotExists(slot)) {
      this.logger.info('Slot already exists in db', slot);
      return;
    }

    const insert = this.pgp.helpers.insert(balances.map(balance => ({
      validator_id: balance.index,
      validator_pubkey: balance.validator.pubkey,
      validator_slashed: balance.validator.slashed,
      status: balance.status,
      balance: balance.balance,
      slot,
      slot_time: new Date(Number(slotTime * 1000n)),
    })), this.balances);

    await this.db.none(insert);
  }

  public async removeBalancesWithSlotLessThan(slot: bigint) {
    if (slot > 0) {
      //this.logger.info('Removing slots earlier than [%d]', slot);
      //await this.db.query('DELETE FROM stats.balances WHERE slot < $1', slot);
    }
  }

  public async migrate() {
    this.logger.info('Running migrations');
    //await this.db.query(migration_000001_init);
  }

  protected async slotExists(slot: bigint): Promise<boolean> {
    return (await this.db.oneOrNone('SELECT * FROM stats.balances WHERE slot = $1 LIMIT 1', slot)) || false;
  }
}
