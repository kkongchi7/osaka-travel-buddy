import express from 'express'
import { requireAuth } from '../auth.js'
import { getForecast } from '../weather.js'

const router = express.Router()

router.get('/', requireAuth, async (req, res) => {
  try {
    const forecast = await getForecast()
    // 모두에게 같은 내용이라 CDN 이 대신 받아주게 한다. 서버리스에는 디스크 캐시가 없다.
    res.set('cache-control', 'public, s-maxage=1800, stale-while-revalidate=3600')
    res.json(forecast)
  } catch (e) {
    // 날씨는 부가 기능이다. 실패해도 사이트가 멈추면 안 되므로 조용히 알린다.
    console.warn('[weather]', e.message)
    res.status(503).json({ error: 'weather_unavailable', message: '날씨를 불러오지 못했어요.' })
  }
})

export default router
