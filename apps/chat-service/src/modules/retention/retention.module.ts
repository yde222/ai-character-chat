import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  UserEntity,
  AttendanceEntity,
  DailyMissionEntity,
} from '@app/database/entities';
import { RetentionService } from './retention.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, AttendanceEntity, DailyMissionEntity]),
  ],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
