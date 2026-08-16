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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasPlacesKey: Boolean(process.env.GOOGLE_API_KEY),
    hasClaudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
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
