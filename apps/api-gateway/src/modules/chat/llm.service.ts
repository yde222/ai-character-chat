import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

/**
 * 경량 LLM Service — api-gateway 내장용 (MVP)
 *
 * chat-service의 풀버전 대신, Gemini 직접 호출만 지원.
 * 마이크로서비스 분리는 트래픽 증가 시 진행.
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private geminiModel: GenerativeModel | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = genAI.getGenerativeModel({
        model: this.config.get('LLM_PRIMARY_MODEL', 'gemini-2.5-flash'),
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ],
      });
      this.logger.log('✅ Gemini SDK initialized');
    } else {
      this.logger.warn('⚠️ GEMINI_API_KEY not set — LLM unavailable');
    }
  }

  /**
   * 스트리밍 응답 생성
   */
  async generateStream(
    systemPrompt: string,
    userMessage: string,
    recentMessages: { role: string; content: string }[],
    onChunk: (text: string, isFinal: boolean, emotion?: string) => void,
  ): Promise<void> {
    if (!this.geminiModel) {
      throw new Error('Gemini SDK not initialized — GEMINI_API_KEY missing');
    }

    const prompt = this.buildPrompt(userMessage, recentMessages);

    const result = await this.geminiModel.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.8,
      },
    });

    let fullText = '';
    let buffer = '';

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (!chunkText) continue;

      fullText += chunkText;
      buffer += chunkText;

      if (buffer.length >= 4) {
        onChunk(buffer, false);
        buffer = '';
      }
    }

    // 감정 태그 파싱
    const { content, emotion } = this.parseEmotion(fullText);

    // 남은 버퍼 플러시 (감정 태그 제거)
    if (buffer.length > 0) {
      const clean = buffer.replace(/\[EMOTION:\w+\]/g, '').trim();
      if (clean) onChunk(clean, false);
    }

    onChunk('', true, emotion);
  }

  private buildPrompt(
    userMessage: string,
    recentMessages: { role: string; content: string }[],
  ): string {
    const parts: string[] = [];

    if (recentMessages.length > 0) {
      parts.push('[최근 대화]');
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? '유저' : '캐릭터';
        parts.push(`${role}: ${msg.content}`);
      }
    }

    parts.push(`\n유저: ${userMessage}`);
    parts.push(
      '\n[응답 지시]' +
      '\n1. 위 대화에 이어서 캐릭터로서 자연스럽게 응답하세요.' +
      '\n2. 응답 길이: 1~3문장.' +
      '\n3. 유저의 말에 반응하고, 대화를 이어가는 요소를 포함하세요.' +
      '\n4. 감정은 대사와 행동으로 자연스럽게 드러내세요.' +
      '\n5. 응답 마지막 줄에 [EMOTION:태그명] 형식으로 감정을 표시하세요.' +
      '\n   가능한 태그: NEUTRAL, JOY, SADNESS, ANGER, SURPRISE, AFFECTION, FEAR, DISGUST, EXCITEMENT, SHY',
    );

    return parts.join('\n');
  }

  private parseEmotion(text: string): { content: string; emotion: string } {
    const match = text.match(/\[EMOTION:(\w+)\]/);
    const emotion = match ? match[1].toUpperCase() : 'NEUTRAL';
    const content = text.replace(/\[EMOTION:\w+\]/g, '').trim();
    return { content, emotion };
  }
}
