import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ChatSessionEntity } from './chat-session.entity';
import { AttendanceEntity } from './attendance.entity';
import { UserBadgeEntity } from './user-badge.entity';

/**
 * User Entity
 *
 * 소셜 로그인 기반 — 자체 비밀번호 없음
 * provider + providerId 조합으로 유니크 식별
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  email: string;

  @Column()
  displayName: string;

  @Column({ nullable: true })
  avatarUrl: string;

  // OAuth 프로바이더 (google, kakao)
  @Index()
  @Column()
  provider: string;

  @Index()
  @Column()
  providerId: string;

  // 구독 상태 (Phase 2)
  @Column({ default: 'free' })
  tier: 'free' | 'premium';

  // 일일 메시지 잔여량
  @Column({ default: 50 })
  dailyMessageQuota: number;

  // 보너스 메시지 (출석 보상 등)
  @Column({ default: 0 })
  bonusMessages: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @OneToMany(() => ChatSessionEntity, (session) => session.user)
  sessions: ChatSessionEntity[];

  @OneToMany(() => AttendanceEntity, (attendance) => attendance.user)
  attendances: AttendanceEntity[];

  @OneToMany(() => UserBadgeEntity, (userBadge) => userBadge.user)
  badges: UserBadgeEntity[];
}
