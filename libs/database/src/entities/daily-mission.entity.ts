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
 * Daily Mission Entity — 일일 미션 진행 상태
 *
 * 리텐션의 핵심 루프: 로그인 → 미션 확인 → 대화 → 보상 획득 → 내일 다시
 *
 * 성공 사례: 원신 (Genshin Impact)
 *   - 일일 의뢰 4개 → 15분 안에 완료 가능 → DAU 유지율 68% (출처: SensorTower, 2024.Q1)
 *   - 핵심: "부담 없는 분량"이 매일 돌아오게 만드는 비결
 *
 * 우리 설계:
 *   - 미션 3개 / 일 → 자연스러운 대화 흐름 안에서 완료 가능
 *   - 보상: 보너스 메시지 3~10회 + 호감도 부스트
 *   - 전부 완료 시 "올클리어 보너스" 추가 지급
 */
export type MissionType = 'chat_count' | 'choice_select' | 'new_character' | 'emotion_collect' | 'streak_login';
export type MissionStatus = 'active' | 'completed' | 'claimed';

@Entity('daily_missions')
@Unique(['userId', 'dateKey', 'missionType'])
export class DailyMissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Index()
  @Column()
  dateKey: string; // YYYY-MM-DD

  @Column()
  missionType: MissionType;

  @Column()
  title: string;

  @Column()
  description: string;

  @Column({ nullable: true })
  emoji: string;

  // 진행도
  @Column({ default: 0 })
  currentProgress: number;

  @Column({ default: 1 })
  targetProgress: number;

  // 보상
  @Column({ default: 0 })
  rewardBonusMessages: number;

  @Column({ default: 0 })
  rewardAffinityBoost: number;

  @Column({ default: 'active' })
  status: MissionStatus;

  @CreateDateColumn()
  createdAt: Date;
}
