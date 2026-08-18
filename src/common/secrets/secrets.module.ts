import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';

import { SecretsService } from './secrets.service';

@Module({
  imports: [ConsensusProviderModule],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
