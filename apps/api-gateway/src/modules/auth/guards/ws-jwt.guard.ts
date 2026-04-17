import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../auth.service';

/**
 * WebSocket JWT Guard
 *
 * WebSocket 연결 시 핸드셰이크 단계에서 JWT 검증
 *
 * 클라이언트 연결 방법:
 * ```typescript
 * const socket = io('/chat', {
 *   auth: { token: 'Bearer eyJhbG...' },
 *   transports: ['websocket'],
 * });
 * ```
 *
 * 보안:
 * - 토큰이 없거나 만료되면 연결 거부
 * - 검증된 유저 정보를 socket.data에 저장 → 이후 이벤트에서 사용
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();

    // auth.token에서 JWT 추출
    const authHeader = client.handshake?.auth?.token || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      this.logger.warn(`WS connection rejected — no token: ${client.id}`);
      throw new WsException('Authentication required');
    }

    const payload = this.authService.verifyToken(token);
    if (!payload) {
      this.logger.warn(`WS connection rejected — invalid token: ${client.id}`);
      throw new WsException('Invalid or expired token');
    }

    // 검증된 유저 정보를 socket에 저장
    client.data.user = {
      userId: payload.sub,
      email: payload.email,
      displayName: payload.displayName,
      tier: payload.tier,
    };

    return true;
  }
}
