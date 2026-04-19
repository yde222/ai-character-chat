#!/usr/bin/env node
/**
 * Railway 통합 스타터 — Gateway + Chat Service를 단일 프로세스에서 기동
 *
 * Railway는 하나의 서비스당 하나의 프로세스만 실행하므로,
 * child_process.fork로 Chat Service(gRPC)를 띄우고
 * API Gateway(HTTP)를 메인 프로세스에서 실행합니다.
 *
 * Stage 1 (DAU < 100) 전용. Stage 3에서 서비스 분리 예정.
 */
const { fork } = require('child_process');
const path = require('path');

console.log('🚀 Railway Unified Starter');
console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`   DB_TYPE: ${process.env.DB_TYPE || 'sqljs'}`);

// 1. Chat Service (gRPC) — 자식 프로세스
const chatService = fork(
  path.join(__dirname, '..', 'dist', 'apps', 'chat-service', 'main.js'),
  [],
  {
    env: {
      ...process.env,
      CHAT_SERVICE_URL: '0.0.0.0:50051',
    },
    stdio: 'inherit',
  }
);

chatService.on('error', (err) => {
  console.error('❌ Chat Service error:', err.message);
});

chatService.on('exit', (code) => {
  console.error(`⚠️ Chat Service exited with code ${code}`);
  if (code !== 0) {
    console.log('🔄 Restarting Chat Service in 3s...');
    setTimeout(() => {
      process.exit(1); // Railway will restart the whole container
    }, 3000);
  }
});

// 2. API Gateway (HTTP) — 메인 프로세스, 2초 후 시작 (gRPC 서버 대기)
setTimeout(() => {
  console.log('🌐 Starting API Gateway...');
  require(path.join(__dirname, '..', 'dist', 'apps', 'api-gateway', 'main.js'));
}, 2000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down...');
  chatService.kill('SIGTERM');
  setTimeout(() => process.exit(0), 5000);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down...');
  chatService.kill('SIGINT');
  setTimeout(() => process.exit(0), 5000);
});
