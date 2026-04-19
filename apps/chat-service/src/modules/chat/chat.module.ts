import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PersonaEngineService } from './persona-engine.service';
import { EmotionStateService } from './emotion-state.service';
import { NarrativeEngineService } from './narrative-engine.service';
import { LlmModule } from '../llm/llm.module';
import { ContextModule } from '../context/context.module';
import { AffinityModule } from '../affinity/affinity.module';
import { StoryChoiceModule } from '../story-choice/story-choice.module';

@Module({
  imports: [LlmModule, ContextModule, AffinityModule, StoryChoiceModule],
  controllers: [ChatController],
  providers: [ChatService, PersonaEngineService, EmotionStateService, NarrativeEngineService],
  exports: [ChatService, NarrativeEngineService],
})
export class ChatModule {}
