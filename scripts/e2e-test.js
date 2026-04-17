#!/usr/bin/env node
/**
 * AI Character Chat — E2E 테스트 클라이언트
 *
 * WebSocket 전체 플로우 검증:
 * 1. Gateway HTTP health check
 * 2. Event Service 출석 체크 API
 * 3. WebSocket 연결 → join_session → send_message → chat_chunk 수신
 *
 * 사용법:
 *   node scripts/e2e-test.js
 *
 * 전제조건:
 *   - 4개 서비스가 실행 중이어야 함 (./scripts/dev-start.sh)
 */

const http = require('http');

const GATEWAY_URL = 'http://localhost:3000';
const EVENT_URL = 'http://localhost:3002';

// ── 유틸 ─────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── 테스트 러너 ──────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} ${detail ? '— ' + detail : ''}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 테스트 시작 ──────────────────────────────────────────
async function main() {
  console.log('');
  console.log('🧪 AI Character Chat — E2E 테스트');
  console.log('================================================');

  // ── Test 1: Gateway Health ───────────────────────────
  console.log('');
  console.log('📡 Test 1: API Gateway Health Check');
  try {
    const health = await httpGet(`${GATEWAY_URL}/health`);
    assert('GET /health 응답 200', health.status === 200);
    assert('status === "ok"', health.body.status === 'ok');
    assert('uptime 존재', typeof health.body.uptime === 'number');
  } catch (err) {
    assert('Gateway 연결', false, err.message);
    console.log('\n❌ Gateway가 실행 중이 아닙니다. ./scripts/dev-start.sh 를 먼저 실행하세요.');
    process.exit(1);
  }

  // ── Test 2: Health Ready ─────────────────────────────
  console.log('');
  console.log('📡 Test 2: Gateway Readiness Check');
  try {
    const ready = await httpGet(`${GATEWAY_URL}/health/ready`);
    assert('GET /health/ready 응답 200', ready.status === 200);
  } catch (err) {
    assert('Readiness 체크', false, err.message);
  }

  // ── Test 3: Event Service 출석 체크 ──────────────────
  console.log('');
  console.log('🏆 Test 3: Event Service — 출석 체크');
  try {
    const attendance = await httpPost(`${EVENT_URL}/attendance/e2e-test-user/check`);
    assert('POST /attendance/:userId/check 응답 201', attendance.status === 201);
    assert('streak >= 1', attendance.body.streak >= 1);
    assert('bonusMessages 필드 존재', typeof attendance.body.bonusMessages === 'number');
  } catch (err) {
    assert('Event Service 연결', false, err.message);
  }

  // ── Test 4: 출석 연속 기록 조회 ──────────────────────
  console.log('');
  console.log('🏆 Test 4: Event Service — 연속 기록 조회');
  try {
    const streak = await httpGet(`${EVENT_URL}/attendance/e2e-test-user/streak`);
    assert('GET /attendance/:userId/streak 응답 200', streak.status === 200);
    assert('currentStreak >= 1', streak.body.currentStreak >= 1);
    assert('totalDays >= 1', streak.body.totalDays >= 1);
    assert('lastCheckDate 존재', typeof streak.body.lastCheckDate === 'string');
  } catch (err) {
    assert('Streak 조회', false, err.message);
  }

  // ── Test 5: WebSocket 연결 ───────────────────────────
  console.log('');
  console.log('💬 Test 5: WebSocket 연결 (Socket.IO)');
  try {
    // socket.io-client가 없으면 순수 HTTP로 폴링 테스트
    let io;
    try {
      io = require('socket.io-client');
    } catch {
      console.log('  ⚠️  socket.io-client 미설치 — WebSocket 테스트 스킵');
      console.log('     npm install -D socket.io-client 후 재실행');
      assert('socket.io-client 로드', false, 'npm install -D socket.io-client 필요');
      printSummary();
      return;
    }

    const socket = io(`${GATEWAY_URL}/chat`, {
      transports: ['websocket'],
      auth: { token: 'test-token' }, // WsJwtGuard 바이패스 (dev 모드)
    });

    // 연결 테스트
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket 연결 타임아웃 (3초)'));
      }, 3000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        assert('WebSocket 연결 성공', true);
        resolve();
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // ── Test 6: join_session ───────────────────────────
    console.log('');
    console.log('💬 Test 6: join_session 이벤트');

    const sessionResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('join_session 타임아웃 (5초)'));
      }, 5000);

      socket.on('session_joined', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        // 에러도 정상 — gRPC 연결이 안 되면 에러 반환
        resolve({ error: err });
      });

      socket.emit('join_session', {
        userId: 'e2e-test-user',
        characterId: 'test-character-001',
      });
    });

    if (sessionResult.error) {
      assert('join_session 응답', false, `에러: ${JSON.stringify(sessionResult.error)}`);
      console.log('  ℹ️  gRPC 서비스 연결 이슈일 수 있음 (Chat Service 확인)');
    } else {
      assert('session_joined 이벤트 수신', true);
      assert('sessionId 존재', typeof sessionResult.sessionId === 'string');
    }

    // ── Test 7: send_message ──────────────────────────
    console.log('');
    console.log('💬 Test 7: send_message 이벤트');

    const messageResult = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ timeout: true });
      }, 8000);

      const chunks = [];

      socket.on('chat_chunk', (data) => {
        chunks.push(data);
        if (data.isFinal) {
          clearTimeout(timeout);
          resolve({ chunks });
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ error: err });
      });

      socket.emit('send_message', { message: '안녕! 오늘 기분이 어때?' });
    });

    if (messageResult.timeout) {
      assert('send_message 응답', false, '타임아웃 (8초) — LLM API 키 미설정일 수 있음');
      console.log('  ℹ️  GEMINI_API_KEY 또는 ANTHROPIC_API_KEY가 .env에 설정되어 있는지 확인');
    } else if (messageResult.error) {
      assert('send_message 응답', false, `에러: ${JSON.stringify(messageResult.error)}`);
    } else {
      assert('chat_chunk 이벤트 수신', messageResult.chunks.length > 0);
      assert(
        `총 ${messageResult.chunks.length}개 청크 수신`,
        messageResult.chunks.length >= 1,
      );
      const finalChunk = messageResult.chunks.find((c) => c.isFinal);
      assert('isFinal=true 청크 존재', !!finalChunk);
    }

    socket.disconnect();
    assert('WebSocket 정상 종료', true);
  } catch (err) {
    assert('WebSocket 테스트', false, err.message);
  }

  printSummary();
}

function printSummary() {
  console.log('');
  console.log('================================================');
  console.log(`🧪 테스트 결과: ${passed} passed, ${failed} failed (총 ${passed + failed}건)`);
  console.log('================================================');

  if (failed === 0) {
    console.log('🎉 전체 통과! E2E 플로우 정상 동작.');
  } else {
    console.log(`⚠️  ${failed}건 실패. 위 로그를 확인하세요.`);
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('테스트 실행 중 예외:', err);
  process.exit(1);
});
