import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { BadgeModule } from './modules/badge/badge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AttendanceModule,
    BadgeModule,
  ],
})
export class EventServiceModule {}
