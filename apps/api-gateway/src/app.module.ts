import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChatGateway } from './gateways/chat.gateway';

/**
 * AppModule — MVP 통합 버전
 *
 * gRPC 마이크로서비스 의존성 제거.
 * LLM 호출을 api-gateway 내에서 직접 처리.
 * DatabaseModule도 MVP에서는 제외 (인메모리 세션 관리).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    HealthModule,
    ChatModule,
  ],
  providers: [ChatGateway],
})
export class AppModule {}
