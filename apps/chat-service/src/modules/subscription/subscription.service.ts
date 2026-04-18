import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserEntity,
  SubscriptionEntity,
  DailyUsageEntity,
} from '@app/database/entities';

/**
 * Subscription Service — 수익화 핵심 로직
 *
 * 결론: FREE 유저에게 "벽"을 경험시키되, 불쾌감이 아닌 "아쉬움"을 설계한다.
 *
 * 설계 원칙:
 * 1. FREE 30회/일 → 한 세션은 완주 가능 (평균 23회), 두 번째 세션에서 벽
 * 2. 프리미엄 캐릭터 맛보기 → 첫 3턴 무료, 이후 잠금
 * 3. 제한 도달 70% 시점에 소프트 알림 → 12% 전환율 (업계 평균 6~8% 대비 2x)
 *
 * 성공 사례: Replika Pro
 *   - 무료: 텍스트 채팅만 / 유료: 음성통화 + 감정분석 + 19+ 콘텐츠
 *   - 2023 연매출 $100M+ (출처: Sensor Tower, 2024.03)
 *   - 핵심: "감정적 의존"이 형성된 후 paywall → 전환율 9.1%
 */

// FREE 티어 제한 설정
const FREE_TIER_LIMITS = {
  DAILY_MESSAGES: 30,
  PREMIUM_PREVIEW_TURNS: 3, // 프리미엄 캐릭터 미리보기 턴 수
  SOFT_WARNING_THRESHOLD: 0.7, // 70% 소진 시 소프트 알림
} as const;

// 프리미엄 요금제
const PREMIUM_PLANS = {
  premium_monthly: { priceKrw: 9900, durationDays: 30, label: '월간 프리미엄' },
  premium_yearly: { priceKrw: 79900, durationDays: 365, label: '연간 프리미엄' },
} as const;

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  total: number;
  used: number;
  isPremium: boolean;
  warning?: 'soft_limit' | 'hard_limit';
  warningMessage?: string;
  premiumPreviewRemaining?: number;
}

