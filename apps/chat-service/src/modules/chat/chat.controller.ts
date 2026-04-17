import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import { ChatService } from './chat.service';

/**
 * Chat gRPC Controller
 *
 * gRPC 메서드를 NestJS 핸들러로 매핑
 * 비즈니스 로직은 ChatService에 위임
 */
@Controller()
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  /**
   * 단일 응답 — 테스트/폴백용
   */
  @GrpcMethod('ChatService', 'SendMessage')
  async sendMessage(data: any) {
    this.logger.log(`SendMessage: session=${data.session_id}`);
    return this.chatService.sendMessage(data);
  }

  /**
   * 스트리밍 응답 — 메인 플로우
   *
   * 라이브 스트리밍 경험 적용:
   * - LLM API의 스트리밍 응답을 gRPC server-streaming으로 변환
   * - 청크 단위 전송으로 TTFB(Time To First Byte) 최소화
   * - 실패 시 부분 응답이라도 전달 (graceful degradation)
   */
  @GrpcMethod('ChatService', 'SendMessageStream')
  sendMessageStream(data: any): Observable<any> {
    this.logger.log(`SendMessageStream: session=${data.session_id}`);

    const subject = new Subject<any>();

    // 비동기로 스트리밍 처리 시작
    this.chatService
      .sendMessageStream(data, (chunk) => {
        subject.next(chunk);
      })
      .then(() => {
        subject.complete();
      })
      .catch((error) => {
        this.logger.error(`Stream error: ${error.message}`);
        subject.error(error);
      });

    return subject.asObservable();
  }

  @GrpcMethod('ChatService', 'GetHistory')
  async getHistory(data: any) {
    return this.chatService.getHistory(data);
  }

  @GrpcMethod('ChatService', 'CreateSession')
  async createSession(data: any) {
    this.logger.log(`CreateSession: user=${data.user_id}, character=${data.character_id}`);
    return this.chatService.createSession(data);
  }
}
