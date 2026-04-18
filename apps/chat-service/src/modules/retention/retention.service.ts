import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserEntity,
  AttendanceEntity,
  DailyMissionEntity,
} from '@app/database/entities';
import { MissionType, MissionStatus } from '@app/database/entities/daily-mission.entity';

/**
 * Retention Service — 리텐션 루프 핵심 엔진
 *
 * 리텐션 루프: 로그인 → 출석 보상 → 미션 확인 → 대화 → 미션 완료 → 보상 → 내일 다시
 *
 * 설계 근거:
 * - Character.AI: 일 평균 세션 2.4회, 세션당 23분 (출처: SimilarWeb, 2024.Q1)
 * - 원신: 일일 의뢰 4개 × 15분 → DAU/MAU 68% (출처: SensorTower, 2024.Q1)
 * - 우리 목표: 일일 미션 3개 × 자연스러운 대화 안에서 완료 → DAU/MAU 40%+
 *
 * 출석 보상 테이블 (연속 출석일 → 보너스 메시지):
 *   1일: +3회, 2일: +3회, 3일: +5회, 5일: +5회, 7일: +10회
 *   14일: +15회, 30일: +30회(+ 프리미엄 1일 체험)
 *
 * 성공 사례: 쿠키런 킹덤 (Devsisters)
 *   - 7일 연속 출석 보상 = 에픽 캐릭터 조각 → DAU 42% → 73% (출처: 게임메카, 2023.09)
 *   - 핵심: "7일째에 큰 보상"이 이탈 직전 유저를 붙잡음
 */

// 출석 보상 테이블
const STREAK_REWARDS: Record<number, { bonusMessages: number; label: string; special?: string }> = {
  1: { bonusMessages: 3, label: '출석 1일차' },
  2: { bonusMessages: 3, label: '출석 2일차' },
  3: { bonusMessages: 5, label: '3일 연속!' },
  4: { bonusMessages: 3, label: '출석 4일차' },
  5: { bonusMessages: 5, label: '5일 연속!' },
  6: { bonusMessages: 3, label: '출석 6일차' },
  7: { bonusMessages: 10, label: '7일 완주!', special: '특별 보상' },
  14: { bonusMessages: 15, label: '2주 연속!', special: '스페셜 보상' },
  30: { bonusMessages: 30, label: '30일 달성!', special: '프리미엄 1일 체험' },
};

// 일일 미션 템플릿
const DAILY_MISSION_TEMPLATES: Array<{
  type: MissionType;
  title: string;
  description: string;
  emoji: string;
  target: number;
  rewardBonusMessages: number;
  rewardAffinityBoost: number;
}> = [
  {
    type: 'chat_count',
    title: '수다쟁이',
    description: '캐릭터와 5번 대화하기',
    emoji: '💬',
    target: 5,
    rewardBonusMessages: 3,
    rewardAffinityBoost: 0,
  },
  {
    type: 'choice_select',
    title: '운명의 선택',
    description: '스토리 선택지 2번 선택하기',
    emoji: '🎯',
    target: 2,
    rewardBonusMessages: 2,
    rewardAffinityBoost: 3,
  },
  {
    type: 'new_character',
    title: '새로운 만남',
    description: '아직 대화하지 않은 캐릭터와 대화하기',
    emoji: '✨',
    target: 1,
    rewardBonusMessages: 5,
    rewardAffinityBoost: 5,
  },
  {
    type: 'emotion_collect',
    title: '감정 수집가',
    description: '3가지 이상의 감정 반응 이끌어내기',
    emoji: '🎭',
    target: 3,
    rewardBonusMessages: 3,
    rewardAffinityBoost: 2,
  },
  {
    type: 'streak_login',
    title: '매일매일',
    description: '3일 연속 접속하기',
    emoji: '🔥',
    target: 3,
    rewardBonusMessages: 5,
    rewardAffinityBoost: 0,
  },
];

// 올클리어 보너스
const ALL_CLEAR_BONUS = { bonusMessages: 5, label: '올클리어 보너스!' };

export interface AttendanceResult {
  isFirstToday: boolean;
  streak: number;
  reward: { bonusMessages: number; label: string; special?: string };
  monthlyCalendar: string[]; // 이번 달 출석일 목록
}

export interface MissionProgress {
  id: string;
  type: MissionType;
  title: string;
  description: string;
  emoji: string;
  current: number;
  target: number;
  status: MissionStatus;
  reward: { bonusMessages: number; affinityBoost: number };
}