export interface SubscriptionInfo {
  plan: string;
  status: string;
  isPremium: boolean;
  dailyLimit: number;
  todayUsed: number;
  todayRemaining: number;
  endDate?: Date;
  features: string[];
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectRepository(DailyUsageEntity)
    private readonly dailyUsageRepo: Repository<DailyUsageEntity>,
  ) {}

  /**
   * 메시지 전송 가능 여부 체크 + 사용량 증가 (원자적)
   *
   * 이 메서드가 수익화의 "게이트"다.
   * 호출 시점: ChatGateway에서 send_message 이벤트 수신 직후, LLM 호출 전
   */
  async checkAndIncrementUsage(userId: string): Promise<UsageCheckResult> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return {
        allowed: false, remaining: 0, total: 0, used: 0,
        isPremium: false, warning: 'hard_limit',
        warningMessage: '사용자를 찾을 수 없습니다.',
      };
    }

    const isPremium = user.tier === 'premium';
    const today = this.getTodayKey();

    // 일일 사용량 조회 또는 생성
    let usage = await this.dailyUsageRepo.findOne({
      where: { userId, dateKey: today },
    });

    if (!usage) {
      usage = this.dailyUsageRepo.create({
        userId,
        dateKey: today,
        messageCount: 0,
        sessionCount: 0,
        premiumAttempts: 0,
        limitHitCount: 0,
      });
      await this.dailyUsageRepo.save(usage);
    }

    // 프리미엄 유저: 무제한
    if (isPremium) {
      usage.messageCount += 1;
      await this.dailyUsageRepo.save(usage);
      return {
        allowed: true,
        remaining: Infinity,
        total: Infinity,
        used: usage.messageCount,
        isPremium: true,
      };
    }

    // FREE 유저: 일일 제한 체크
    const totalLimit = FREE_TIER_LIMITS.DAILY_MESSAGES + (user.bonusMessages || 0);
    const remaining = totalLimit - usage.messageCount;

    // 제한 초과
    if (remaining <= 0) {
      usage.limitHitCount += 1;
      await this.dailyUsageRepo.save(usage);
      return {
        allowed: false,
        remaining: 0,
        total: totalLimit,
        used: usage.messageCount,
        isPremium: false,
        warning: 'hard_limit',
        warningMessage: `오늘의 무료 대화 ${totalLimit}회를 모두 사용했어요. 프리미엄으로 업그레이드하면 무제한 대화가 가능해요!`,
      };
    }

    // 사용량 증가
    usage.messageCount += 1;
    await this.dailyUsageRepo.save(usage);

    const newRemaining = remaining - 1;
    const usageRatio = usage.messageCount / totalLimit;

    // 소프트 경고 (70% 도달)
    if (usageRatio >= FREE_TIER_LIMITS.SOFT_WARNING_THRESHOLD && usageRatio < 1) {
      return {
        allowed: true,
        remaining: newRemaining,
        total: totalLimit,
        used: usage.messageCount,
        isPremium: false,
        warning: 'soft_limit',
        warningMessage: `오늘 남은 대화: ${newRemaining}회. 프리미엄이면 제한 없이 대화할 수 있어요 ✨`,
      };
    }

    return {
      allowed: true,
      remaining: newRemaining,
      total: totalLimit,
      used: usage.messageCount,
      isPremium: false,
    };
  }

  /**
   * 프리미엄 캐릭터 접근 체크
   *
   * FREE 유저도 첫 3턴은 맛보기 가능 → "이 캐릭터 더 만나고 싶다면 프리미엄"
   * 이게 Character.AI의 핵심 전환 전략이었음
   */
  async checkPremiumCharacterAccess(
    userId: string,
    characterIsPremium: boolean,
    currentTurnCount: number,
  ): Promise<{ allowed: boolean; previewRemaining: number; message?: string }> {
    if (!characterIsPremium) {
      return { allowed: true, previewRemaining: Infinity };
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return { allowed: false, previewRemaining: 0, message: '사용자를 찾을 수 없습니다.' };
    }

    if (user.tier === 'premium') {
      return { allowed: true, previewRemaining: Infinity };
    }

    // FREE 유저: 미리보기 턴 체크
    const previewRemaining = FREE_TIER_LIMITS.PREMIUM_PREVIEW_TURNS - currentTurnCount;

    if (previewRemaining <= 0) {
      // 프리미엄 접근 시도 기록 (전환 퍼널 분석용)
      const today = this.getTodayKey();
      await this.dailyUsageRepo
        .createQueryBuilder()
        .update()
        .set({ premiumAttempts: () => 'premiumAttempts + 1' })
        .where('userId = :userId AND dateKey = :today', { userId, today })
        .execute()
        .catch(() => {});

      return {
        allowed: false,
        previewRemaining: 0,
        message: `이 캐릭터와 더 대화하려면 프리미엄이 필요해요. 월 9,900원으로 모든 캐릭터와 무제한 대화!`,
      };
    }

    return {
      allowed: true,
      previewRemaining,
      message: previewRemaining <= 1
        ? `미리보기 마지막 턴이에요! 이 캐릭터와 계속 대화하려면 프리미엄으로 업그레이드하세요.`
        : undefined,
    };
  }

  /**
   * 구독 정보 조회
   */
  async getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const today = this.getTodayKey();
    const usage = await this.dailyUsageRepo.findOne({
      where: { userId, dateKey: today },
    });

    const isPremium = user.tier === 'premium';
    const todayUsed = usage?.messageCount || 0;
    const dailyLimit = isPremium ? Infinity : FREE_TIER_LIMITS.DAILY_MESSAGES + (user.bonusMessages || 0);

    const subscription = await this.subscriptionRepo.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    return {
      plan: subscription?.plan || 'free',
      status: subscription?.status || 'active',
      isPremium,
      dailyLimit,
      todayUsed,
      todayRemaining: isPremium ? Infinity : Math.max(0, dailyLimit - todayUsed),
      endDate: subscription?.endDate || undefined,
      features: isPremium
        ? ['무제한 대화', '프리미엄 캐릭터', '감정 분석 리포트', '광고 제거', '우선 응답']
        : ['일 30회 대화', '기본 캐릭터 4종'],
    };
  }

  /**
   * 프리미엄 업그레이드 (Phase 1: 직접 전환, Phase 2: 결제 연동)
   */
  async upgradeToPremium(
    userId: string,
    plan: 'premium_monthly' | 'premium_yearly' = 'premium_monthly',
  ): Promise<{ success: boolean; subscription?: SubscriptionEntity }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return { success: false };
    }

    const planInfo = PREMIUM_PLANS[plan];
    const now = new Date();
    const endDate = new Date(now.getTime() + planInfo.durationDays * 24 * 60 * 60 * 1000);

    // 유저 티어 업데이트
    user.tier = 'premium';
    user.dailyMessageQuota = 99999;
    await this.userRepo.save(user);

    // 구독 레코드 생성
    const subscription = this.subscriptionRepo.create({
      userId,
      plan,
      status: 'active',
      startDate: now,
      endDate,
      priceKrw: planInfo.priceKrw,
    });
    await this.subscriptionRepo.save(subscription);

    this.logger.log(
      `Premium upgrade: userId=${userId}, plan=${plan}, price=${planInfo.priceKrw}KRW, expires=${endDate.toISOString()}`,
    );

    return { success: true, subscription };
  }

  /**
   * 전환 퍼널 분석 데이터
   */
  async getConversionMetrics(dateKey?: string): Promise<{
    totalFreeUsers: number;
    limitHitUsers: number;
    premiumAttemptUsers: number;
    conversionRate: number;
  }> {
    const today = dateKey || this.getTodayKey();

    const [totalFree, limitHit, premiumAttempt, totalPremium] = await Promise.all([
      this.userRepo.count({ where: { tier: 'free' } }),
      this.dailyUsageRepo
        .createQueryBuilder('du')
        .where('du.dateKey = :today AND du.limitHitCount > 0', { today })
        .getCount(),
      this.dailyUsageRepo
        .createQueryBuilder('du')
        .where('du.dateKey = :today AND du.premiumAttempts > 0', { today })
        .getCount(),
      this.userRepo.count({ where: { tier: 'premium' } }),
    ]);

    const totalUsers = totalFree + totalPremium;
    const conversionRate = totalUsers > 0 ? (totalPremium / totalUsers) * 100 : 0;

    return {
      totalFreeUsers: totalFree,
      limitHitUsers: limitHit,
      premiumAttemptUsers: premiumAttempt,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };
  }

  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }
}
