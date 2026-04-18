import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { CharacterEntity } from './character.entity';

/**
 * UserAffinity Entity — 유저-캐릭터 호감도 시스템
 *
 * 호감도 레벨 구간:
 *   0~19   → STRANGER (낯선 사이)
 *   20~39  → ACQUAINTANCE (아는 사이)
 *   40~59  → FRIEND (친한 사이)
 *   60~79  → CLOSE (가까운 사이)
 *   80~94  → INTIMATE (연인 직전)
 *   95~100 → SOULMATE (엔딩 해금)
 *
 * 호감도 증감 규칙:
 *   긍정 감정 (JOY, AFFECTION, EXCITEMENT, SHY) → +1~3
 *   중립 감정 (NEUTRAL, SURPRISE)               → +0~1
 *   부정 감정 (SADNESS, ANGER, FEAR, DISGUST)    → -1~2
 *   일일 대화 보너스 (첫 대화)                    → +2
 */
@Entity('user_affinities')
@Unique(['userId', 'characterId'])
export class UserAffinityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column()
  characterId: string;

  // 현재 호감도 (0~100)
  @Column({ type: 'int', default: 0 })
  affinity: number;

  // 호감도 레벨
  @Column({ default: 'STRANGER' })
  level: 'STRANGER' | 'ACQUAINTANCE' | 'FRIEND' | 'CLOSE' | 'INTIMATE' | 'SOULMATE';

  // 누적 대화 수
  @Column({ type: 'int', default: 0 })
  totalMessages: number;

  // 누적 대화 세션 수
  @Column({ type: 'int', default: 0 })
  totalSessions: number;

  // 최고 달성 호감도 (감소해도 기록 유지)
  @Column({ type: 'int', default: 0 })
  peakAffinity: number;

  // 해금된 엔딩 수
  @Column({ type: 'int', default: 0 })
  endingsUnlocked: number;

  // 오늘 첫 대화 여부 추적용
  @Column({ type: 'date', nullable: true })
  lastChatDate: string;

  // 연속 대화 일수 (스트릭)
  @Column({ type: 'int', default: 0 })
  chatStreak: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => CharacterEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;
}
