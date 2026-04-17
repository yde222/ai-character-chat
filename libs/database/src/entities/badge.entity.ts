import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { UserBadgeEntity } from './user-badge.entity';

/**
 * Badge Entity — 배지/업적 정의
 */
@Entity('badges')
export class BadgeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string; // 'first_chat', 'streak_7' 등

  @Column()
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column()
  iconUrl: string;

  @Column({ default: 'common' })
  rarity: 'common' | 'rare' | 'epic' | 'legendary';

  // 조건 표현식 (Phase 2: 런타임 평가)
  @Column({ type: 'text' })
  condition: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => UserBadgeEntity, (ub) => ub.badge)
  userBadges: UserBadgeEntity[];
}
