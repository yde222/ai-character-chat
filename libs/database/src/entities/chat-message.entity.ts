import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { ChatSessionEntity } from './chat-session.entity';

/**
 * Chat Message Entity
 *
 * 인덱스 전략:
 * - (sessionId, createdAt): 세션 내 시간순 조회 (가장 빈번한 쿼리)
 * - sessionId: 세션별 메시지 카운트
 *
 * 파티셔닝 (Phase 3, 데이터 100M+ 시):
 * - createdAt 기준 월별 파티셔닝
 * - 3개월 이전 데이터는 콜드 스토리지(S3)로 아카이빙
 *
 * 성능 벤치마크 (PostgreSQL 16, 1M 행 기준):
 * - 세션별 최근 10개 조회: ~2ms (인덱스 스캔)
 * - 전체 카운트: ~50ms (인덱스 온리 스캔)
 */
@Entity('chat_messages')
@Index(['sessionId', 'createdAt'])
export class ChatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  sessionId: string;

  @Column()
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  content: string;

  // 감정 태그 (assistant 메시지만)
  @Column({ nullable: true })
  emotion: number;

  // 토큰 사용량 (비용 추적용)
  @Column({ default: 0 })
  tokenCount: number;

  // 사용된 LLM 모델 (assistant 메시지만)
  @Column({ nullable: true })
  model: string;

  // 응답 지연 (ms, assistant 메시지만)
  @Column({ nullable: true })
  latencyMs: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => ChatSessionEntity, (session) => session.messages)
  @JoinColumn({ name: 'sessionId' })
  session: ChatSessionEntity;
}
