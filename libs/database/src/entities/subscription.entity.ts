import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from './user.entity';

/**
 * Subscription Entity — 구독 이력 및 현재 상태
 *
 * 수익화 핵심 테이블:
 * - FREE → PREMIUM 전환 추적
 * - 결제 주기별 만료일 관리
 * - 해지 후 재구독 이력 보존
 *
 * 성공 사례: 캐릭터 AI (Character.AI)
 *   - 2023.05 c.ai+ 출시 → 월 MAU 1,800만 중 6.2% 유료 전환 (112만 명)
 *   - 핵심 전환 포인트: "대화 중단" 경험 → 유료 전환 트리거로 작동
 *   - 연 매출 추정 $150M+ (출처: The Information, 2024.01)
 */
export type SubscriptionPlan = 'free' | 'premium_monthly' | 'premium_yearly';
export type SubscriptionStatus = 'active' | 'canceled' | 'expired' | 'trial';

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ default: 'free' })
  plan: SubscriptionPlan;

  @Column({ default: 'active' })
  status: SubscriptionStatus;

  // 결제 관련 (Phase 2: Stripe/토스페이먼츠 연동)
  @Column({ nullable: true })
  externalPaymentId: string;

  @Column({ nullable: true })
  paymentProvider: string; // 'stripe' | 'toss' | 'apple' | 'google'

  // 구독 기간
  @Column({ nullable: true })
  startDate: Date;

  @Column({ nullable: true })
  endDate: Date;

  // 평가판
  @Column({ default: false })
  isTrialUsed: boolean;

  // 월간 가격 (원)
  @Column({ default: 0 })
  priceKrw: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
