import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Inject, OnModuleInit, Logger, UseGuards } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Server, Socket } from 'socket.io';
import { Observable, lastValueFrom } from 'rxjs';
import { CHAT_SERVICE, IMAGE_MATCHING_SERVICE } from '@app/common/constants';

/**
 * WebSocket Gateway — 실시간 채팅의 심장부
 *
 * 아키텍처 포지션:
 * [클라이언트] ←WebSocket→ [이 Gateway] ←gRPC→ [Chat Service]
 *                                        ←gRPC→ [Image Service]
 *
 * 핵심 설계 원칙:
 * 1. Gateway는 라우터일 뿐, 비즈니스 로직 없음
 * 2. 채팅과 이미지를 병렬 처리 (Promise.all)
 * 3. 스트리밍 응답은 청크 단위로 클라이언트에 push
 *
 * 라이브 스트리밍 경험 적용 지점:
 * - 청크 단위 렌더링: 라이브 스트림 패킷 처리와 동일 구조
 * - 버퍼링 전략: 네트워크 지터 대응
 * - 연결 복구: WebSocket 재연결 + 세션 복원
 */
@WebSocketGateway({
  cors: {
    origin: '*', // MVP — Phase 2에서 도메인 제한
  },
  namespace: '/chat',
  transports: ['websocket'], // polling 비활성화 — 지연 최소화
})
export class ChatGateway implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private chatService: any;
  private imageService: any;

  // 연결된 유저 추적 (메모리 — Phase 2에서 Redis로 전환)
  private connectedUsers = new Map<string, { userId: string; sessionId: string }>();

  constructor(
    @Inject(CHAT_SERVICE) private readonly chatClient: ClientGrpc,
    @Inject(IMAGE_MATCHING_SERVICE) private readonly imageClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.chatService = this.chatClient.getService('ChatService');
    this.imageService = this.imageClient.getService('ImageMatchingService');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.connectedUsers.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * 세션 참여 — 연결 후 첫 번째로 호출
   */
  @SubscribeMessage('join_session')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; characterId: string; sessionId?: string },
  ) {
    try {
      let session;

      if (data.sessionId) {
        // 기존 세션 복귀
        session = { session_id: data.sessionId, character_id: data.characterId };
      } else {
        // 새 세션 생성
        session = await lastValueFrom(
          this.chatService.CreateSession({
            user_id: data.userId,
            character_id: data.characterId,
          }),
        ) as any;
      }

      this.connectedUsers.set(client.id, {
        userId: data.userId,
        sessionId: (session as any).session_id,
      });

      // 소켓 룸 참여 (세션별 격리)
      client.join(`session:${(session as any).session_id}`);

      client.emit('session_joined', {
        sessionId: (session as any).session_id,
        characterId: (session as any).character_id,
        contextSummary: (session as any).context_summary || null,
      });
    } catch (error) {
      this.logger.error(`Session join failed: ${error.message}`, error.stack);
      client.emit('error', { code: 'SESSION_JOIN_FAILED', message: error.message });
    }
  }

  /**
   * 메시지 전송 — 핵심 플로우
   *
   * 실행 흐름:
   * 1. gRPC로 Chat Service에 메시지 전달
   * 2. Chat Service가 LLM 응답 + 감정 태그 반환
   * 3. 감정 태그로 Image Service에 이미지 매칭 요청 (병렬)
   * 4. 텍스트 + 이미지를 클라이언트에 push
   */
  @SubscribeMessage('get_subscription')
  async handleGetSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    try {
      // Phase 1: 클라이언트에 구독 정보 반환
      client.emit('subscription_info', {
        userId: data.userId,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Subscription fetch failed: ${error.message}`);
      client.emit('error', { code: 'SUBSCRIPTION_FAILED', message: error.message });
    }
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { message: string },
  ) {
    const userInfo = this.connectedUsers.get(client.id);
    if (!userInfo) {
      client.emit('error', { code: 'NOT_IN_SESSION', message: 'Join a session first' });
      return;
    }

    const startTime = Date.now();

    try {
      // ============================================================
      // 수익화 게이트: 사용량 체크 (LLM 호출 전)
      // ============================================================
      // Phase 2에서 SubscriptionService를 gRPC로 호출
      // Phase 1: 클라이언트 측에서 체크 (서버는 이벤트만 발행)
      client.emit('usage_check', {
        userId: userInfo.userId,
        timestamp: Date.now(),
      });
      // ============================================================
      // Phase 1: 텍스트 응답 (스트리밍)
      // 라이브 스트리밍 경험 적용 — 청크 단위 전송
      // ============================================================
      const stream$: Observable<any> = this.chatService.SendMessageStream({
        session_id: userInfo.sessionId,
        user_id: userInfo.userId,
        message: data.message,
        client_timestamp: Date.now(),
      });

      let fullContent = '';
      let finalEmotion = 0; // NEUTRAL

      // 스트리밍 청크를 클라이언트에 실시간 전달
      stream$.subscribe({
        next: (chunk: any) => {
          fullContent += chunk.content;
          client.emit('chat_chunk', {
            chunkId: chunk.chunk_id,
            content: chunk.content,
            isFinal: chunk.is_final,
          });

          if (chunk.is_final) {
            finalEmotion = chunk.emotion;
          }
        },
        error: (err: any) => {
          this.logger.error(`Stream error: ${err.message}`);
          client.emit('error', { code: 'STREAM_ERROR', message: 'AI response failed' });
        },
        complete: async () => {
          // ============================================================
          // Phase 2: 이미지 매칭 (텍스트 완료 후 즉시)
          // ============================================================
          try {
            const imageMatch = await lastValueFrom(
              this.imageService.MatchImage({
                character_id: data.message, // TODO: characterId from session
                emotion: finalEmotion,
                action_hints: [],
                recent_asset_ids: [],
              }),
            );

            client.emit('chat_image', {
              assetId: (imageMatch as any).asset_id,
              cdnUrl: (imageMatch as any).cdn_url,
              assetType: (imageMatch as any).asset_type,
              emotion: (imageMatch as any).emotion,
            });
          } catch (imgErr) {
            // 이미지 실패는 치명적이지 않음 — 텍스트만으로도 UX 유지
            this.logger.warn(`Image matching failed: ${imgErr.message}`);
          }

          // ============================================================
          // Phase 3: 호감도 업데이트 이벤트 (텍스트 + 이미지 후)
          // ============================================================
          client.emit('affinity_update', {
            emotion: finalEmotion,
            timestamp: Date.now(),
          });

          // ============================================================
          // Phase 4: 스토리 선택지 (3턴마다 등장)
          // ============================================================
          client.emit('story_choices', {
            sessionId: userInfo.sessionId,
            emotion: finalEmotion,
            timestamp: Date.now(),
          });

          const latencyMs = Date.now() - startTime;
          this.logger.log(`Message processed in ${latencyMs}ms`);
        },
      });
    } catch (error) {
      this.logger.error(`Message send failed: ${error.message}`, error.stack);
      client.emit('error', { code: 'SEND_FAILED', message: error.message });
    }
  }

  /**
   * 호감도 조회
   */
  @SubscribeMessage('get_affinity')
  async handleGetAffinity(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; characterId: string },
  ) {
    try {
      // Phase 1: 클라이언트에 현재 호감도 반환
      // 실제 DB 조회는 chat-service에서 gRPC로 수행
      client.emit('affinity_data', {
        userId: data.userId,
        characterId: data.characterId,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Affinity fetch failed: ${error.message}`);
      client.emit('error', { code: 'AFFINITY_FAILED', message: error.message });
    }
  }

  /**
   * 스토리 선택지 선택 처리
   *
   * 유저가 선택지를 클릭 → 선택 결과를 다음 대화에 반영
   */
  @SubscribeMessage('select_choice')
  async handleSelectChoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { choiceId: string; choiceText: string },
  ) {
    const userInfo = this.connectedUsers.get(client.id);
    if (!userInfo) {
      client.emit('error', { code: 'NOT_IN_SESSION', message: 'Join a session first' });
      return;
    }

    try {
      // 선택지 텍스트를 유저 메시지처럼 처리 → AI가 반응
      this.logger.log(`Choice selected: ${data.choiceId} → "${data.choiceText}"`);

      client.emit('choice_accepted', {
        choiceId: data.choiceId,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Choice processing failed: ${error.message}`);
      client.emit('error', { code: 'CHOICE_FAILED', message: error.message });
    }
  }

  // ============================================================
  // 리텐션: 출석 체크 + 일일 미션
  // ============================================================

  /**
   * 출석 체크
   * 호출 시점: 클라이언트 앱 진입 시 (세션 시작 전)
   */
  @SubscribeMessage('check_in')
  async handleCheckIn(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    try {
      // Phase 1: 클라이언트에 출석 결과 반환
      // Phase 2: RetentionService.checkIn() gRPC 호출
      client.emit('check_in_result', {
        userId: data.userId,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Check-in failed: ${error.message}`);
      client.emit('error', { code: 'CHECKIN_FAILED', message: error.message });
    }
  }

  /**
   * 일일 미션 목록 조회
   */
  @SubscribeMessage('get_missions')
  async handleGetMissions(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    try {
      client.emit('daily_missions', {
        userId: data.userId,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Mission fetch failed: ${error.message}`);
      client.emit('error', { code: 'MISSION_FAILED', message: error.message });
    }
  }

  /**
   * 미션 보상 수령
   */
  @SubscribeMessage('claim_mission_reward')
  async handleClaimMissionReward(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; missionId: string },
  ) {
    try {
      client.emit('mission_reward_claimed', {
        userId: data.userId,
        missionId: data.missionId,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Mission reward claim failed: ${error.message}`);
      client.emit('error', { code: 'REWARD_FAILED', message: error.message });
    }
  }

  // ============================================================
  // 관리자 대시보드: 실시간 통계
  // ============================================================

  /**
   * 실시간 활성 현황 조회
   * 용도: 관리자 대시보드 실시간 위젯
   */
  @SubscribeMessage('get_realtime_stats')
  async handleRealtimeStats(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      client.emit('realtime_stats', {
        activeNow: this.connectedUsers.size,
        activeSessions: new Set([...this.connectedUsers.values()].map(u => u.sessionId)).size,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Realtime stats failed: ${error.message}`);
      client.emit('error', { code: 'STATS_FAILED', message: error.message });
    }
  }
}
