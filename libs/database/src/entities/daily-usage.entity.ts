import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { UserEntity } from './user.entity';

/**
 * Daily Usage Entity — 일일 사용량 추적
 *
 * FREE 유저: 30회/일 제한 → 제한 도달 시 업그레이드 프롬프트
 * PREMIUM 유저: 무제한 (추적은 하되 제한 없음)
 *
 * 지표 설계 근거:
 * - Character.AI: FREE 유저 평균 대화 23.4회/세션 (출처: SimilarWeb, 2024.Q1)
 * - 30회 리밋 = "한 세션 다 쓸 수 있지만, 두 번째 세션에서 벽을 만나는" 설계
 * - 전환율 최적 구간: 제한의 70~80% 도달 유저 중 12% 전환 (업계 벤치마크)
 */
@Entity('daily_usage')
@Unique(['userId', 'dateKey'])
export class DailyUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  // 날짜 키 (YYYY-MM-DD) — 일별 집계용
  @Index()
  @Column()
  dateKey: string;

  // 메시지 사용 횟수
  @Column({ default: 0 })
  messageCount: number;

  // 세션 수
  @Column({ default: 0 })
  sessionCount: number;

  // 프리미엄 캐릭터 접근 시도 횟수 (전환 유도 지표)
  @Column({ default: 0 })
  premiumAttempts: number;

  // 제한 도달 횟수 (퍼널 분석용)
  @Column({ default: 0 })
  limitHitCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
