import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { MatchingService } from './matching.service';

@Controller()
export class MatchingController {
  private readonly logger = new Logger(MatchingController.name);

  constructor(private readonly matchingService: MatchingService) {}

  @GrpcMethod('ImageMatchingService', 'MatchImage')
  async matchImage(data: any) {
    this.logger.debug(`MatchImage: character=${data.character_id}, emotion=${data.emotion}`);
    return this.matchingService.matchImage(data);
  }

  @GrpcMethod('ImageMatchingService', 'GetCharacterAssets')
  async getCharacterAssets(data: any) {
    return this.matchingService.getCharacterAssets(data);
  }
}
