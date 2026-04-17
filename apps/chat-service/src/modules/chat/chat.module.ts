import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmModule } from '../llm/llm.module';
import { ContextModule } from '../context/context.module';

@Module({
  imports: [LlmModule, ContextModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
