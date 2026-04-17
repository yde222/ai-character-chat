import { Injectable, Logger } from '@nestjs/common';

/**
 * Badge Service — 업적 시스템 (Phase 2 본격 구현)
 *
 * Phase 2 이벤트 소싱 구조:
 *
 * [Kafka Consumer]
 *   ↓ chat.message.sent
 *   ↓ user.attendance.checked
 *   ↓ payment.completed
 *   ↓
 * [Badge Evaluator] → 조건 체크 → [Badge Store] → [Notification Trigger]
 *
 * 이벤트 소싱이 왜 맞는 구조인가:
 * 1. 이벤트 리플레이 가능 → "지난 달 배지 조건을 소급 적용" 가능
 * 2. 이벤트 순서 보장 → "첫 번째 메시지" 같은 조건 정확히 판정
 * 3. 감사 로그 자동 확보 → 유저 CS "왜 배지가 안 주어졌는가" 대응
 */

interface Badge {
  badgeId: string;
  name: string;
  description: string;
  condition: string;
  iconUrl: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  // Phase 2: 배지 정의 + 평가 로직
  private badges: Badge[] = [
    {
      badgeId: 'first_chat',
      name: '첫 대화',
      description: '처음으로 AI 캐릭터와 대화를 나눴어요',
      condition: 'message_count >= 1',
      iconUrl: '/badges/first_chat.webp',
      rarity: 'common',
    },
    {
      badgeId: 'streak_7',
      name: '일주일 개근',
      description: '7일 연속 접속했어요',
      condition: 'streak >= 7',
      iconUrl: '/badges/streak_7.webp',
      rarity: 'rare',
    },
    {
      badgeId: 'streak_30',
      name: '한 달 개근',
      description: '30일 연속 접속했어요',
      condition: 'streak >= 30',
      iconUrl: '/badges/streak_30.webp',
      rarity: 'epic',
    },
    {
      badgeId: 'chat_1000',
      name: '수다쟁이',
      description: '1000번째 메시지를 보냈어요',
      condition: 'message_count >= 1000',
      iconUrl: '/badges/chat_1000.webp',
      rarity: 'legendary',
    },
  ];

  getBadgeDefinitions(): Badge[] {
    return this.badges;
  }
}
