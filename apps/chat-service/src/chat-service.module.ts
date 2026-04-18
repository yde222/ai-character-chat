import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
import { ChatModule } from './modules/chat/chat.module';
import { LlmModule } from './modules/llm/llm.module';
import { ContextModule } from './modules/context/context.module';
import { AffinityModule } from './modules/affinity/affinity.module';
import { StoryChoiceModule } from './modules/story-choice/story-choice.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { RetentionModule } from './modules/retention/retention.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    ChatModule,
    LlmModule,
    ContextModule,
    AffinityModule,
    StoryChoiceModule,
    SubscriptionModule,
    RetentionModule,
    AnalyticsModule,
  ],
})
export class ChatServiceModule {}
