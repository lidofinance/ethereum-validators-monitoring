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

import { DataProcessingService, InspectorModule } from '../src/inspector';

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
  index: '285113',
  pubkey: '0x82750f01239832e15f0706f38cbbe35bed4cdfa4537391c14af00d8c2ae8dd695f1db09a1fbe81956ade016b245a2343',
  registry_index: 0,
  operator_index: 0,
  operator_name: 'test1',
};

const testProposerMember = {
  index: '71737',
  pubkey: '0xad635abd7655116d2b4a59502094f2a6dc82fc436b59f0353798c550ae56d6bbd66a56cc67c29b1c7c82433f3e3742ee',
  registry_index: 0,
  operator_index: 1,
  operator_name: 'test2',
};

const testValidators = [testSyncMember, testProposerMember];
const testValidatorIndexes = testValidators.map((v) => v.index);

describe('Inspector', () => {
  jest.setTimeout(240 * 1000);

  let dataProcessingService: DataProcessingService;
  let validatorsRegistryService: RegistryService;
  let clickhouseService: ClickhouseService;

  let slotToWrite, stateRoot, slotNumber;

  const getUserValidatorIDsMock = jest
    .fn()
    .mockImplementation(async () => testValidators.map((v) => ({ validator_id: v.index, validator_pubkey: v.pubkey })));
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
  const writeBalancesSpy = jest.spyOn(ClickhouseService.prototype, 'writeStates');
  const writeAttestationsSpy = jest.spyOn(ClickhouseService.prototype, 'writeAttestations');
  const writeProposesSpy = jest.spyOn(ClickhouseService.prototype, 'writeProposes');
  const writeSyncsSpy = jest.spyOn(ClickhouseService.prototype, 'writeSyncs');

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
        InspectorModule,
      ],
    }).compile();

    dataProcessingService = moduleRef.get<DataProcessingService>(DataProcessingService);
    validatorsRegistryService = moduleRef.get<RegistryService>(RegistryService);
    clickhouseService = moduleRef.get<ClickhouseService>(ClickhouseService);

    validatorsRegistryService.getActualKeysIndexed = getActualKeysIndexedMock;
    clickhouseService.getUserValidatorIDs = getUserValidatorIDsMock;
    // stub writing to db
    Object.defineProperty(clickhouseService, 'db', {
      value: {
        insert: () => ({
          stream: () => ({
            writeRow: async () => [],
            exec: async () => [],
          }),
        }),
      },
    });

    slotToWrite = BigInt(process.env['TEST_SLOT_TO_WRITE']);
    stateRoot = process.env['TEST_STATE_ROOT'];
    slotNumber = process.env['TEST_SLOT_NUMBER'];

    await dataProcessingService.process(slotToWrite, stateRoot, slotNumber);
  });

  describe('should be processes validators info', () => {
    it('saving to balances table should be performed only once', () => {
      expect(clickhouseService.writeStates).toBeCalledTimes(1);
    });

    it('saving to attestation table should be performed only once', () => {
      expect(clickhouseService.writeAttestations).toBeCalledTimes(1);
    });

    it('saving to proposes table should be performed only once', () => {
      expect(clickhouseService.writeProposes).toBeCalledTimes(1);
    });

    it('saving to sync table should be performed only once', () => {
      expect(clickhouseService.writeSyncs).toBeCalledTimes(1);
    });

    it('balances content to save should contains all tested validators', () => {
      const toSave = writeBalancesSpy.mock.calls[0][2].balances.map((b) => b.index);
      expect(toSave).toHaveLength(2);
      expect(toSave.sort()).toEqual(testValidatorIndexes.sort());
    });

    it('attestations content to save should contains only tested validators', () => {
      const toSave = writeAttestationsSpy.mock.calls[0][0].attestersDutyInfo.map((a) => a.validator_index);
      expect(toSave).toHaveLength(2);
      expect(toSave.sort()).toEqual(testValidatorIndexes.sort());
    });

    it('proposes content to save should contains only tested validators with propose duty', () => {
      const toSave = writeProposesSpy.mock.calls[0][0].map((p) => p.validator_index);
      expect(toSave).toHaveLength(1);
      expect(toSave[0]).toEqual(testProposerMember.index);
    });

    it('syncs content to save should contains only tested validators with sync committee duty', () => {
      const toSave = writeSyncsSpy.mock.calls[0][0].syncResult.map((p) => p.validator_index);
      expect(toSave).toHaveLength(1);
      expect(toSave[0]).toEqual(testSyncMember.index);
    });

    it('latest slot in DB equal processing slot', () => {
      expect(dataProcessingService.latestProcessedEpoch).toBe(slotToWrite);
    });
  });
});
