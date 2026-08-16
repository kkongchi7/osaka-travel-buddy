// 구글 지도 '저장 목록' 공유 링크 → 장소 여러 개 한 번에 가져오기
//
// 저장 목록 링크는 /maps/@/data=!...!2s<토큰>!3e3 형태로 리다이렉트되는데,
// URL 에도 HTML 본문에도 장소 정보가 전혀 없다(확인 완료 — place_id 0개, 좌표 0개).
// 목록은 JS 로 렌더링되므로 헤드리스 브라우저로 실제 페이지를 띄워 읽는다.
//
// 얻은 (이름, 평점)을 Places Text Search 로 매칭한다. 평점이 소수점까지 일치하면
// 이름이 번역돼 있어도 같은 장소로 확정할 수 있다 — 실측 50개 중 50개 매칭 성공.

import { chromium } from 'playwright-core'
import { searchText } from './places.js'

// 목록 패널의 스크롤 컨테이너. 구글이 클래스명을 바꾸면 여기만 고치면 된다.
const FEED = '.m6QErb.DxyBCb.kA9KIf.dS8AEf'
const OSAKA = { lat: 34.6937, lng: 135.5023, radius: 40000 }

export function isSavedListUrl(url) {
  return /!3e3(\?|$|&)/.test(url) || /\/maps\/@\/data=/.test(url)
}

/**
 * 실행 환경별로 브라우저를 띄운다.
 *   서버리스(Vercel) → @sparticuz/chromium 번들
 *   컨테이너         → CHROMIUM_PATH 로 받은 시스템 Chromium
 *   로컬             → 설치된 Chrome → Edge
 */
async function launch() {
  if (process.env.VERCEL) {
    const { default: serverlessChromium } = await import('@sparticuz/chromium')
    return chromium.launch({
      executablePath: await serverlessChromium.executablePath(),
      args: serverlessChromium.args,
      headless: true,
    })
  }

  const executablePath = process.env.CHROMIUM_PATH
  if (executablePath) {
    // 컨테이너는 보통 root 로 돌고 /dev/shm 이 작아서 두 옵션이 필요하다
    return chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  }

  return chromium
    .launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ channel: 'msedge', headless: true }))
}

let browserPromise = null
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launch()

    browserPromise.catch(() => {
      browserPromise = null
    })
  }
  return browserPromise
}

export async function closeBrowser() {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = null
  await browser?.close().catch(() => {})
}

/** 저장 목록 페이지에서 { title, items: [{ name, rating, typeLabel }] } 추출 */
export async function scrapeSavedList(url, { maxScrolls = 40 } = {}) {
  let browser
  try {
    browser = await getBrowser()
  } catch (e) {
    throw new Error(
      'Chrome 또는 Edge 를 찾지 못했어요. 저장 목록 가져오기에는 브라우저가 필요합니다.'
    )
  }

  const page = await browser.newPage({
    locale: 'ko-KR',
    viewport: { width: 1280, height: 1000 },
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector(FEED, { timeout: 20000 })
    await page.waitForTimeout(2500)

    const title = (await page.title()).replace(/\s*-\s*Google 지도.*$/, '').trim()

    // 가상 스크롤이라 끝까지 내려야 전부 로드된다
    let previous = 0
    for (let i = 0; i < maxScrolls; i++) {
      const count = await page.evaluate((sel) => {
        const box = document.querySelector(sel)
        if (!box) return -1
        box.scrollTop = box.scrollHeight
        return box.children.length
      }, FEED)
      if (count <= 0) break
      await page.waitForTimeout(700)
      const after = await page.evaluate(
        (sel) => document.querySelector(sel)?.children.length ?? 0,
        FEED
      )
      if (after === previous) break
      previous = after
    }

    const rows = await page.evaluate((sel) => {
      const box = document.querySelector(sel)
      if (!box) return []
      return [...box.children]
        .map((row) => row.innerText?.trim())
        .filter(Boolean)
        .map((text) => text.split('\n').map((s) => s.trim()).filter(Boolean))
    }, FEED)

    const items = []
    for (const lines of rows) {
      // [이름, 평점, 분류] 형태. 평점이 없는 장소도 있으므로 유연하게 파싱한다.
      const name = lines[0]
      if (!name || name.length > 80) continue
      const ratingLine = lines.find((l) => /^\d\.\d$|^\d$/.test(l))
      const rating = ratingLine ? Number(ratingLine) : null
      const typeLabel = lines.find((l) => l !== name && l !== ratingLine) ?? null
      items.push({ name, rating, typeLabel })
    }

    return { title, items }
  } finally {
    await page.close().catch(() => {})
  }
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s()（）·・.,'’\-−–—]/g, '')
}

function namesLookAlike(a, b) {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return false
  const shorter = x.length <= y.length ? x : y
  const longer = shorter === x ? y : x
  return longer.includes(shorter.slice(0, Math.min(6, shorter.length)))
}

/**
 * 목록 항목 하나를 place_id 로 매칭.
 * 평점이 소수점까지 같으면 이름이 달라도(번역명) 확정으로 본다.
 */
export async function matchListItem(item) {
  let results = []
  try {
    results = await searchText(item.name, OSAKA)
  } catch (e) {
    return { ...item, matched: null, confidence: 'none', error: e.message }
  }
  if (!results.length) return { ...item, matched: null, confidence: 'none' }

  const ratingHit =
    typeof item.rating === 'number'
      ? results.find((r) => typeof r.rating === 'number' && Math.abs(r.rating - item.rating) < 0.05)
      : null
  const chosen = ratingHit ?? results[0]
  const nameHit = namesLookAlike(item.name, chosen.displayName?.text)

  const confidence =
    ratingHit && nameHit ? 'high' : ratingHit || nameHit ? 'medium' : 'low'

  return {
    ...item,
    confidence,
    matched: {
      placeId: chosen.id,
      name: chosen.displayName?.text,
      address: chosen.formattedAddress,
      rating: chosen.rating ?? null,
      lat: chosen.location?.latitude ?? null,
      lng: chosen.location?.longitude ?? null,
    },
    alternatives: results
      .filter((r) => r.id !== chosen.id)
      .slice(0, 4)
      .map((r) => ({
        placeId: r.id,
        name: r.displayName?.text,
        address: r.formattedAddress,
        rating: r.rating ?? null,
      })),
  }
}

/** 저장 목록 링크 → 매칭까지 끝난 후보 목록 (저장은 하지 않는다) */
export async function previewSavedList(url, { concurrency = 4 } = {}) {
  const { title, items } = await scrapeSavedList(url)
  if (!items.length) {
    throw new Error('목록에서 장소를 읽지 못했어요. 공개된 공유 목록 링크인지 확인해주세요.')
  }

  const matched = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      matched[index] = await matchListItem(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))

  return { title, total: items.length, items: matched }
}
