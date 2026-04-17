import { Controller, Post, Param, Get, Logger } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  @Post(':userId/check')
  async checkAttendance(@Param('userId') userId: string) {
    this.logger.log(`Attendance check: user=${userId}`);
    return this.attendanceService.checkAttendance(userId);
  }

  @Get(':userId/streak')
  async getStreak(@Param('userId') userId: string) {
    return this.attendanceService.getStreak(userId);
  }
}
