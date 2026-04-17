import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { AssetIndexService } from './asset-index.service';

@Module({
  controllers: [MatchingController],
  providers: [MatchingService, AssetIndexService],
})
export class MatchingModule {}
