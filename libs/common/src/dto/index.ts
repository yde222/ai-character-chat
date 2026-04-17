import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';

// ============================================================
// 공유 DTO — API Gateway 입력 검증용
// ============================================================

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  characterId: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  characterId: string;
}

export class GetHistoryDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}
