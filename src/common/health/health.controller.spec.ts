import { ServiceUnavailableException } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';

import { ClickhouseService } from 'storage/clickhouse';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let ping: jest.Mock;

  beforeEach(async () => {
    ping = jest.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [{ provide: ClickhouseService, useValue: { ping } }],
    }).compile();

    controller = module.get(HealthController);
  });

  test('liveness says nothing about ClickHouse', async () => {
    ping.mockRejectedValue(new Error('unreachable'));

    await expect(controller.check()).resolves.toMatchObject({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  test('readiness is up while ClickHouse answers', async () => {
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok', details: { clickhouse: { status: 'up' } } });
  });

  test('readiness fails when the ping does', async () => {
    ping.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
