import { Module } from '@nestjs/common';
import { StoryChoiceService } from './story-choice.service';

@Module({
  providers: [StoryChoiceService],
  exports: [StoryChoiceService],
})
export class StoryChoiceModule {}
