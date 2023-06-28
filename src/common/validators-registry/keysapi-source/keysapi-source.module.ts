import { Module } from '@nestjs/common';

import { KeysapiSourceClient } from './keysapi-source.client';
import { KeysapiSourceService } from './keysapi-source.service';

@Module({
  providers: [KeysapiSourceService, KeysapiSourceClient],
  exports: [KeysapiSourceService],
})
export class KeysapiSourceModule {}