export interface MissionUpdateResult {
  missionId: string;
  completed: boolean;
  progress: number;
  target: number;
  reward?: { bonusMessages: number; affinityBoost: number };
  allCleared?: boolean;
  allClearBonus?: { bonusMessages: number; label: string };
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(AttendanceEntity)
    private readonly attendanceRepo: Repository<AttendanceEntity>,
    @InjectRepository(DailyMissionEntity)
    private readonly missionRepo: Repository<DailyMissionEntity>,
  ) {}

  // ========================================
  // 출석 체크
  // ========================================

  /**
   * 일일 출석 체크 + 보상 지급
   *
   * 호출 시점: 유저가 앱에 접속할 때 (로그인 직후 또는 세션 시작 시)
   */
  async checkIn(userId: string): Promise<AttendanceResult> {
    const today = this.getTodayKey();

    // 이미 출석했는지 체크
    const existing = await this.attendanceRepo.findOne({
      where: { userId, date: today },
    });

    if (existing) {
      // 이미 출석 → 캘린더만 반환
      const calendar = await this.getMonthlyCalendar(userId);
      const reward = this.getStreakReward(existing.streakCount);
      return {
        isFirstToday: false,
        streak: existing.streakCount,
        reward,
        monthlyCalendar: calendar,
      };
    }

    // 어제 출석 여부로 연속 출석 계산
    const yesterday = this.getDateKey(-1);
    const yesterdayAttendance = await this.attendanceRepo.findOne({
      where: { userId, date: yesterday },
    });

    const streak = yesterdayAttendance ? yesterdayAttendance.streakCount + 1 : 1;
    const reward = this.getStreakReward(streak);

    // 출석 기록 저장
    const attendance = this.attendanceRepo.create({
      userId,
      date: today,
      streakCount: streak,
      reward: reward.label,
      bonusMessages: reward.bonusMessages,
    });
    await this.attendanceRepo.save(attendance);

    // 보너스 메시지 지급
    await this.userRepo
      .createQueryBuilder()
      .update()
      .set({ bonusMessages: () => `bonusMessages + ${reward.bonusMessages}` })
      .where('id = :userId', { userId })
      .execute();

    this.logger.log(
      `Check-in: userId=${userId}, streak=${streak}, bonus=+${reward.bonusMessages}msg`,
    );

    // 일일 미션 자동 생성 (아직 없으면)
    await this.ensureDailyMissions(userId);

    // streak_login 미션 업데이트
    await this.updateMissionProgress(userId, 'streak_login', streak);

    const calendar = await this.getMonthlyCalendar(userId);

    return {
      isFirstToday: true,
      streak,
      reward,
      monthlyCalendar: calendar,
    };
  }

  /**
   * 이번 달 출석 캘린더 조회
   */
  async getMonthlyCalendar(userId: string): Promise<string[]> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const attendances = await this.attendanceRepo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .andWhere('a.date LIKE :pattern', { pattern: `${yearMonth}%` })
      .orderBy('a.date', 'ASC')
      .getMany();

    return attendances.map((a) => a.date);
  }

  // ========================================
  // 일일 미션
  // ========================================

  /**
   * 오늘의 미션 목록 조회 (없으면 자동 생성)
   */
  async getDailyMissions(userId: string): Promise<MissionProgress[]> {
    await this.ensureDailyMissions(userId);

    const today = this.getTodayKey();
    const missions = await this.missionRepo.find({
      where: { userId, dateKey: today },
      order: { createdAt: 'ASC' },
    });

    return missions.map((m) => ({
      id: m.id,
      type: m.missionType as MissionType,
      title: m.title,
      description: m.description,
      emoji: m.emoji || '',
      current: m.currentProgress,
      target: m.targetProgress,
      status: m.status as MissionStatus,
      reward: {
        bonusMessages: m.rewardBonusMessages,
        affinityBoost: m.rewardAffinityBoost,
      },
    }));
  }

  /**
   * 미션 진행도 업데이트
   *
   * 호출 시점:
   * - chat_count: 메시지 전송 시마다
   * - choice_select: 선택지 선택 시
   * - new_character: 새 캐릭터와 세션 시작 시
   * - emotion_collect: 새로운 감정 태그 수신 시
   * - streak_login: 출석 체크 시
   */
  async updateMissionProgress(
    userId: string,
    missionType: MissionType,
    incrementOrValue: number = 1,
  ): Promise<MissionUpdateResult | null> {
    const today = this.getTodayKey();

    const mission = await this.missionRepo.findOne({
      where: { userId, dateKey: today, missionType, status: 'active' },
    });

    if (!mission) return null;

    // streak_login은 절대값 설정, 나머지는 증분
    if (missionType === 'streak_login') {
      mission.currentProgress = incrementOrValue;
    } else {
      mission.currentProgress += incrementOrValue;
    }

    // 완료 체크
    const justCompleted = mission.currentProgress >= mission.targetProgress && mission.status === 'active';

    if (justCompleted) {
      mission.status = 'completed';

      // 보상 지급
      if (mission.rewardBonusMessages > 0) {
        await this.userRepo
          .createQueryBuilder()
          .update()
          .set({ bonusMessages: () => `bonusMessages + ${mission.rewardBonusMessages}` })
          .where('id = :userId', { userId })
          .execute();
      }

      this.logger.log(
        `Mission completed: userId=${userId}, type=${missionType}, reward=+${mission.rewardBonusMessages}msg, +${mission.rewardAffinityBoost}affinity`,
      );
    }

    await this.missionRepo.save(mission);

    // 올클리어 체크
    let allCleared = false;
    if (justCompleted) {
      const remaining = await this.missionRepo.count({
        where: { userId, dateKey: today, status: 'active' },
      });

      if (remaining === 0) {
        allCleared = true;
        // 올클리어 보너스 지급
        await this.userRepo
          .createQueryBuilder()
          .update()
          .set({ bonusMessages: () => `bonusMessages + ${ALL_CLEAR_BONUS.bonusMessages}` })
          .where('id = :userId', { userId })
          .execute();

        this.logger.log(`All missions cleared! userId=${userId}, bonus=+${ALL_CLEAR_BONUS.bonusMessages}msg`);
      }
    }

    return {
      missionId: mission.id,
      completed: justCompleted,
      progress: mission.currentProgress,
      target: mission.targetProgress,
      reward: justCompleted ? {
        bonusMessages: mission.rewardBonusMessages,
        affinityBoost: mission.rewardAffinityBoost,
      } : undefined,
      allCleared,
      allClearBonus: allCleared ? ALL_CLEAR_BONUS : undefined,
    };
  }

  /**
   * 오늘의 미션 자동 생성 (랜덤 3개 선택)
   */
  private async ensureDailyMissions(userId: string): Promise<void> {
    const today = this.getTodayKey();

    const existingCount = await this.missionRepo.count({
      where: { userId, dateKey: today },
    });

    if (existingCount > 0) return;

    // 랜덤으로 3개 선택 (chat_count는 항상 포함)
    const chatMission = DAILY_MISSION_TEMPLATES.find((t) => t.type === 'chat_count')!;
    const otherTemplates = DAILY_MISSION_TEMPLATES.filter((t) => t.type !== 'chat_count');
    const shuffled = otherTemplates.sort(() => Math.random() - 0.5);
    const selected = [chatMission, shuffled[0], shuffled[1]];

    const missions = selected.map((template) =>
      this.missionRepo.create({
        userId,
        dateKey: today,
        missionType: template.type,
        title: template.title,
        description: template.description,
        emoji: template.emoji,
        currentProgress: 0,
        targetProgress: template.target,
        rewardBonusMessages: template.rewardBonusMessages,
        rewardAffinityBoost: template.rewardAffinityBoost,
        status: 'active',
      }),
    );

    await this.missionRepo.save(missions);
    this.logger.log(
      `Daily missions created: userId=${userId}, types=[${selected.map((s) => s.type).join(', ')}]`,
    );
  }

  /**
   * 리텐션 대시보드 데이터 (관리자용)
   */
  async getRetentionMetrics(): Promise<{
    todayCheckIns: number;
    avgStreak: number;
    missionCompletionRate: number;
    allClearRate: number;
  }> {
    const today = this.getTodayKey();

    const [checkIns, avgStreakResult, totalMissions, completedMissions] = await Promise.all([
      this.attendanceRepo.count({ where: { date: today } }),
      this.attendanceRepo
        .createQueryBuilder('a')
        .select('AVG(a.streakCount)', 'avg')
        .where('a.date = :today', { today })
        .getRawOne(),
      this.missionRepo.count({ where: { dateKey: today } }),
      this.missionRepo.count({ where: { dateKey: today, status: 'completed' } }),
    ]);

    // 올클리어 유저 수 (모든 미션 완료한 유저)
    const allClearUsers = await this.missionRepo
      .createQueryBuilder('m')
      .select('m.userId')
      .where('m.dateKey = :today', { today })
      .groupBy('m.userId')
      .having('COUNT(CASE WHEN m.status = :active THEN 1 END) = 0', { active: 'active' })
      .andHaving('COUNT(*) > 0')
      .getCount();

    return {
      todayCheckIns: checkIns,
      avgStreak: Math.round((avgStreakResult?.avg || 0) * 10) / 10,
      missionCompletionRate: totalMissions > 0
        ? Math.round((completedMissions / totalMissions) * 100)
        : 0,
      allClearRate: checkIns > 0
        ? Math.round((allClearUsers / checkIns) * 100)
        : 0,
    };
  }

  // ========================================
  // 유틸
  // ========================================

  private getStreakReward(streak: number): { bonusMessages: number; label: string; special?: string } {
    // 정확히 매칭되는 보상 우선, 없으면 기본값
    if (STREAK_REWARDS[streak]) return STREAK_REWARDS[streak];
    // 기본: 3 보너스 메시지
    return { bonusMessages: 3, label: `출석 ${streak}일차` };
  }

  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getDateKey(offsetDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().split('T')[0];
  }
}
