import { Injectable, Logger } from '@nestjs/common';

/**
 * Narrative Engine Service — 소설형 내러티브 + 대화 하이브리드 생성
 *
 * ============================================================
 * 11순위: 스토리 모드 엔진
 *
 * 경쟁사 분석 (BagelChat, Whif.io):
 * - 3인칭 서술체로 상황 묘사 + 대사 버블 혼합
 * - 유저도 *지문*과 "대사"를 구분하여 입력
 * - 인라인 이미지 삽입 트리거
 *
 * 기술 설계:
 * 1. LLM에 "내러티브 모드" 시스템 프롬프트 주입
 * 2. 응답을 파싱하여 narrative/dialogue/action 블록으로 분리
 * 3. 프론트엔드가 각 블록을 다른 스타일로 렌더링
 *
 * 출력 포맷:
 * [narrative] 서은결은 천천히 고개를 들었다. 창백한 얼굴에 비친 달빛이...
 * [dialogue:서은결] "...당신은 누구죠?"
 * [action] 서은결이 손을 뻗어 당신의 팔목을 잡았다.
 * [dialogue:서은결] "왜 여기 있는 거예요?"
 * [image_trigger:tension_high]
 *
 * 비용 영향:
 * - 내러티브 모드 프롬프트: ~150 토큰 추가
 * - 응답 길이 증가: 채팅 대비 1.5~2배 (서술 포함)
 * - 총 비용 증가: ~40% (서술 길이 증가분)
 * - 그러나 유저 체감 품질은 3배 이상 (소설 읽는 경험)
 * ============================================================
 */

// 파싱된 내러티브 블록 타입
export interface NarrativeBlock {
  type: 'narrative' | 'dialogue' | 'action' | 'image_trigger';
  content: string;
  speaker?: string;         // dialogue일 때 화자
  imageTag?: string;        // image_trigger일 때 태그
}

// 유저 입력 파싱 결과
export interface UserInputParsed {
  dialogue: string | null;  // "대사" 부분
  action: string | null;    // *지문* 부분
  raw: string;              // 원본
}

@Injectable()
export class NarrativeEngineService {
  private readonly logger = new Logger(NarrativeEngineService.name);

  /**
   * 내러티브 모드 시스템 프롬프트 생성
   *
   * 이 프롬프트가 LLM에게 소설체 출력을 지시합니다.
   * 핵심: 포맷 태그를 명확히 지정하여 파싱 가능하게 만듦.
   */
  buildNarrativeSystemPrompt(
    characterName: string,
    userName: string,
    userGender: string,
    userSettings: string | null,
  ): string {
    const genderText = userGender === 'male' ? '남성' : userGender === 'female' ? '여성' : '';
    const userDesc = userSettings
      ? `\n\n[${userName}의 설정]\n${userSettings}`
      : '';

    return `
## 내러티브 모드 — 소설형 대화

당신은 인터랙티브 소설의 서술자이자 ${characterName}입니다.
상대방의 이름은 "${userName}"입니다.${genderText ? ` (${genderText})` : ''}${userDesc}

### 출력 규칙

1. **서술체와 대사를 혼합**하여 소설처럼 작성하세요.
2. 반드시 아래 태그 포맷으로 출력하세요:

\`[narrative]\` 3인칭 서술 (상황, 감정, 외모, 행동 묘사)
\`[dialogue:캐릭터명]\` 캐릭터의 대사 (따옴표 없이)
\`[action]\` 캐릭터의 의미 있는 행동 묘사
\`[image_trigger:태그]\` 분위기 전환 시 이미지 삽입 힌트

3. 서술에서 ${userName}을(를) 2인칭("당신", "너")으로 지칭하세요.
4. ${characterName}의 내면 심리도 서술에 포함하되, 과하지 않게.
5. 한 응답에 서술 2~4문단 + 대사 1~3개가 적절합니다.
6. ${userName}의 행동을 임의로 결정하지 마세요. 선택은 유저에게.

### 출력 예시

[narrative] ${characterName}은(는) 천천히 눈을 떴다. 흐릿한 시야에 낯선 천장이 보였다. 어디서 맡아본 듯한 향기가 코끝을 스쳤다.
[action] ${characterName}이(가) 고개를 돌려 당신을 바라보았다.
[dialogue:${characterName}] ...당신은 누구죠?
[narrative] ${characterName}의 목소리가 떨리고 있었다. 경계와 두려움이 뒤섞인 눈동자가 당신을 향했다.
`;
  }

  /**
   * 유저 입력 파싱 — 대사와 지문 분리
   *
   * Whif.io 스타일:
   * - "큰따옴표" → 대사
   * - *별표* → 지문/행동
   * - 그 외 → 대사로 취급 (편의성)
   */
  parseUserInput(input: string): UserInputParsed {
    const dialogueMatch = input.match(/"([^"]+)"/);
    const actionMatch = input.match(/\*([^*]+)\*/);

    // 둘 다 있으면 분리
    if (dialogueMatch && actionMatch) {
      return {
        dialogue: dialogueMatch[1],
        action: actionMatch[1],
        raw: input,
      };
    }

    // 지문만 있으면 (* ... *)
    if (actionMatch && !dialogueMatch) {
      return {
        dialogue: null,
        action: actionMatch[1],
        raw: input,
      };
    }

