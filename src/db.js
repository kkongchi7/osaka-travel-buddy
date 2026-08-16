// 저장소 접근 계층.
//
// 코드 전반이 db() 를 동기로 쓰기 때문에, "요청 시작에 한 번 읽고 그 뒤로는 동기 접근"
// 이라는 구조를 유지한다. 서버리스에서는 인스턴스가 매 요청 달라질 수 있으므로
// 요청마다 다시 읽는다 (src/store.js).

import { randomBytes } from 'node:crypto'
import { COLLECTIONS, createStore, emptyData, isServerless } from './store.js'

let data = null
let store = null
let loading = null

async function ensureStore() {
  if (!store) store = await createStore()
  return store
}

/** 요청 처리 전에 호출한다. 서버리스에서는 매 요청, 로컬에서는 첫 요청에만 읽는다. */
export async function loadData({ force = false } = {}) {
  if (data && !force && !isServerless()) return data
  if (loading) return loading

  loading = (async () => {
    const s = await ensureStore()
    data = await s.load()
    return data
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

/** 이미 읽어둔 데이터를 동기로 돌려준다. loadData() 가 먼저 불려야 한다. */
export function db() {
  if (!data) {
    // 로컬 파일 저장소에서는 동기 초기화가 가능하지만, 여기까지 왔다는 건
    // loadData() 를 빠뜨렸다는 뜻이므로 빈 데이터 대신 명확히 알린다.
    throw new Error('db() 호출 전에 loadData() 가 필요합니다')
  }
  return data
}

/**
 * 변경사항 저장. changed 로 바뀐 컬렉션만 넘기면 Redis 에서 그 키만 쓴다.
 * (다른 사람이 동시에 다른 컬렉션을 고쳐도 서로 덮어쓰지 않는다)
 */
export async function save(changed = COLLECTIONS) {
  const s = await ensureStore()
  await s.save(db(), changed)
}

/** 좋아요 토글. Redis 에서는 SET 원자 연산이라 동시 클릭에도 안전하다. */
export async function toggleLike(placeId, userId) {
  const s = await ensureStore()
  return s.toggleLike(db(), placeId, userId, nowIso())
}

/** 모든 요청 앞에 붙는 미들웨어 */
export function withData(req, res, next) {
  loadData().then(
    () => next(),
    (error) => {
      console.error('[db] 저장소 읽기 실패:', error.message)
      res.status(503).json({ error: '저장소에 연결하지 못했어요. 잠시 후 다시 시도해주세요.' })
    }
  )
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export function nowIso() {
  return new Date().toISOString()
}

export { emptyData }
