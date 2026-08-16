import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachUser, syncAdmin, USER_COLORS } from './src/auth.js'
import { db, loadData, save, withData } from './src/db.js'
import { getAreas, getCategories, seedAreas, seedCategories } from './src/meta.js'
import { pruneLegacyFields } from './src/placeModel.js'
import adminRoutes from './src/routes/admin.js'
import authRoutes from './src/routes/auth.js'
import photoRoutes from './src/routes/photo.js'
import placeRoutes from './src/routes/places.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
// Railway 등 리버스 프록시 뒤에서 프로토콜·IP 를 올바르게 인식한다
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))
// 저장소를 먼저 읽어야 attachUser 가 세션을 확인할 수 있다
app.use(withData)
app.use(attachUser)

const REQUIRED_ENV = [
  'SESSION_SECRET',
  'ADMIN_NICKNAME',
  'GOOGLE_API_KEY',
  'GOOGLE_MAPS_BROWSER_KEY',
]

// 이름을 잘못 지은 환경변수를 찾아준다.
// 단어 구성이 같으면(SECRET_SESSION ↔ SESSION_SECRET) 오타로 본다.
const wordKey = (name) =>
  name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('_')

function misnamedEnv(missing) {
  const found = {}
  for (const want of missing) {
    const target = wordKey(want)
    const hit = Object.keys(process.env).find((name) => name !== want && wordKey(name) === target)
    if (hit) found[want] = hit
  }
  return found
}

// 설정이 제대로 들어갔는지 확인하는 용도. 값 자체는 노출하지 않는다.
app.get('/api/health', (req, res) => {
  const users = db().users
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim())
  const misnamed = misnamedEnv(missing)

  res.json({
    ok: missing.length === 0,
    // 빠진 환경변수와, 비슷한 이름으로 잘못 들어간 것
    missingEnv: missing,
    misnamedEnv: misnamed,
    hint: missing.length
      ? Object.keys(misnamed).length
        ? `이름이 잘못됐습니다: ${Object.entries(misnamed)
            .map(([want, got]) => `${got} → ${want}`)
            .join(', ')}`
        : '환경변수를 추가한 뒤 반드시 Redeploy 해야 반영됩니다.'
      : '설정 정상',

    hasPlacesKey: Boolean(process.env.GOOGLE_API_KEY),
    hasMapsKey: Boolean(process.env.GOOGLE_MAPS_BROWSER_KEY),
    hasClaudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasSessionSecret: Boolean(process.env.SESSION_SECRET),
    // 관리자 승격이 안 될 때 원인을 좁히기 위한 정보
    hasAdminNickname: Boolean(process.env.ADMIN_NICKNAME?.trim()),
    adminNicknameMatchesAUser: Boolean(
      process.env.ADMIN_NICKNAME &&
        users.some((u) => u.nickname === process.env.ADMIN_NICKNAME.normalize('NFC').trim())
    ),
    userCount: users.length,
    adminCount: users.filter((u) => u.role === 'admin').length,
    storage: process.env.KV_REST_API_URL ? 'redis' : 'file',
    // 어느 배포를 보고 있는지 (Production 이 아니면 환경변수가 다를 수 있다)
    vercelEnv: process.env.VERCEL_ENV ?? null,
  })
})

// 프론트가 필요로 하는 상수 + 지도 키
app.get('/api/config', (req, res) => {
  res.json({
    categories: getCategories(),
    areas: getAreas(),
    colors: USER_COLORS,
    mapsApiKey: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_API_KEY || null,
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/places', placeRoutes)
app.use('/api/photo', photoRoutes)

app.use(express.static(path.join(__dirname, 'public')))

// 클라이언트 라우팅(/place/:id 등)은 전부 index.html 로
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const PORT = process.env.PORT || 3100

// 첫 부팅 정리 — 카테고리·지역 seed, 예전 레코드 정리, 관리자 승격.
// 서버리스에서도 콜드 스타트마다 한 번씩 안전하게 돌 수 있도록 함수로 감싼다.
let bootstrapped = null
export function bootstrap() {
  if (!bootstrapped) {
    bootstrapped = (async () => {
      await loadData({ force: true })

      const seeded = await seedCategories()
      if (seeded) console.log(`[migrate] 카테고리 목록 ${seeded === 'seeded' ? '생성' : '보정'}`)
      const seededAreas = await seedAreas()
      if (seededAreas) console.log(`[migrate] 지역 목록 ${seededAreas === 'seeded' ? '생성' : '보정'}`)

      // 예전 형식(리뷰·사진 여러 장·영업시간)으로 저장된 레코드를 한 번 정리한다
      const pruned = db().places.filter(pruneLegacyFields).length
      if (pruned) {
        await save(['places'])
        console.log(`[migrate] ${pruned}곳의 사용하지 않는 필드를 정리했습니다`)
      }

      await syncAdmin()
    })()
  }
  return bootstrapped
}

export default app

// 직접 실행할 때만 서버를 띄운다 (Vercel 에서는 api/index.js 가 app 을 가져다 쓴다)
if (!process.env.VERCEL) {
  await bootstrap()
  app.listen(PORT, () => {
    console.log(`osaka-travel-buddy → http://localhost:${PORT}`)
  })
}
