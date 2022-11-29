import { getNetwork } from '@ethersproject/providers';
import { createMock } from '@golevelup/ts-jest';
import { FallbackProviderModule, SimpleFallbackJsonRpcBatchProvider } from '@lido-nestjs/execution';
import { LoggerModule, nullTransport } from '@lido-nestjs/logger';
import { RegistryKeyRepository } from '@lido-nestjs/registry';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { SqlEntityManager } from '@mikro-orm/knex';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Test } from '@nestjs/testing';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';

import { ConfigModule, ConfigService } from 'common/config';
import { PrometheusModule } from 'common/prometheus/prometheus.module';
import { RegistryService } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

import { ValStatus } from '../src/common/eth-providers';
import { DutyModule, DutyService } from '../src/duty';
import { ValidatorDutySummary } from '../src/duty/summary';

const MikroORMMockProvider = {
  provide: MikroORM,
  useValue: createMock<MikroORM>(),
};

const EntityManagerMockProvider = {
  provide: EntityManager,
  useFactory: jest.fn(() => ({
    flush: jest.fn(),
    getRepository: jest.fn(),
  })),
};

const SqlEntityManagerMockProvider = {
  provide: SqlEntityManager,
  useFactory: jest.fn(() => ({
    flush: jest.fn(),
    getRepository: jest.fn(),
  })),
};

const RegistryKeyRepositoryStub = {
  global: true, // crucial for DI to work
  module: RegistryKeyRepository,
  providers: [EntityManagerMockProvider, SqlEntityManagerMockProvider],
  exports: [EntityManagerMockProvider, SqlEntityManagerMockProvider],
};

const MikroORMStub = {
  global: true, // crucial for DI to work
  module: MikroOrmModule,
  providers: [MikroORMMockProvider],
  exports: [MikroORMMockProvider],
};

const testSyncMember = {
  index: 285113n,
  pubkey: '0x82750f01239832e15f0706f38cbbe35bed4cdfa4537391c14af00d8c2ae8dd695f1db09a1fbe81956ade016b245a2343',
  registry_index: 0,
  operator_index: 0,
  operator_name: 'test1',
  performance_summary: {
    epoch: BigInt(process.env['TEST_EPOCH_NUMBER']),
    ///
    val_id: 285113n,
    val_nos_id: 0,
    val_nos_name: 'test1',
    val_slashed: false,
    val_status: ValStatus.ActiveOngoing,
    val_balance: 33085196809n,
    ///
    is_sync: true,
    sync_percent: 78.125,
    ///
    att_happened: true,
    att_inc_delay: 1,
    att_valid_head: true,
    att_valid_target: true,
    att_valid_source: true,
  },
};

const testProposerMember = {
  index: 71737n,
  pubkey: '0xad635abd7655116d2b4a59502094f2a6dc82fc436b59f0353798c550ae56d6bbd66a56cc67c29b1c7c82433f3e3742ee',
  registry_index: 0,
  operator_index: 1,
  operator_name: 'test2',
  performance_summary: {
    epoch: BigInt(process.env['TEST_EPOCH_NUMBER']),
    ///
    val_id: 71737n,
    val_nos_id: 1,
    val_nos_name: 'test2',
    val_slashed: false,
    val_status: ValStatus.ActiveOngoing,
    val_balance: 35258194732n,
    ///
    is_proposer: true,
    block_to_propose: 4895296n,
    block_proposed: true,
    ///
    att_happened: true,
    att_inc_delay: 1,
    att_valid_head: true,
    att_valid_target: true,
    att_valid_source: true,
  },
};

const testValidators = [testSyncMember, testProposerMember];
const testValidatorIndexes = testValidators.map((v) => v.index);

describe('Duties', () => {
  jest.setTimeout(240 * 1000);

  let dutyService: DutyService;
  let validatorsRegistryService: RegistryService;
  let clickhouseService: ClickhouseService;

  let epochNumber, stateSlot;
  let indexesToSave: string[];
  let summaryToSave: ValidatorDutySummary[];

  const getActualKeysIndexedMock = jest.fn().mockImplementation(async () => {
    const map = new Map();
    testValidators.forEach((v) =>
      map.set(v.pubkey, {
        index: v.registry_index,
        operatorIndex: v.operator_index,
        operatorName: v.operator_name,
        key: v.pubkey,
      }),
    );
    return map;
  });
  jest.spyOn(SimpleFallbackJsonRpcBatchProvider.prototype, 'detectNetwork').mockImplementation(async () => getNetwork('mainnet'));
  const writeIndexesSpy = jest.spyOn(ClickhouseService.prototype, 'writeIndexes');
  const writeSummarySpy = jest.spyOn(ClickhouseService.prototype, 'writeSummary');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          transports: [nullTransport()],
        }),
        FallbackProviderModule.forRootAsync({
          async useFactory(configService: ConfigService) {
            return {
              urls: configService.get('EL_RPC_URLS') as NonEmptyArray<string>,
              network: configService.get('ETH_NETWORK'),
            };
          },
          inject: [ConfigService],
        }),
        ConfigModule,
        PrometheusModule,
        MikroORMStub,
        RegistryKeyRepositoryStub,
        DutyModule,
      ],
    }).compile();

    dutyService = moduleRef.get<DutyService>(DutyService);
    validatorsRegistryService = moduleRef.get<RegistryService>(RegistryService);
    clickhouseService = moduleRef.get<ClickhouseService>(ClickhouseService);

    validatorsRegistryService.getActualKeysIndexed = getActualKeysIndexedMock;
    // stub writing to db
    Object.defineProperty(clickhouseService, 'db', {
      value: {
        insert: () => ({
          stream: () => ({
            writeRow: async () => [],
            exec: async () => [],
            destroy: async () => [],
          }),
        }),
      },
    });

    stateSlot = BigInt(process.env['TEST_STATE_SLOT']);
    epochNumber = BigInt(process.env['TEST_EPOCH_NUMBER']);

    await dutyService.checkAndWrite(epochNumber, stateSlot);
    indexesToSave = writeIndexesSpy.mock.calls[0][0].map((i) => i.index);
    summaryToSave = [...writeSummarySpy.mock.calls[0][0]];
  });

  describe('should be processes validators info', () => {
    it('saving to indexes table should be performed only once', () => {
      expect(clickhouseService.writeIndexes).toBeCalledTimes(1);
    });

    it('saving to summary table should be performed only once', () => {
      expect(clickhouseService.writeSummary).toBeCalledTimes(1);
    });

    it('indexes content to save should contains all tested validators', () => {
      testValidatorIndexes.forEach((i) => expect(indexesToSave).toContain(String(i)));
    });

    it('summary content to save should contains right tested sync validator performance info', () => {
      const toSaveTestedSync = summaryToSave.find((v) => v.val_id == testSyncMember.index);
      expect(toSaveTestedSync).toBeDefined();
      expect(toSaveTestedSync).toEqual(testSyncMember.performance_summary);
    });

    it('summary content to save should contains right tested proposer validator performance info', () => {
      const toSaveTestedProposer = summaryToSave.find((v) => v.val_id == testProposerMember.index);
      expect(toSaveTestedProposer).toBeDefined();
      expect(toSaveTestedProposer).toEqual(testProposerMember.performance_summary);
    });
  });
});
