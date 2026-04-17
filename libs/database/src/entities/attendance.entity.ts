import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from './user.entity';

/**
 * Attendance Entity — 출석 기록
 *
 * (userId, date) 유니크 제약 — 하루에 한 번만 기록
 *
 * 연속 접속(streak) 계산:
 * 옵션 A: 앱에서 계산 (현재 방식) — 단순, 정확
 * 옵션 B: SQL 윈도우 함수 — 복잡하지만 DB 한 번에 처리
 *
 * Phase 2에서 Redis BITFIELD로 전환 시:
 * - 이 테이블은 감사 로그 + 통계용으로 유지
 * - 실시간 체크는 Redis에서 처리 (지연 < 1ms)
 */
@Entity('attendances')
@Unique(['userId', 'date'])
export class AttendanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  // YYYY-MM-DD 형식
  @Index()
  @Column({ type: 'date' })
  date: string;

  // 해당 시점의 연속 접속 일수
  @Column({ default: 1 })
  streakCount: number;

  // 획득한 보상 (있으면)
  @Column({ nullable: true })
  reward: string;

  @Column({ default: 0 })
  bonusMessages: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => UserEntity, (user) => user.attendances)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
}
