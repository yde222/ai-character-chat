import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ChatSessionEntity } from './chat-session.entity';
import { ImageAssetEntity } from './image-asset.entity';

/**
 * Character Entity — AI 캐릭터 정의
 *
 * Phase 1: 운영팀이 직접 등록 (5~10개 캐릭터)
 * Phase 3: 유저 생성 캐릭터 (creatorId 필드 활성화)
 */
@Entity('characters')
export class CharacterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  systemPrompt: string;

  @Column({ type: 'text' })
  personality: string;

  @Column({ type: 'text', nullable: true })
  backgroundStory: string;

  @Column({ nullable: true })
  speechStyle: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ nullable: true })
  coverImageUrl: string;

  // 감정 표현 가중치 (JSON)
  @Column({ type: 'simple-json', default: '{}' })
  emotionWeights: Record<string, number>;

  // 공개 여부
  @Column({ default: true })
  isPublic: boolean;

  // 프리미엄 전용 여부
  @Column({ default: false })
  isPremium: boolean;

  // Phase 3: 유저 생성 캐릭터
  @Column({ nullable: true })
  creatorId: string;

  // 인기도 (정렬/추천용)
  @Column({ default: 0 })
  totalSessions: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ChatSessionEntity, (session) => session.character)
  sessions: ChatSessionEntity[];

  @OneToMany(() => ImageAssetEntity, (asset) => asset.character)
  assets: ImageAssetEntity[];
}
