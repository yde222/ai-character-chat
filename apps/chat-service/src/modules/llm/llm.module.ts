import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmService } from './llm.service';
import { CircuitBreakerService } from './circuit-breaker.service';

@Module({
  imports: [ConfigModule],
  providers: [LlmService, CircuitBreakerService],
  exports: [LlmService],
})
export class LlmModule {}
