import { MikroORM } from '@mikro-orm/core';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly orm: MikroORM) {}

  public async onModuleInit(): Promise<void> {
    const generator = this.orm.getSchemaGenerator();
    await generator.updateSchema();
  }

  public async onModuleDestroy(): Promise<void> {
    try {
      await this.orm.close();
    } catch (error) {}
  }
}
