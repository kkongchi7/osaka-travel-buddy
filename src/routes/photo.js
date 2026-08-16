// 구글 사진 프록시 + 디스크 캐시
//
// 사진 URL 에는 API 키가 들어가므로 브라우저에 직접 노출할 수 없다.
// 첫 요청 때 받아서 data/photos 에 저장하고, 이후에는 파일에서 바로 준다.
// (구글 사진 참조는 만료되지 않지만, 매번 부르면 요금이 발생한다)

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireAuth } from '../auth.js'
import { db } from '../db.js'
import { fetchPhoto, placesAvailable } from '../places.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 서버리스는 파일시스템이 읽기 전용이라 디스크 캐시를 쓸 수 없다.
// 대신 아래 Cache-Control 로 CDN 과 브라우저가 캐시한다.
const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'photos')
let diskCache = true
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
} catch {
  diskCache = false
  console.log('[photo] 디스크 캐시 불가 — CDN 캐시만 사용합니다')
}

const router = express.Router()

// 같은 사진에 대한 동시 요청이 겹치면 한 번만 받아온다
const inFlight = new Map()

// 아직 저장되지 않은 등록 후보의 사진 (미리보기 전용).
// 저장된 장소가 아니라 사진 참조를 그대로 받으므로, 로그인 사용자에게만 열고
// 형식을 엄격히 검증한다. 캐시는 남기지 않는다.
const PHOTO_REF = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/

router.get('/preview', requireAuth, async (req, res) => {
  const ref = String(req.query.ref ?? '')
  if (!PHOTO_REF.test(ref)) return res.status(400).end()
  if (!placesAvailable()) return res.status(503).end()

  try {
    const { buffer, contentType } = await fetchPhoto(ref, Math.min(Number(req.query.w) || 300, 800))
    res.setHeader('Cache-Control', 'private, max-age=600')
    res.type(contentType).send(buffer)
  } catch (e) {
    console.warn('[photo] 미리보기 실패:', e.message)
    res.status(502).end()
  }
})

router.get('/:placeId', async (req, res) => {
  // 쓰레기통 목록에서도 썸네일이 보여야 하므로 양쪽에서 찾는다
  const place =
    db().places.find((p) => p.id === req.params.placeId) ??
    db().trash.find((p) => p.id === req.params.placeId)
  if (!place?.photo?.ref) return res.status(404).end()

  const photo = place.photo
  const width = Math.min(Number(req.query.w) || 600, 1200)
  const cacheKey = `${place.id}-${width}.jpg`
  const cachePath = path.join(CACHE_DIR, cacheKey)

  // 구글 사진은 바뀌지 않는다. 브라우저와 CDN 양쪽에 오래 캐시시켜 API 호출을 줄인다.
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable')

  if (diskCache && fs.existsSync(cachePath)) {
    return res.type('image/jpeg').send(await fs.promises.readFile(cachePath))
  }
  if (!placesAvailable()) return res.status(503).end()

  try {
    if (!inFlight.has(cacheKey)) {
      inFlight.set(
        cacheKey,
        fetchPhoto(photo.ref, width).finally(() => {
          // 다음 tick 에 정리해 동시 요청이 같은 약속을 공유하게 한다
          setImmediate(() => inFlight.delete(cacheKey))
        })
      )
    }
    const { buffer, contentType } = await inFlight.get(cacheKey)
    if (diskCache) await fs.promises.writeFile(cachePath, buffer).catch(() => {})
    res.type(contentType).send(buffer)
  } catch (e) {
    console.warn('[photo] 실패:', place.id, e.message)
    res.status(502).end()
  }
})

export default router
