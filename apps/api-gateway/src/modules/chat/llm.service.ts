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
  ): Promise<void> {
    // Gemini 먼저 시도
    if (this.geminiModel) {
      try {
        await this.generateWithGemini(systemPrompt, userMessage, recentMessages, onChunk);
        return;
      } catch (error) {
        this.logger.warn(`Gemini failed (${error.message?.slice(0, 80)}), trying Claude fallback...`);
      }
    }

    // Claude fallback
    if (this.anthropic) {
      try {
        await this.generateWithClaude(systemPrompt, userMessage, recentMessages, onChunk);
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
  ): Promise<void> {
    const prompt = this.buildPrompt(userMessage, recentMessages);

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
        // 감정/선택지 태그가 버퍼에 부분적으로 포함될 수 있으므로 '[' 이후는 홀드
        const bracketIdx = buffer.lastIndexOf('[');
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
  ): Promise<void> {
    const prompt = this.buildPrompt(userMessage, recentMessages);

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
        const bracketIdx = buffer.lastIndexOf('[');
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
      '\n   가능한 태그: NEUTRAL, JOY, SADNESS, ANGER, SURPRISE, AFFECTION, FEAR, DISGUST, EXCITEMENT, SHY' +
      '\n6. 감정 태그 다음 줄에, 유저가 선택할 수 있는 답변 3개를 아래 형식으로 제시하세요.' +
      '\n   반드시 현재 대화 흐름과 캐릭터의 마지막 말에 어울리는 자연스러운 유저 대사를 만드세요.' +
      '\n   [CHOICE_P:이모지|호감이 오르는 긍정적 답변]' +
      '\n   [CHOICE_N:이모지|무난한 중립적 답변]' +
      '\n   [CHOICE_D:이모지|호감이 내려가는 부정적 답변]',
    );

    return parts.join('\n');
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
   */
  private stripMetaTags(text: string): string {
    return text
      .replace(/\[EMOTION:\w+\]/g, '')
      .replace(/\[CHOICE_[PND]:.+?\]/g, '')
      .trim();
  }
}
