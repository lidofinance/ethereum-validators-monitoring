import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { MikroORM } from '@mikro-orm/core';
import { Inject, Injectable, LoggerService, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, private readonly orm: MikroORM) {}

  public async onModuleInit(): Promise<void> {
    const generator = this.orm.getSchemaGenerator();
    await generator.updateSchema();
  }

  public async onModuleDestroy(): Promise<void> {
    try {
      await this.orm.close();
    } catch (error) {
      this.logger.debug(error);
    }
  }
}
