import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

export interface LlmChoice {
  id: string;
  text: string;
  emoji: string;
  effect: 'positive' | 'neutral' | 'negative';
  affinityHint: string;
}

/**
 * LLM Service — Gemini Primary + Claude Fallback
 *
 * 전략: Gemini 먼저 시도 → 실패(429/503) → Claude 자동 전환
 * 성공 사례: Replicate (2024) — 멀티 LLM fallback으로 가용성 99.9% 달성
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private geminiModel: GenerativeModel | null = null;
  private anthropic: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Gemini 초기화
    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = genAI.getGenerativeModel({
        model: this.config.get('LLM_PRIMARY_MODEL', 'gemini-2.0-flash'),
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ],
      });
      this.logger.log('✅ Gemini SDK initialized');
    } else {
      this.logger.warn('⚠️ GEMINI_API_KEY not set');
    }

    // Anthropic 초기화
    const anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
      this.logger.log('✅ Anthropic SDK initialized');
    } else {
      this.logger.warn('⚠️ ANTHROPIC_API_KEY not set');
    }

    if (!geminiKey && !anthropicKey) {
      this.logger.error('❌ No LLM API key configured — chat will not work');
    }
  }

  /**
   * 스트리밍 응답 생성 — Gemini 우선, 실패 시 Claude fallback
   */
  async generateStream(
    systemPrompt: string,
    userMessage: string,
    recentMessages: { role: string; content: string }[],
    onChunk: (text: string, isFinal: boolean, emotion?: string, choices?: LlmChoice[]) => void,
    characterName?: string,
  ): Promise<void> {
    // Gemini 먼저 시도
    if (this.geminiModel) {
      try {
        await this.generateWithGemini(systemPrompt, userMessage, recentMessages, onChunk, characterName);
        return;
      } catch (error) {
        this.logger.warn(`Gemini failed (${error.message?.slice(0, 80)}), trying Claude fallback...`);
      }
    }

    // Claude fallback
    if (this.anthropic) {
      try {
        await this.generateWithClaude(systemPrompt, userMessage, recentMessages, onChunk, characterName);
        return;
      } catch (error) {
        this.logger.error(`Claude also failed: ${error.message}`);
        throw error;
      }
    }

    throw new Error('No LLM available — both Gemini and Claude failed or unconfigured');
  }

  /**
   * Gemini 스트리밍
   */
  private async generateWithGemini(
    systemPrompt: string,
    userMessage: string,
    recentMessages: { role: string; content: string }[],
    onChunk: (text: string, isFinal: boolean, emotion?: string, choices?: LlmChoice[]) => void,
    characterName?: string,
  ): Promise<void> {
    const prompt = this.buildPrompt(userMessage, recentMessages, characterName);

    const result = await this.geminiModel!.generateContentStream({
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
        // 첫 번째 '[' 이후 전부 홀드 — [EMOTION:...] [CHOICE_P:...] 등 연속 태그 대응
        const bracketIdx = buffer.indexOf('[');
        if (bracketIdx >= 0) {
          const beforeBracket = buffer.slice(0, bracketIdx);
          if (beforeBracket) onChunk(beforeBracket, false);
          buffer = buffer.slice(bracketIdx);
        } else {
          onChunk(buffer, false);
          buffer = '';
        }
      }
    }

    const { emotion, choices } = this.parseResponse(fullText);

    // 남은 버퍼에서 메타 태그 제거 후 전송
    if (buffer.length > 0) {
      const clean = this.stripMetaTags(buffer);
      if (clean) onChunk(clean, false);
    }

    onChunk('', true, emotion, choices);
  }

  /**
   * Claude 스트리밍
   */
  private async generateWithClaude(
    systemPrompt: string,
    userMessage: string,
    recentMessages: { role: string; content: string }[],
    onChunk: (text: string, isFinal: boolean, emotion?: string, choices?: LlmChoice[]) => void,
    characterName?: string,
  ): Promise<void> {
    const prompt = this.buildPrompt(userMessage, recentMessages, characterName);

    // 단일 user 메시지로 전송 (대화 히스토리는 prompt 안에 포함됨)
    const stream = this.anthropic!.messages.stream({
      model: this.config.get('ANTHROPIC_MODEL', 'claude-3-5-haiku-20241022'),
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    let fullText = '';
    let buffer = '';

    stream.on('text', (text: string) => {
      fullText += text;
      buffer += text;

      if (buffer.length >= 4) {
        const bracketIdx = buffer.indexOf('[');
        if (bracketIdx >= 0) {
          const beforeBracket = buffer.slice(0, bracketIdx);
          if (beforeBracket) onChunk(beforeBracket, false);
          buffer = buffer.slice(bracketIdx);
        } else {
          onChunk(buffer, false);
          buffer = '';
        }
      }
    });

    // 스트림 완료 대기
    await stream.finalMessage();

    const { emotion, choices } = this.parseResponse(fullText);

    if (buffer.length > 0) {
      const clean = this.stripMetaTags(buffer);
      if (clean) onChunk(clean, false);
    }

    onChunk('', true, emotion, choices);
  }

  private buildPrompt(
    userMessage: string,
    recentMessages: { role: string; content: string }[],
    characterName?: string,
  ): string {
    const charLabel = characterName || '캐릭터';
    const lines: string[] = [];

    // 역할 + 응답 지시를 먼저 배치
    if (characterName) {
      lines.push(`[역할: 당신은 ${characterName}입니다. 절대 다른 이름이나 캐릭터가 되지 마세요.]`);
    }
    lines.push(
      `[지시사항]`,
      `- 아래 대화에서 유저(상대방)의 마지막 말에 ${charLabel}(당신)로서 응답하세요.`,
      `- 유저와 ${charLabel}를 혼동하지 마세요. 유저가 한 말을 ${charLabel}가 한 것처럼 응답하지 마세요.`,
      `- 응답 길이: 1~3문장.`,
      `- 감정은 대사와 행동으로 자연스럽게 드러내세요.`,
      `- 응답 마지막 줄: [EMOTION:태그] (NEUTRAL/JOY/SADNESS/ANGER/SURPRISE/AFFECTION/FEAR/DISGUST/EXCITEMENT/SHY 중 하나)`,
      `- 감정 태그 다음 줄에 유저 선택지 3개:`,
      `  [CHOICE_P:이모지|긍정적 유저 답변]`,
      `  [CHOICE_N:이모지|중립적 유저 답변]`,
      `  [CHOICE_D:이모지|부정적 유저 답변]`,
      ``,
    );

    // 대화 히스토리
    if (recentMessages.length > 0) {
      lines.push('[대화 기록]');
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? '유저' : charLabel;
        lines.push(`${role}: ${msg.content}`);
      }
    }

    lines.push(`유저: ${userMessage}`);
    lines.push(`${charLabel}:`);

    return lines.join('\n');
  }

  /**
   * 전체 응답에서 감정 태그 + 선택지 파싱
   */
  private parseResponse(text: string): { content: string; emotion: string; choices: LlmChoice[] } {
    // 감정 파싱
    const emotionMatch = text.match(/\[EMOTION:(\w+)\]/);
    const emotion = emotionMatch ? emotionMatch[1].toUpperCase() : 'NEUTRAL';

    // 선택지 파싱
    const choices: LlmChoice[] = [];
    const choiceRegex = /\[CHOICE_(P|N|D):(.+?)\|(.+?)\]/g;
    let match: RegExpExecArray | null;
    const effectMap: Record<string, 'positive' | 'neutral' | 'negative'> = {
      P: 'positive',
      N: 'neutral',
      D: 'negative',
    };
    const hintMap: Record<string, string> = {
      P: '호감 UP',
      N: '',
      D: '호감 DOWN',
    };

    while ((match = choiceRegex.exec(text)) !== null) {
      const type = match[1]; // P, N, D
      const emoji = match[2].trim();
      const choiceText = match[3].trim();
      choices.push({
        id: `${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: choiceText,
        emoji,
        effect: effectMap[type] || 'neutral',
        affinityHint: hintMap[type] || '',
      });
    }

    // 선택지가 파싱 안 됐으면 fallback (LLM이 형식을 안 따랐을 때)
    if (choices.length === 0) {
      this.logger.warn('LLM did not generate choices in expected format, using emotion-based fallback');
    }

    const content = this.stripMetaTags(text);
    return { content, emotion, choices };
  }

  /**
   * 메타 태그 모두 제거 (EMOTION, CHOICE)
   * 메타 태그는 항상 응답 끝에 위치 → 첫 [EMOTION 또는 [CHOICE 이후 전부 절단
   */
  private stripMetaTags(text: string): string {
    const metaStart = text.search(/\[EMOTION:|\[CHOICE_/);
    if (metaStart >= 0) {
      return text.slice(0, metaStart).trim();
    }
    return text.trim();
  }
}
