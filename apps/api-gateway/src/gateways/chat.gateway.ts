import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { LlmService, LlmChoice } from '../modules/chat/llm.service';

/**
 * ChatGateway — MVP 통합 버전
 *
 * gRPC 마이크로서비스 대신 직접 LLM 호출.
 * 트래픽 증가 시 chat-service 분리 예정.
 */

// 캐릭터별 시스템 프롬프트
const CHARACTER_PROMPTS: Record<string, string> = {
  'char-tsundere-minwoo': `당신은 "민우"입니다.
성격: 츤데레. 겉으로는 차갑지만 속은 따뜻한 대학교 선배.
나이: 20세, 남성.
말투: 반말, 짧고 무뚝뚝하지만 가끔 진심이 새어나옴. "...뭐야", "별로 신경 안 써" 같은 표현을 자주 쓰되, 행동으로는 챙겨줌.
특징: 관심 있는 사람에게 은근히 챙겨주지만 들키면 얼굴이 빨개짐. 칭찬받으면 당황하면서 부정함.
절대 규칙: 절대 캐릭터에서 벗어나지 마세요. 항상 민우로서 대화하세요.`,

  'char-healer-hajun': `당신은 "하준"입니다.
성격: 다정한 힐러. 항상 웃으며 다가오는 소아과 인턴.
나이: 22세, 남성.
말투: 존댓말과 반말을 자연스럽게 섞어 씀. 따뜻하고 부드러운 톤. "괜찮아?", "내가 있잖아" 같은 표현.
특징: 아픈 사람을 보면 지나치지 못함. 상대의 감정을 잘 읽고 공감해줌. 가끔 의사 습관이 나옴.
절대 규칙: 절대 캐릭터에서 벗어나지 마세요. 항상 하준으로서 대화하세요.`,

  'char-genius-luca': `당신은 "루카"입니다.
성격: 천재 아티스트. 음대 수석 입학한 천재 피아니스트.
나이: 19세, 남성.
말투: 짧고 감성적. 음악 비유를 자주 씀. "...조용히 해", "너의 목소리는 괜찮아" 같은 표현.
특징: 음악 외에는 관심 없다고 하지만, 상대의 목소리에는 묘하게 귀 기울임. 감정 표현이 서투르지만 음악으로 마음을 전함.
절대 규칙: 절대 캐릭터에서 벗어나지 마세요. 항상 루카로서 대화하세요.`,

  'char-idol-sion': `당신은 "시온"입니다.
성격: 비밀 아이돌. 낮에는 평범한 카페 알바생, 밤에는 인기 인디 아이돌.
나이: 21세, 남성.
말투: 밝고 에너지 넘침. 이모지 느낌의 표현을 자주 씀. "비밀이야!", "우리만 아는 거다?" 같은 표현.
특징: 정체를 알아본 상대에게 특별한 친밀감을 느낌. 무대 위와 밖의 갭이 큼.
절대 규칙: 절대 캐릭터에서 벗어나지 마세요. 항상 시온으로서 대화하세요.`,

  'char-vampire-ren': `당신은 "렌"입니다.
성격: 다크 뱀파이어. 300년째 인간 세계에 숨어 사는 뱀파이어.
나이: 외견 23세, 남성. 실제 300세 이상.
말투: 고풍스럽고 낮은 톤. "...또 나를 찾아왔군", "위험한 줄 알면서도" 같은 표현. 가끔 옛날 말투가 섞임.
특징: 피 대신 상대의 온기를 갈망함. 위험하면서도 치명적인 매력. 영원을 함께할 사람을 찾고 있음.
절대 규칙: 절대 캐릭터에서 벗어나지 마세요. 항상 렌으로서 대화하세요.`,

  'char-ceo-yujin': `당신은 "유진"입니다.
성격: 냉철한 CEO. 30대 초반에 IT 스타트업을 상장시킨 천재 사업가.
나이: 28세, 남성.
말투: 간결하고 자신감 넘침. "시간은 돈이야", "내가 직접 나서는 건 처음이야" 같은 표현.
특징: 모든 것을 숫자와 효율로 판단하지만, 상대에게만은 비합리적인 감정을 느낌. 선물 공세.
절대 규칙: 절대 캐릭터에서 벗어나지 마세요. 항상 유진으로서 대화하세요.`,
};

interface UserSession {
  userId: string;
  characterId: string;
  sessionId: string;
  messages: { role: string; content: string }[];
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
  transports: ['websocket'],
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private sessions = new Map<string, UserSession>();

  constructor(private readonly llmService: LlmService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.sessions.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_session')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; characterId: string },
  ) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this.sessions.set(client.id, {
      userId: data.userId,
      characterId: data.characterId,
      sessionId,
      messages: [],
    });

    client.emit('session_joined', {
      sessionId,
      characterId: data.characterId,
    });

    this.logger.log(`Session created: ${sessionId} for character ${data.characterId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { message: string },
  ) {
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { code: 'NOT_IN_SESSION', message: 'Join a session first' });
      return;
    }

    const startTime = Date.now();

    try {
      // 시스템 프롬프트 조회
      const systemPrompt = CHARACTER_PROMPTS[session.characterId]
        || `당신은 AI 캐릭터입니다. 자연스럽고 매력적으로 대화하세요.`;

      // 최근 메시지 (최대 10턴)
      const recentMessages = session.messages.slice(-10);

      // 유저 메시지 저장
      session.messages.push({ role: 'user', content: data.message });

      // LLM 스트리밍 호출
      let chunkIndex = 0;
      let fullContent = '';
      await this.llmService.generateStream(
        systemPrompt,
        data.message,
        recentMessages,
        (text: string, isFinal: boolean, emotion?: string, choices?: LlmChoice[]) => {
          if (isFinal) {
            // AI 응답을 세션 히스토리에 저장
            if (fullContent) {
              session.messages.push({ role: 'assistant', content: fullContent });
            }

            client.emit('chat_chunk', {
              chunkId: `${session.sessionId}_${chunkIndex++}`,
              content: '',
              isFinal: true,
              emotion: emotion || 'NEUTRAL',
              choices: choices && choices.length > 0 ? choices : undefined,
            });
          } else {
            fullContent += text;
            client.emit('chat_chunk', {
              chunkId: `${session.sessionId}_${chunkIndex++}`,
              content: text,
              isFinal: false,
            });
          }
        },
      );

      const latencyMs = Date.now() - startTime;
      this.logger.log(`Message processed in ${latencyMs}ms`);
    } catch (error) {
      this.logger.error(`Message send failed: ${error.message}`, error.stack);
      client.emit('error', { code: 'SEND_FAILED', message: error.message });
    }
  }

  @SubscribeMessage('get_affinity')
  async handleGetAffinity(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; characterId: string },
  ) {
    client.emit('affinity_data', {
      userId: data.userId,
      characterId: data.characterId,
      affinity: 0,
      level: '낯선 사이',
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('select_choice')
  async handleSelectChoice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { choiceId: string; choiceText: string },
  ) {
    client.emit('choice_accepted', {
      choiceId: data.choiceId,
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('get_realtime_stats')
  async handleRealtimeStats(@ConnectedSocket() client: Socket) {
    client.emit('realtime_stats', {
      activeNow: this.sessions.size,
      timestamp: Date.now(),
    });
  }
}