    // 대사만 있거나 일반 텍스트 → 대사로 취급
    return {
      dialogue: dialogueMatch ? dialogueMatch[1] : input,
      action: null,
      raw: input,
    };
  }

  /**
   * 유저 입력을 LLM용 프롬프트로 변환
   *
   * 지문과 대사를 구분하여 LLM이 문맥을 정확히 이해하도록 포맷팅
   */
  formatUserInputForLLM(parsed: UserInputParsed, userName: string): string {
    const parts: string[] = [];

    if (parsed.action) {
      parts.push(`[action] ${userName}이(가) ${parsed.action}`);
    }
    if (parsed.dialogue) {
      parts.push(`[dialogue:${userName}] ${parsed.dialogue}`);
    }

    return parts.length > 0 ? parts.join('\n') : parsed.raw;
  }

  /**
   * LLM 응답 파싱 — 태그 기반 블록 분리
   *
   * [narrative], [dialogue:name], [action], [image_trigger:tag]
   * 태그가 없는 텍스트는 narrative로 처리 (폴백)
   */
  parseNarrativeResponse(response: string): NarrativeBlock[] {
    const blocks: NarrativeBlock[] = [];
    const lines = response.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      const trimmed = line.trim();

      // [dialogue:캐릭터명] 대사
      const dialogueMatch = trimmed.match(
        /^\[dialogue:([^\]]+)\]\s*(.+)/,
      );
      if (dialogueMatch) {
        blocks.push({
          type: 'dialogue',
          content: dialogueMatch[2].trim(),
          speaker: dialogueMatch[1].trim(),
        });
        continue;
      }

      // [action] 행동
      const actionMatch = trimmed.match(/^\[action\]\s*(.+)/);
      if (actionMatch) {
        blocks.push({
          type: 'action',
          content: actionMatch[1].trim(),
        });
        continue;
      }

      // [image_trigger:태그]
      const imageMatch = trimmed.match(
        /^\[image_trigger:([^\]]+)\]/,
      );
      if (imageMatch) {
        blocks.push({
          type: 'image_trigger',
          content: '',
          imageTag: imageMatch[1].trim(),
        });
        continue;
      }

      // [narrative] 서술
      const narrativeMatch = trimmed.match(/^\[narrative\]\s*(.+)/);
      if (narrativeMatch) {
        blocks.push({
          type: 'narrative',
          content: narrativeMatch[1].trim(),
        });
        continue;
      }

      // 태그 없는 텍스트 → narrative 폴백
      if (trimmed.length > 0) {
        // 이전 블록이 narrative면 합치기
        if (blocks.length > 0 && blocks[blocks.length - 1].type === 'narrative') {
          blocks[blocks.length - 1].content += '\n' + trimmed;
        } else {
          blocks.push({
            type: 'narrative',
            content: trimmed,
          });
        }
      }
    }

    // 최소 검증: 빈 결과면 원본을 narrative로
    if (blocks.length === 0 && response.trim()) {
      blocks.push({
        type: 'narrative',
        content: response.trim(),
      });
    }

    return blocks;
  }

  /**
   * 프롤로그 블록 생성
   *
   * 캐릭터의 프롤로그 텍스트를 NarrativeBlock 배열로 변환.
   * 채팅 시작 시 첫 화면에 표시됨.
   */
  parsePrologue(prologueText: string): NarrativeBlock[] {
    if (!prologueText) return [];

    // 프롤로그는 대부분 서술체 — 따옴표 안의 텍스트만 dialogue로 분리
    const blocks: NarrativeBlock[] = [];
    const paragraphs = prologueText.split('\n\n').filter((p) => p.trim());

    for (const para of paragraphs) {
      // "대사" 패턴이 있으면 분리
      const quoteMatch = para.match(/^"(.+)"$/);
      if (quoteMatch) {
        blocks.push({
          type: 'dialogue',
          content: quoteMatch[1],
          speaker: undefined, // 프롤로그에서는 화자 미지정
        });
      } else {
        blocks.push({
          type: 'narrative',
          content: para.trim(),
        });
      }
    }

    return blocks;
  }

  /**
   * 내러티브 블록 → 저장용 plain text 변환
   *
   * DB에 저장할 때는 태그 포함 원본으로 저장.
   * 컨텍스트 요약 시에는 plain text로 변환.
   */
  blocksToPlainText(blocks: NarrativeBlock[]): string {
    return blocks
      .map((b) => {
        switch (b.type) {
          case 'dialogue':
            return `${b.speaker || '?'}: "${b.content}"`;
          case 'action':
            return `*${b.content}*`;
          case 'narrative':
            return b.content;
          case 'image_trigger':
            return '';
          default:
            return b.content;
        }
      })
      .filter((t) => t.length > 0)
      .join('\n');
  }

  /**
   * 내러티브 블록 → 태그 포맷 문자열 (DB 저장용)
   */
  blocksToTaggedText(blocks: NarrativeBlock[]): string {
    return blocks
      .map((b) => {
        switch (b.type) {
          case 'dialogue':
            return `[dialogue:${b.speaker || '?'}] ${b.content}`;
          case 'action':
            return `[action] ${b.content}`;
          case 'narrative':
            return `[narrative] ${b.content}`;
          case 'image_trigger':
            return `[image_trigger:${b.imageTag}]`;
          default:
            return b.content;
        }
      })
      .join('\n');
  }
}
