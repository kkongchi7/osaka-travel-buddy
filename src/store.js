// 저장소 어댑터 — 로컬은 파일, 배포(서버리스)는 Redis.
//
// 서버리스는 요청마다 다른 인스턴스가 뜰 수 있어 메모리에 들고 있을 수 없다.
// 그래서 요청 시작에 읽고, 바뀐 컬렉션만 되쓴다.
//
// 좋아요만 Redis SET 으로 따로 둔다. 가장 자주, 동시에 눌리는 데이터라
// 통째로 덮어쓰면 남의 좋아요가 지워질 수 있기 때문이다. SADD/SREM 은 원자적이다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'db.json')
const SEED_PATH = path.join(__dirname, '..', 'seed', 'db.json')

export const COLLECTIONS = ['users', 'places', 'trash', 'categories', 'areas']
const PREFIX = 'otb'
const LIKES_KEY = `${PREFIX}:likes`

const EMPTY = { users: [], places: [], likes: [], trash: [], categories: [], areas: [] }

export function emptyData() {
  return structuredClone(EMPTY)
}

function readSeed() {
  if (!fs.existsSync(SEED_PATH)) return null
  try {
    return { ...emptyData(), ...JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) }
  } catch (e) {
    console.warn('[store] seed 읽기 실패:', e.message)
    return null
  }
}

// 좋아요는 "placeId::userId::at" 한 줄로 직렬화해 SET 에 넣는다
function likeToMember(like) {
  return `${like.placeId}::${like.userId}::${like.at ?? ''}`
}

function memberToLike(member) {
  const [placeId, userId, at] = String(member).split('::')
  return { placeId, userId, at: at || null }
}

// ── 파일 저장소 (로컬 개발) ────────────────────────────
function createFileStore() {
  let writing = null
  let dirtyAgain = false

  return {
    kind: 'file',

    async load() {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      if (!fs.existsSync(DB_PATH)) {
        const seeded = readSeed() ?? emptyData()
        if (readSeed()) console.log('[store] seed/db.json 으로 초기화했습니다')
        fs.writeFileSync(DB_PATH, JSON.stringify(seeded, null, 2))
        return seeded
      }
      try {
        return { ...emptyData(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) }
      } catch (e) {
        const backup = `${DB_PATH}.corrupt-${Date.now()}`
        fs.copyFileSync(DB_PATH, backup)
        console.error(`[store] db.json 파싱 실패 (${e.message}). 백업: ${backup}`)
        return emptyData()
      }
    },

    // 파일은 통째로 쓴다 (단일 프로세스라 경쟁이 없다)
    async save(data) {
      if (writing) {
        dirtyAgain = true
        return writing
      }
      writing = (async () => {
        do {
          dirtyAgain = false
          const tmp = `${DB_PATH}.${process.pid}.tmp`
          await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2))
          await fs.promises.rename(tmp, DB_PATH)
        } while (dirtyAgain)
      })()
      try {
        await writing
      } finally {
        writing = null
      }
    },

    async toggleLike(data, placeId, userId, at) {
      const index = data.likes.findIndex((l) => l.placeId === placeId && l.userId === userId)
      if (index >= 0) data.likes.splice(index, 1)
      else data.likes.push({ placeId, userId, at })
      await this.save(data)
      return index < 0
    },
  }
}

// ── Redis 저장소 (Vercel 등 서버리스) ──────────────────
function redisCredentials() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

async function createRedisStore(credentials) {
  const { Redis } = await import('@upstash/redis')
  const redis = new Redis(credentials)

  return {
    kind: 'redis',

    async load() {
      const keys = COLLECTIONS.map((name) => `${PREFIX}:${name}`)
      const [collections, likeMembers] = await Promise.all([
        redis.mget(...keys),
        redis.smembers(LIKES_KEY),
      ])

      const data = emptyData()
      let empty = true
      COLLECTIONS.forEach((name, i) => {
        const value = collections[i]
        if (value == null) return
        empty = false
        // Upstash 는 JSON 을 자동 파싱해 돌려주기도 한다
        data[name] = typeof value === 'string' ? JSON.parse(value) : value
      })
      data.likes = (likeMembers ?? []).map(memberToLike)

      // 완전히 빈 저장소면 seed 를 심는다 (첫 배포)
      if (empty && !data.likes.length) {
        const seeded = readSeed()
        if (seeded) {
          console.log('[store] Redis 가 비어 있어 seed/db.json 으로 초기화합니다')
          await this.save(seeded)
          return seeded
        }
      }
      return data
    },

    // 컬렉션별로 나눠 쓴다. 좋아요는 SET 이라 여기서 건드리지 않는다.
    async save(data, changed = COLLECTIONS) {
      const pipeline = redis.pipeline()
      for (const name of changed) {
        if (!COLLECTIONS.includes(name)) continue
        pipeline.set(`${PREFIX}:${name}`, JSON.stringify(data[name] ?? []))
      }
      if (data.likes && changed === COLLECTIONS) {
        // seed 초기화처럼 전체를 쓸 때만 좋아요도 통째로 넣는다
        pipeline.del(LIKES_KEY)
        if (data.likes.length) pipeline.sadd(LIKES_KEY, ...data.likes.map(likeToMember))
      }
      await pipeline.exec()
    },

    // 원자적 토글 — 동시에 눌러도 서로의 좋아요를 지우지 않는다
    async toggleLike(data, placeId, userId, at) {
      const existing = data.likes.find((l) => l.placeId === placeId && l.userId === userId)
      if (existing) {
        await redis.srem(LIKES_KEY, likeToMember(existing))
        data.likes = data.likes.filter((l) => l !== existing)
        return false
      }
      const like = { placeId, userId, at }
      await redis.sadd(LIKES_KEY, likeToMember(like))
      data.likes.push(like)
      return true
    },
  }
}

let storePromise = null

export function createStore() {
  if (!storePromise) {
    const credentials = redisCredentials()
    storePromise = credentials
      ? createRedisStore(credentials).then((store) => {
          console.log('[store] Redis 저장소 사용')
          return store
        })
      : Promise.resolve(createFileStore())
  }
  return storePromise
}

export function isServerless() {
  return Boolean(redisCredentials())
}
