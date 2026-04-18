import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatSessionEntity, ChatMessageEntity, CharacterEntity } from '@app/database';
import { RedisCacheModule } from '@app/common';
import { ContextManagerService } from './context-manager.service';
import { SummarizationService } from './summarization.service';

@Module({
  imports: [
    ConfigModule,
    RedisCacheModule,
    TypeOrmModule.forFeature([ChatSessionEntity, ChatMessageEntity, CharacterEntity]),
  ],
  providers: [ContextManagerService, SummarizationService],
  exports: [ContextManagerService],
})
export class ContextModule {}
