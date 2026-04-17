import { Module } from '@nestjs/common';
import { BadgeService } from './badge.service';

/**
 * Badge Module — Phase 2에서 본격 구현
 *
 * Phase 1: 출석 배지만 (AttendanceService에서 직접 처리)
 * Phase 2: Kafka 이벤트 소싱 기반 배지/업적 시스템
 *
 * Phase 2 배지 카테고리:
 * - 대화: "첫 대화", "100회 대화", "1000회 대화"
 * - 접속: "7일 연속", "30일 연속", "100일 연속"
 * - 캐릭터: "3명 캐릭터와 대화", "전체 캐릭터 해금"
 * - 특별: "발렌타인 이벤트", "1주년 기념" (시즌 한정)
 */
@Module({
  providers: [BadgeService],
  exports: [BadgeService],
})
export class BadgeModule {}
