#!/bin/bash
# ============================================================
# Fly.io 전체 배포 스크립트
#
# 사전 준비:
#   1. flyctl auth login
#   2. .env.fly 파일에 시크릿 값 입력 (아래 템플릿 참고)
#   3. 이 스크립트 실행: ./fly/deploy.sh
# ============================================================

set -e

FLY="flyctl"
REGION="nrt"  # 도쿄 (한국에서 가장 가까운 Fly 리전)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🚀 AI Character Chat — Fly.io 배포 시작"
echo "============================================"

# ── 로그인 확인 ───────────────────────────────────────────
if ! $FLY auth whoami &>/dev/null; then
  echo "❌ Fly.io 로그인 필요: flyctl auth login"
  exit 1
fi
echo "✅ 로그인: $($FLY auth whoami)"

# ── 시크릿 파일 확인 ──────────────────────────────────────
if [ ! -f "$ROOT/.env.fly" ]; then
  cat > "$ROOT/.env.fly.example" << 'EOF'
# Fly.io 시크릿 — 실제 값으로 채운 뒤 .env.fly로 저장

# Neon PostgreSQL (https://console.neon.tech)
DATABASE_URL=postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/ai_character_chat?sslmode=require

# Upstash Redis (https://console.upstash.com)
REDIS_HOST=xxx.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=xxxxx

# JWT
JWT_SECRET=your-strong-secret-here

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_CALLBACK_URL=https://ai-char-api-gateway.fly.dev/auth/google/callback

# Kakao OAuth
KAKAO_CLIENT_ID=xxx
KAKAO_CLIENT_SECRET=xxx
KAKAO_CALLBACK_URL=https://ai-char-api-gateway.fly.dev/auth/kakao/callback

# Frontend URL
CLIENT_REDIRECT_URL=https://your-frontend.vercel.app

# LLM Keys
GEMINI_API_KEY=AIzaSy-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
EOF
  echo ""
  echo "⚠️  .env.fly 파일이 없습니다."
  echo "   .env.fly.example 을 참고해 .env.fly 를 생성하세요."
  echo ""
  echo "   cp .env.fly.example .env.fly"
  echo "   vim .env.fly  # 실제 값으로 수정"
  exit 1
fi

source "$ROOT/.env.fly"

# ── 앱 생성 함수 ──────────────────────────────────────────
create_app_if_needed() {
  local app=$1
  if ! $FLY apps list | grep -q "$app"; then
    echo "📦 앱 생성: $app"
    $FLY apps create "$app" --org personal
  else
    echo "✅ 앱 존재: $app"
  fi
}

# ── 시크릿 설정 함수 ──────────────────────────────────────
set_secrets() {
  local app=$1
  shift
  echo "🔑 시크릿 설정: $app"
  $FLY secrets set "$@" --app "$app" --stage
}

# ── Step 1: 앱 생성 ───────────────────────────────────────
echo ""
echo "📦 Step 1: Fly 앱 생성"
create_app_if_needed "ai-char-api-gateway"
create_app_if_needed "ai-char-chat"
create_app_if_needed "ai-char-image"
create_app_if_needed "ai-char-event"

# ── Step 2: 시크릿 설정 ───────────────────────────────────
echo ""
echo "🔑 Step 2: 시크릿 설정"

# chat-service
set_secrets "ai-char-chat" \
  DATABASE_URL="$DATABASE_URL" \
  REDIS_HOST="$REDIS_HOST" \
  REDIS_PORT="$REDIS_PORT" \
  REDIS_PASSWORD="$REDIS_PASSWORD" \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"

# image-service
set_secrets "ai-char-image" \
  DATABASE_URL="$DATABASE_URL" \
  REDIS_HOST="$REDIS_HOST" \
  REDIS_PORT="$REDIS_PORT" \
  REDIS_PASSWORD="$REDIS_PASSWORD"

# event-service
set_secrets "ai-char-event" \
  DATABASE_URL="$DATABASE_URL"

# api-gateway
set_secrets "ai-char-api-gateway" \
  DATABASE_URL="$DATABASE_URL" \
  REDIS_HOST="$REDIS_HOST" \
  REDIS_PORT="$REDIS_PORT" \
  REDIS_PASSWORD="$REDIS_PASSWORD" \
  JWT_SECRET="$JWT_SECRET" \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  GOOGLE_CALLBACK_URL="$GOOGLE_CALLBACK_URL" \
  KAKAO_CLIENT_ID="$KAKAO_CLIENT_ID" \
  KAKAO_CLIENT_SECRET="$KAKAO_CLIENT_SECRET" \
  KAKAO_CALLBACK_URL="$KAKAO_CALLBACK_URL" \
  CLIENT_REDIRECT_URL="$CLIENT_REDIRECT_URL"

# ── Step 3: 배포 (의존 순서대로) ──────────────────────────
echo ""
echo "🔥 Step 3: 서비스 배포"
cd "$ROOT"

echo "  → chat-service 배포..."
$FLY deploy --config fly/chat-service.toml --wait-timeout 300 --ha=false

echo "  → image-service 배포..."
$FLY deploy --config fly/image-service.toml --wait-timeout 300 --ha=false

echo "  → event-service 배포..."
$FLY deploy --config fly/event-service.toml --wait-timeout 300 --ha=false

echo "  → api-gateway 배포..."
$FLY deploy --config fly/api-gateway.toml --wait-timeout 300 --ha=false

# ── 완료 ──────────────────────────────────────────────────
echo ""
echo "============================================"
echo "✅ 전체 배포 완료!"
echo ""
echo "   🌐 API:     https://ai-char-api-gateway.fly.dev"
echo "   📖 Swagger: https://ai-char-api-gateway.fly.dev/docs"
echo "   ❤️  Health:  https://ai-char-api-gateway.fly.dev/health"
echo ""
echo "   로그 확인: flyctl logs --app ai-char-api-gateway"
echo "============================================"
