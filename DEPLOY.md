# 배포 가이드 — Docker 없이 배포

## 프론트엔드: Vercel

1. [vercel.com](https://vercel.com) 접속 → GitHub 연동
2. `ai-chat-frontend` 리포 선택
3. Framework: Next.js (자동 감지)
4. 환경변수 설정:

```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXTAUTH_URL=https://your-frontend.vercel.app
NEXTAUTH_SECRET=your-secret-key-here
```

5. Deploy 클릭 → 완료

## 백엔드: Railway

1. [railway.app](https://railway.app) 접속 → GitHub 연동
2. `NewSphere` 리포 선택 → Root Directory: `ai-character-chat`
3. 환경변수 설정:

```
NODE_ENV=production
DB_TYPE=sqljs
GATEWAY_PORT=3000
GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-anthropic-key
JWT_SECRET=your-jwt-secret
CORS_ORIGIN=https://your-frontend.vercel.app
```

4. Railway가 `railway.toml`을 자동 감지 → 빌드+배포

## Stage별 환경변수 변경

### Stage 2 (Supabase 전환 시)
```
DB_TYPE=postgres
DB_HOST=your-supabase-host.supabase.co
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-supabase-password
DB_DATABASE=postgres
```

### Stage 2 (Upstash Redis 추가 시)
```
REDIS_URL=redis://default:password@your-upstash.upstash.io:6379
```

## 헬스체크

배포 후 확인:
```
curl https://your-backend.railway.app/health
```
