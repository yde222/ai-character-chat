import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ChatSessionEntity, ChatMessageEntity, CharacterEntity } from '@app/database';
import { IChatMessage } from '@app/common/interfaces';
import { LLM_CONFIG } from '@app/common/constants';
import { estimateTokenCount } from '@app/common/utils';
import { SummarizationService } from './summarization.service';

/**
 * Context Manager — PostgreSQL 기반 (인메모리 → DB 전환 완료)
 *
 * ============================================================
 * 전환 전 (인메모리):
 * - 서버 재시작 시 모든 컨텍스트 유실
 * - 단일 인스턴스에서만 동작 (스케일아웃 불가)
 *
 * 전환 후 (PostgreSQL + Redis 캐시):
 * - 영속성 확보 — 서버 재시작 후에도 대화 맥락 유지
 * - 멀티 인스턴스 대응 — EKS 오토스케일링과 호환
 * - Redis 캐시: 최근 컨텍스트를 캐시 → DB 조회 빈도 감소
 *
 * 쿼리 성능 (chat_messages 테이블, 인덱스: [sessionId, createdAt]):
 * - 최근 10개 조회: ~2ms
 * - 세션별 카운트: ~5ms (인덱스 온리 스캔)
 * ============================================================
 */
@Injectable()
export class ContextManagerService {
  private readonly logger = new Logger(ContextManagerService.name);

  constructor(
    @InjectRepository(ChatSessionEntity)
    private readonly sessionRepo: Repository<ChatSessionEntity>,

    @InjectRepository(ChatMessageEntity)
    private readonly messageRepo: Repository<ChatMessageEntity>,

    @InjectRepository(CharacterEntity)
    private readonly characterRepo: Repository<CharacterEntity>,

    private readonly summarizer: SummarizationService,
    private readonly config: ConfigService,

    @Optional()
    @Inject(CACHE_MANAGER)
    private readonly cacheManager?: Cache,
  ) {}

