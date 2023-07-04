import { Module } from '@nestjs/common';

import { FileSourceService } from './file-source.service';

@Module({
  providers: [FileSourceService],
  exports: [FileSourceService],
})
export class FileSourceModule {}
