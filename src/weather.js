// tenki.jp 의 오사카시 기타구 10일 예보를 읽어 온다.
//
// 페이지에 표가 그대로 들어 있어 브라우저 없이 HTML 만으로 파싱된다.
// (구글 지도와 달리 JS 앱 셸이 아니다 — savedList.js 같은 헤드리스 브라우저가 필요 없다.)
//
// 남의 서버라 자주 두드리지 않는다. 인스턴스 메모리에 1시간 캐시하고,
// 응답에 s-maxage 를 붙여 CDN 이 대신 받아주게 한다.

const SOURCE_URL = 'https://tenki.jp/forecast/6/30/6200/27127/10days.html'
const TTL_MS = 60 * 60 * 1000
const DAYS = 7

// 일본어 예보 문구(天気テロップ)를 한글과 그림문자로 옮긴다.
// 긴 것부터 검사한다 — 「大雨」가 「雨」보다 먼저 잡혀야 한다.
const CONDITIONS = [
  { jp: '暴風雨', ko: '폭풍우', kind: 'storm' },
  { jp: '雷雨', ko: '뇌우', kind: 'storm' },
  { jp: '大雨', ko: '폭우', kind: 'rain' },
  { jp: '大雪', ko: '폭설', kind: 'snow' },
  { jp: 'みぞれ', ko: '진눈깨비', kind: 'snow' },
  { jp: '晴', ko: '맑음', kind: 'sun' },
  { jp: '曇', ko: '흐림', kind: 'cloud' },
  { jp: '雨', ko: '비', kind: 'rain' },
  { jp: '雪', ko: '눈', kind: 'snow' },
  { jp: '雷', ko: '천둥', kind: 'storm' },
  { jp: '霧', ko: '안개', kind: 'fog' },
]

// 「時々」「一時」「のち」 같은 연결어.
// のち 는 순서(먼저→나중)라 앞말을 그대로 두고, 나머지는 「맑고」처럼 이어 준다.
const CONNECTORS = [
  { jp: '時々', ko: '가끔', joins: true },
  { jp: '一時', ko: '한때', joins: true },
  { jp: 'のち', ko: '뒤', joins: false },
  { jp: '後', ko: '뒤', joins: false },
]

// 「맑음」 → 「맑고」. 뒷말이 이어질 때만 쓴다.
const CONJUNCTIVE = { 맑음: '맑고', 흐림: '흐리고', 비: '비 오고', 눈: '눈 오고' }

const ICONS = {
  sun: '☀️',
  cloud: '☁️',
  rain: '🌧️',
  snow: '❄️',
  storm: '⛈️',
  fog: '🌫️',
  'sun+cloud': '🌤️',
  'cloud+sun': '⛅',
  'sun+rain': '🌦️',
  'cloud+rain': '🌦️',
  'sun+snow': '🌨️',
  'cloud+snow': '🌨️',
}

/** 「曇一時雨」 → { label: '흐리고 한때 비', icon: '🌦️', kinds: ['cloud','rain'] } */
export function readTelop(telop) {
  const text = String(telop ?? '').trim()
  if (!text) return { label: '—', icon: '❔', kinds: [] }

  // 연결어를 기준으로 쪼갠다. 「曇一時雨」 → [曇, 一時(한때), 雨]
  const parts = []
  let rest = text
  while (rest) {
    const conn = CONNECTORS.find((c) => rest.startsWith(c.jp))
    if (conn) {
      parts.push({ type: 'conn', ko: conn.ko, joins: conn.joins })
      rest = rest.slice(conn.jp.length)
      continue
    }
    const cond = CONDITIONS.find((c) => rest.startsWith(c.jp))
    if (cond) {
      parts.push({ type: 'cond', ko: cond.ko, kind: cond.kind })
      rest = rest.slice(cond.jp.length)
      continue
    }
    rest = rest.slice(1) // 모르는 글자는 건너뛴다
  }

  const kinds = parts.filter((p) => p.type === 'cond').map((p) => p.kind)
  if (!kinds.length) return { label: text, icon: '❔', kinds: [] }

  // 한글 문장 조립
  const words = []
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]
    if (p.type === 'conn') {
      // 「가끔」·「한때」 앞의 말은 「맑고」처럼 이어 준다. 「뒤」는 그대로 둔다.
      if (p.joins && words.length) {
        const last = words.length - 1
        words[last] = CONJUNCTIVE[words[last]] ?? words[last]
      }
      words.push(p.ko)
      continue
    }
    // 연결어 없이 상태가 이어지면(「雷雨」처럼 매핑에 없는 조합) 그냥 띄어 쓴다
    words.push(p.ko)
  }
  const label = words.join(' ')

  const icon =
    ICONS[`${kinds[0]}+${kinds.find((k) => k !== kinds[0]) ?? ''}`] ?? ICONS[kinds[0]] ?? '❔'
  return { label, icon, kinds }
}

const stripTags = (html) => html.replace(/<[^>]*>/g, '').trim()

function decode(html) {
  return html
    .replace(/&#8451;/g, '℃')
    .replace(/&#13212;/g, 'mm')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

/** 「08月16日(日)」 → { month: 8, day: 16, weekday: '일' } */
const WEEKDAYS = { 日: '일', 月: '월', 火: '화', 水: '수', 木: '목', 金: '금', 土: '토' }

function readDate(html) {
  const text = stripTags(html)
  const m = text.match(/(\d+)月(\d+)日\((.)\)/)
  if (!m) return null
  return {
    month: Number(m[1]),
    day: Number(m[2]),
    weekday: WEEKDAYS[m[3]] ?? m[3],
    isWeekend: html.includes('sunday') || html.includes('saturday') || m[3] === '日' || m[3] === '土',
  }
}

/** 10일 예보 HTML → 하루치 배열 */
export function parseForecast(html) {
  const rows = [...html.matchAll(/<dd class="forecast10days-actab">([\s\S]*?)<\/dd>/g)].map(
    (m) => m[1]
  )

  const days = []
  for (const row of rows) {
    const date = readDate(row.match(/<div class="days">([\s\S]*?)<\/div>/)?.[1] ?? '')
    if (!date) continue

    const telop = stripTags(row.match(/<span class="forecast-telop">([\s\S]*?)<\/span>/)?.[1] ?? '')
    const high = decode(row.match(/<span class="high-temp">([\s\S]*?)<\/span>/)?.[1] ?? '')
    const low = decode(row.match(/<span class="low-temp">([\s\S]*?)<\/span>/)?.[1] ?? '')
    const prob = stripTags(row.match(/<div class="prob-precip">([\s\S]*?)<\/div>/)?.[1] ?? '')
    const precip = decode(stripTags(row.match(/<div class="precip">([\s\S]*?)<\/div>/)?.[1] ?? ''))

    const { label, icon } = readTelop(telop)
    days.push({
      ...date,
      telop,
      label,
      icon,
      high: high || null,
      low: low || null,
      prob: prob || null,
      precip: precip || null,
    })
  }
  return days
}

let cache = null

export async function getForecast({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value

  const res = await fetch(SOURCE_URL, {
    headers: {
      // 기본 UA 로는 막히는 경우가 있어 일반 브라우저처럼 요청한다
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'accept-language': 'ja,en;q=0.8',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`tenki.jp 응답 ${res.status}`)

  const days = parseForecast(await res.text())
  if (!days.length) throw new Error('예보를 읽지 못했습니다 (페이지 구조가 바뀌었을 수 있어요)')

  const value = {
    place: '오사카 기타구',
    source: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    days: days.slice(0, DAYS),
  }
  cache = { at: Date.now(), value }
  return value
}
