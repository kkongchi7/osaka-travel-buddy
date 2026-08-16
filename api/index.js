// Vercel 진입점 — Express 앱을 서버리스 함수로 감싼다.
// vercel.json 이 /api/* 를 제외한 모든 경로를 여기로 보낸다.

import app, { bootstrap } from '../server.js'

export default async function handler(req, res) {
  // 콜드 스타트마다 한 번만 실행된다 (내부에서 캐시)
  await bootstrap()
  return app(req, res)
}