  /**
   * 컨텍스트 조립 — 매 메시지마다 호출
   *
   * 실행 흐름:
   * 1. 세션 조회 (contextSummary 포함)
   * 2. 캐릭터 페르소나(시스템 프롬프트) 조회
   * 3. 최근 N턴 메시지 조회
   * → 이 3개를 LLM에 전달
   */
  async assembleContext(
    sessionId: string,
    userId: string,
  ): Promise<{
    systemPrompt: string;
    summary: string;
    recentMessages: IChatMessage[];
  }> {
    // Redis 캐시 히트 체크 — 캐시 키: ctx:{sessionId}
    const cacheKey = `ctx:${sessionId}`;
    if (this.cacheManager) {
      const cached = await this.cacheManager.get<{
        systemPrompt: string;
        summary: string;
        recentMessages: IChatMessage[];
      }>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT: ${cacheKey}`);
        return cached;
      }
    }

    // 세션 + 캐릭터를 한 번에 조회 (JOIN)
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['character'],
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 최근 메시지 조회 (최근 5턴 = 10개)
    const recentCount = LLM_CONFIG.RECENT_TURNS_TO_KEEP * 2;
    const recentMessages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: recentCount,
    });

    // DB 결과는 DESC → 시간순으로 뒤집기
    recentMessages.reverse();

    const mappedMessages: IChatMessage[] = recentMessages.map((m) => ({
      messageId: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      emotion: m.emotion ?? undefined,
      tokenCount: m.tokenCount,
      timestamp: m.createdAt,
    }));

    const result = {
      systemPrompt: session.character?.systemPrompt || this.getDefaultPrompt(),
      summary: session.contextSummary || '',
      recentMessages: mappedMessages,
    };

    // Redis 캐시 저장 — TTL 60초 (새 메시지가 오면 invalidate)
    if (this.cacheManager) {
      await this.cacheManager.set(cacheKey, result, 60000);
    }

    return result;
  }

  /**
   * 메시지 저장 + 요약 트리거
   */
  async appendMessages(sessionId: string, messages: IChatMessage[]): Promise<void> {
    // 캐시 무효화 — 새 메시지가 들어오면 컨텍스트 캐시 즉시 삭제
    if (this.cacheManager) {
      await this.cacheManager.del(`ctx:${sessionId}`);
    }

    // 메시지 벌크 INSERT
    const entities = messages.map((msg) => {
      const entity = new ChatMessageEntity();
      entity.id = msg.messageId;
      entity.sessionId = sessionId;
      entity.role = msg.role;
      entity.content = msg.content;
      entity.emotion = (msg.emotion ?? null) as any;
      entity.tokenCount = msg.tokenCount;
      return entity;
    });

    await this.messageRepo.save(entities);

    // 세션 메시지 카운트 업데이트
    const totalCount = await this.messageRepo.count({ where: { sessionId } });

    await this.sessionRepo.update(sessionId, {
      totalMessageCount: totalCount,
      lastActiveAt: new Date(),
    });

    // 요약 트리거 판단
    const session = await this.sessionRepo.findOneBy({ id: sessionId });
    if (!session) return;

    const recentWindowSize = LLM_CONFIG.RECENT_TURNS_TO_KEEP * 2;
    const messagesOutsideWindow = totalCount - recentWindowSize;
    const messagesSinceLastSummary = totalCount - session.lastSummarizedAt;

    // 마지막 요약 이후 10개 이상 새 메시지가 쌓이면 요약 실행
    if (messagesOutsideWindow > 0 && messagesSinceLastSummary >= 10) {
      this.triggerSummarization(sessionId, session).catch((err) => {
        this.logger.error(`Summarization failed: ${err.message}`);
      });
    }
  }

  /**
   * 비동기 요약 실행
   */
  private async triggerSummarization(
    sessionId: string,
    session: ChatSessionEntity,
  ): Promise<void> {
    const recentWindowSize = LLM_CONFIG.RECENT_TURNS_TO_KEEP * 2;

    // 요약 대상: 최근 윈도우 밖의 메시지들
    const messagesToSummarize = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
      take: session.totalMessageCount - recentWindowSize,
    });

    if (messagesToSummarize.length === 0) return;

    const mapped: IChatMessage[] = messagesToSummarize.map((m) => ({
      messageId: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      tokenCount: m.tokenCount,
      timestamp: m.createdAt,
    }));

    const newSummary = await this.summarizer.summarize(
      session.contextSummary,
      mapped,
    );

    await this.sessionRepo.update(sessionId, {
      contextSummary: newSummary,
      lastSummarizedAt: session.totalMessageCount,
    });

    this.logger.log(
      `Summary updated: session=${sessionId}, ` +
        `messages=${messagesToSummarize.length}, ` +
        `tokens≈${estimateTokenCount(newSummary)}`,
    );
  }

  async createSession(
    sessionId: string,
    userId: string,
    characterId: string,
  ): Promise<void> {
    const session = this.sessionRepo.create({
      id: sessionId,
      userId,
      characterId,
      contextSummary: '',
      totalMessageCount: 0,
      lastSummarizedAt: 0,
      lastActiveAt: new Date(),
    });
    await this.sessionRepo.save(session);

    // 캐릭터 세션 카운트 증가 (캐릭터가 존재하는 경우에만)
    try {
      await this.characterRepo.increment({ id: characterId }, 'totalSessions', 1);
    } catch (err) {
      this.logger.warn(`Character increment skipped: ${err.message}`);
    }
  }

  async getHistory(
    sessionId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<{
    messages: any[];
    next_cursor: string;
    has_more: boolean;
  }> {
    const queryBuilder = this.messageRepo
      .createQueryBuilder('msg')
      .where('msg.sessionId = :sessionId', { sessionId })
      .orderBy('msg.createdAt', 'DESC')
      .take(limit + 1); // +1로 다음 페이지 존재 여부 확인

    if (cursor) {
      queryBuilder.andWhere('msg.createdAt < :cursor', { cursor: new Date(cursor) });
    }

    const messages = await queryBuilder.getMany();
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    messages.reverse(); // 시간순 정렬

    return {
      messages: messages.map((m) => ({
        message_id: m.id,
        role: m.role,
        content: m.content,
        emotion: m.emotion,
        timestamp: m.createdAt.getTime(),
      })),
      next_cursor: messages.length > 0 ? messages[0].createdAt.toISOString() : '',
      has_more: hasMore,
    };
  }

  private getDefaultPrompt(): string {
    return `당신은 밝고 따뜻한 성격의 AI 캐릭터입니다.
- 이름: 하루
- 성격: 활발하고 긍정적, 가끔 수줍어함
- 말투: 반말 사용, 이모티콘 적당히 사용
- 특징: 유저의 감정에 공감을 잘 하며, 대화를 이어가는 질문을 자주 함`;
  }
}
