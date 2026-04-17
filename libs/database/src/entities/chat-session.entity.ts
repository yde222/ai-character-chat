import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { CharacterEntity } from './character.entity';
import { ChatMessageEntity } from './chat-message.entity';

/**
 * Chat Session Entity
 *
 * 유저-캐릭터 간 대화 세션
 * contextSummary: 3-Tier 컨텍스트의 Tier 2 (요약 압축본) 저장
 */
@Entity('chat_sessions')
export class ChatSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column()
  characterId: string;

  // 컨텍스트 요약 — 베이비챗 감자 현상 방어의 핵심 필드
  @Column({ type: 'text', default: '' })
  contextSummary: string;

  @Column({ default: 0 })
  totalMessageCount: number;

  // 마지막 요약 시점의 메시지 수 (증분 요약 트리거 기준)
  @Column({ default: 0 })
  lastSummarizedAt: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastActiveAt: Date;

  @ManyToOne(() => UserEntity, (user) => user.sessions, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => CharacterEntity, (character) => character.sessions, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @OneToMany(() => ChatMessageEntity, (message) => message.session)
  messages: ChatMessageEntity[];
}
