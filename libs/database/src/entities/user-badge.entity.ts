import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { BadgeEntity } from './badge.entity';

/**
 * User-Badge 연결 테이블
 */
@Entity('user_badges')
@Unique(['userId', 'badgeId'])
export class UserBadgeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  badgeId: string;

  @CreateDateColumn()
  earnedAt: Date;

  @ManyToOne(() => UserEntity, (user) => user.badges)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => BadgeEntity, (badge) => badge.userBadges)
  @JoinColumn({ name: 'badgeId' })
  badge: BadgeEntity;
}
