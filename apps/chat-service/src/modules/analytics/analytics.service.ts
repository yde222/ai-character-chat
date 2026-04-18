import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

/**
 * Analytics Service — 운영 대시보드 데이터 집계
 *
 * 핵심 지표 4가지:
 * 1. DAU/MAU + 트렌드 — 서비스 건강도의 심박수
 * 2. 전환 퍼널 — 무료 → 프리미엄 전환 경로 분석
 * 3. 캐릭터별 인기도 — 콘텐츠 투자 우선순위 결정 근거
 * 4. 수익 추이 — MRR/ARR 트래킹
 *
 * 성공 사례: Mixpanel 대시보드 설계 원칙
 * - "한 화면에서 3초 안에 서비스 상태를 파악할 수 있어야 한다"
 * - KPI 카드 → 트렌드 차트 → 세그먼트 드릴다운 (출처: Mixpanel Playbook, 2023)
 *
 * Phase 1: 더미 데이터 기반 집계 (서비스 구조 + API 완성)
 * Phase 2: 실제 DB 쿼리 + 캐싱 (Redis TTL 5분)
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Optional() @InjectRepository(UserEntity)
    private readonly userRepo?: Repository<UserEntity>,
    @Optional() @InjectRepository(ChatSessionEntity)
    private readonly sessionRepo?: Repository<ChatSessionEntity>,
    @Optional() @InjectRepository(ChatMessageEntity)
    private readonly messageRepo?: Repository<ChatMessageEntity>,
    @Optional() @InjectRepository(DailyUsageEntity)
    private readonly usageRepo?: Repository<DailyUsageEntity>,
    @Optional() @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo?: Repository<SubscriptionEntity>,
    @Optional() @InjectRepository(DailyMissionEntity)
    private readonly missionRepo?: Repository<DailyMissionEntity>,
    @Optional() @InjectRepository(AttendanceEntity)
    private readonly attendanceRepo?: Repository<AttendanceEntity>,
    @Optional() @InjectRepository(UserAffinityEntity)
    private readonly affinityRepo?: Repository<UserAffinityEntity>,
  ) {}

  /**
   * 전체 대시보드 데이터 한 번에 반환
   *
   * 설계 이유: 프론트에서 API 4번 호출 vs 1번 호출
   * - 4번 호출: 워터폴 로딩 → 체감 속도 저하
   * - 1번 호출: 서버에서 병렬 집계 → 단일 응답 (Vercel Analytics 패턴)
   */
  async getDashboardData(period: '7d' | '30d' | '90d' = '30d') {
    const [overview, dauTrend, conversionFunnel, characterPopularity, revenueTrend] =
      await Promise.all([
        this.getOverviewKPIs(),
        this.getDAUTrend(period),
        this.getConversionFunnel(),
        this.getCharacterPopularity(),
        this.getRevenueTrend(period),
      ]);

    return {
      overview,
      dauTrend,
      conversionFunnel,
      characterPopularity,
      revenueTrend,
      generatedAt: new Date().toISOString(),
      period,
    };
  }

  /**
   * KPI 카드 4개 — 한눈에 서비스 상태 파악
   *
   * 구조: 숫자 + 변화율 + 트렌드 방향
   * - DAU: 일일 활성 유저
   * - 전환율: FREE → PREMIUM 전환 비율
   * - MRR: 월간 반복 수익
   * - 리텐션: D7 리텐션율
   */
  private async getOverviewKPIs() {
    // Phase 1: 더미 데이터 (구조 확정 목적)
    // Phase 2: 실제 쿼리
    //   const totalUsers = await this.userRepo.count();
    //   const premiumUsers = await this.subscriptionRepo.count({ where: { plan: Not('free'), status: 'active' } });
    //   const todayDAU = await this.usageRepo.createQueryBuilder('u')
    //     .select('COUNT(DISTINCT u.userId)')
    //     .where('u.dateKey = :today', { today: this.getTodayKey() })
    //     .getRawOne();

    return {
      dau: {
        value: 1247,
        change: 12.3, // 전일 대비 %
        trend: 'up' as const,
        label: 'DAU',
      },
      conversionRate: {
        value: 5.8,
        change: 0.7,
        trend: 'up' as const,
        label: '전환율 (%)',
      },
      mrr: {
        value: 4_820_000,
        change: 18.2,
        trend: 'up' as const,
        label: 'MRR (원)',
      },
      retention: {
        value: 42.1,
        change: -2.3,
        trend: 'down' as const,
        label: 'D7 리텐션 (%)',
      },
    };
  }

  /**
   * DAU 트렌드 — 날짜별 활성 유저 수 + 신규 가입
   *
   * 차트 타입: Area Chart (Recharts)
   * 이유: 누적 느낌 → 성장 방향성 직관적 인지
   */
  private async getDAUTrend(period: '7d' | '30d' | '90d') {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const data: Array<{ date: string; dau: number; newUsers: number; premium: number }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      // Phase 1: 시뮬레이션 데이터 (리얼리스틱한 성장 곡선)
      const baseDAU = 800 + Math.floor(Math.random() * 600);
      const weekday = d.getDay();
      const weekendBoost = (weekday === 0 || weekday === 6) ? 1.25 : 1.0;
      const growthFactor = 1 + (days - i) * 0.008;

      data.push({
        date: dateStr,
        dau: Math.floor(baseDAU * weekendBoost * growthFactor),
        newUsers: Math.floor(30 + Math.random() * 50),
        premium: Math.floor(40 + Math.random() * 30 + (days - i) * 0.5),
      });
    }

    return data;
  }

  /**
   * 전환 퍼널 — 무료 → 프리미엄 전환 경로 시각화
   *
   * 퍼널 단계:
   * 1. 전체 가입 유저
   * 2. 7일 이상 활성 유저 (리텐션 통과)
   * 3. 제한 도달 경험 유저 (페이월 노출)
   * 4. 프리미엄 페이지 방문
   * 5. 결제 완료
   *
   * 벤치마크: Character.AI 6.2%, Replika 4.8%, Chai 3.1%
   * (출처: SimilarWeb + App Annie, 2024.Q1)
   */
  private async getConversionFunnel() {
    return {
      stages: [
        { name: '전체 가입', value: 8420, rate: 100 },
        { name: '7일 활성', value: 3540, rate: 42.0 },
        { name: '제한 도달', value: 1890, rate: 22.4 },
        { name: '프리미엄 페이지', value: 720, rate: 8.5 },
        { name: '결제 완료', value: 489, rate: 5.8 },
      ],
      // 단계별 이탈률
      dropoffs: [
        { from: '전체 가입', to: '7일 활성', dropRate: 58.0 },
        { from: '7일 활성', to: '제한 도달', dropRate: 46.6 },
        { from: '제한 도달', to: '프리미엄 페이지', dropRate: 61.9 },
        { from: '프리미엄 페이지', to: '결제 완료', dropRate: 32.1 },
      ],
    };
  }

  /**
   * 캐릭터별 인기도 — 콘텐츠 투자 우선순위 결정
   *
   * 지표:
   * - 세션 수: 얼마나 자주 선택되는가
   * - 평균 대화 길이: 얼마나 깊이 대화하는가
   * - 호감도 평균: 유저 만족도 프록시
   * - 전환 기여: 해당 캐릭터를 통한 프리미엄 전환 수
   *
   * 인사이트: "세션은 많지만 대화가 짧은 캐릭터" = 첫인상 OK, 몰입 실패
   */
  private async getCharacterPopularity() {
    return [
      {
        characterId: 'soyeon',
        name: '서연',
        sessions: 3240,
        avgMessages: 28.5,
        avgAffinity: 67,
        premiumConversions: 142,
        satisfaction: 4.2,
        trend: 'stable' as const,
      },
      {
        characterId: 'minji',
        name: '민지',
        sessions: 2810,
        avgMessages: 34.2,
        avgAffinity: 72,
        premiumConversions: 198,
        satisfaction: 4.5,
        trend: 'up' as const,
      },
      {
        characterId: 'hana',
        name: '하나',
        sessions: 1960,
        avgMessages: 22.1,
        avgAffinity: 58,
        premiumConversions: 89,
        satisfaction: 3.8,
        trend: 'down' as const,
      },
      {
        characterId: 'ren',
        name: '렌',
        sessions: 1540,
        avgMessages: 41.7,
        avgAffinity: 78,
        premiumConversions: 167,
        satisfaction: 4.7,
        trend: 'up' as const,
      },
      {
        characterId: 'yujin',
        name: '유진',
        sessions: 1320,
        avgMessages: 38.3,
        avgAffinity: 74,
        premiumConversions: 145,
        satisfaction: 4.4,
        trend: 'up' as const,
      },
    ];
  }

  /**
   * 수익 추이 — MRR/ARR 트래킹
   *
   * 핵심: 단순 매출이 아니라 "반복 수익"을 보여야 한다
   * - MRR = 월간 프리미엄 유저 × 월 구독료
   * - Churn Revenue = 해지 유저 × 구독료
   * - Net MRR = New MRR + Expansion - Churn
   *
   * SaaS 업계 표준: Net Revenue Retention > 100% = 건강한 성장
   * (출처: Bessemer Venture Partners Cloud Index, 2024)
   */
  private async getRevenueTrend(period: '7d' | '30d' | '90d') {
    const months = period === '7d' ? 3 : period === '30d' ? 6 : 12;
    const data: Array<{
      month: string;
      mrr: number;
      newRevenue: number;
      churnRevenue: number;
      netMrr: number;
    }> = [];

    let baseMrr = 2_400_000;

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const newRev = Math.floor(400_000 + Math.random() * 300_000);
      const churn = Math.floor(100_000 + Math.random() * 150_000);
      const netMrr = baseMrr + newRev - churn;

      data.push({
        month: monthStr,
        mrr: baseMrr,
        newRevenue: newRev,
        churnRevenue: churn,
        netMrr,
      });

      baseMrr = netMrr;
    }

    return data;
  }

  /**
   * 실시간 활성 현황 (Phase 2: WebSocket 기반)
   */
  async getRealtimeStats() {
    return {
      activeNow: Math.floor(80 + Math.random() * 120),
      activeSessions: Math.floor(60 + Math.random() * 90),
      messagesPerMinute: Math.floor(15 + Math.random() * 25),
      timestamp: new Date().toISOString(),
    };
  }

  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0];
  }
}
