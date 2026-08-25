import { Module } from '@nestjs/common';

import { SecretsService } from './secrets.service';

@Module({
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
