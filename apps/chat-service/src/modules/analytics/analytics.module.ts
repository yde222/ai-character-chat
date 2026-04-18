import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  UserEntity,
  ChatSessionEntity,
  ChatMessageEntity,
  DailyUsageEntity,
  SubscriptionEntity,
  DailyMissionEntity,
  AttendanceEntity,
  UserAffinityEntity,
} from '@app/database';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      ChatSessionEntity,
      ChatMessageEntity,
      DailyUsageEntity,
      SubscriptionEntity,
      DailyMissionEntity,
      AttendanceEntity,
      UserAffinityEntity,
    ]),
  ],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
