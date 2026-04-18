# AI Character Chat Platform

NestJS 모노레포 기반 AI 캐릭터 채팅 플랫폼.  
Gemini 2.5 Pro + Claude Sonnet 4 이중 LLM, WebSocket 실시간 스트리밍, 3-Tier 컨텍스트 관리.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   Chat UI        │────▶│  API Gateway      │
│  (Socket.IO)     │◀────│  :3000 (HTTP/WS)  │
└─────────────────┘     └────────┬─────────┘
                                 │ gRPC
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
            ┌──────────┐ ┌──────────┐ ┌──────────┐
            │  Chat     │ │  Image   │ │  Event   │
            │  Service  │ │  Service │ │  Service │
            │  :50051   │ │  :50052  │ │  :3002   │
            └─────┬────┘ └──────────┘ └─────┬────┘
                  │                         │
            ┌─────▼────┐              ┌─────▼────┐
            │ PostgreSQL│              │ PostgreSQL│
            │ + Redis   │              │          │
            └──────────┘              └──────────┘
```

## Tech Stack

| 레이어 | 기술 |
|--------|------|
| Gateway | NestJS, Socket.IO, Passport JWT |
| Chat Service | NestJS, gRPC, Gemini SDK, Anthropic SDK |
| Image Service | NestJS, gRPC, 감정 태그 매칭 |
| Event Service | NestJS, 출석/뱃지 시스템 |
| Database | PostgreSQL 16 (prod) / sql.js (dev) |
| Cache | Redis 7 + cache-manager |
| Infra | Docker Compose, K8s manifests |

## Quick Start

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env에 GEMINI_API_KEY 입력

# 3. 실행 (Docker PostgreSQL 자동 기동)
chmod +x scripts/dev-start.sh
./scripts/dev-start.sh

# 4. 브라우저에서 채팅 UI 열기
# ai-character-chat-ui.html 파일 열기
```

### Docker Compose (풀스택)

```bash
cd docker
docker compose up -d
```

## 핵심 설계

### 3-Tier Context Management

장기 대화 시 맥락 유실("감자 현상") 방어:

- **Tier 1**: 최근 5턴 원문 — 직전 대화 자연스러움 유지
- **Tier 2**: 증분 요약 — 10턴마다 자동 압축, DB 영속 저장
- **Tier 3**: 캐릭터 페르소나 — 시스템 프롬프트로 일관된 성격 유지

### Dual LLM with Circuit Breaker

- **Primary**: Gemini 2.5 Pro (비용 58% 절감, 1M 토큰 컨텍스트)
- **Fallback**: Claude Sonnet 4 (롤플레이 품질 최고)
- Circuit Breaker: 5회 실패 시 30초 차단 → 자동 복구

### Emotion-based Image Matching

LLM 응답에 `[EMOTION:JOY]` 태그 → 33개 프리로드 에셋에서 매칭 → 실시간 캐릭터 표정 전달

## Project Structure

```
├── apps/
│   ├── api-gateway/      # HTTP + WebSocket 진입점
│   ├── chat-service/     # LLM 연동 + 컨텍스트 관리
│   ├── image-service/    # 감정 이미지 매칭
│   └── event-service/    # 출석 + 뱃지
├── libs/
│   ├── common/           # 공유 인터페이스, 상수, 유틸
│   ├── database/         # TypeORM 엔티티 + DB 모듈
│   └── proto/            # gRPC .proto 정의
├── docker/               # Dockerfile + docker-compose
├── k8s/                  # Kubernetes manifests
└── scripts/              # dev-start.sh, e2e-test.js
```

## E2E Test

```bash
node scripts/e2e-test.js
```

16건 테스트: Gateway health, readiness, 출석 체크, 연속 기록, WebSocket 연결, 세션 생성, 메시지 전송.

## Environment Variables

| 변수 | 필수 | 설명 |
|------|------|------|
| `GEMINI_API_KEY` | ✅ | Google Gemini API 키 |
| `ANTHROPIC_API_KEY` | - | Claude 폴백용 (선택) |
| `DB_TYPE` | - | `postgres` 시 PostgreSQL, 미설정 시 sql.js |
| `REDIS_HOST` | - | Redis 호스트 (미설정 시 인메모리 캐시) |
| `JWT_SECRET` | ✅ | JWT 서명 키 |

전체 변수 목록: `.env.example` 참조.

## License

MIT
