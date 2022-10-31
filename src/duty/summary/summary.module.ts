import { Module } from '@nestjs/common';

import { SummaryService } from './summary.service';

@Module({
  imports: [],
  providers: [SummaryService],
  exports: [SummaryService],
})
export class SummaryModule {}
