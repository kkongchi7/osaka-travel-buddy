// 저장소 어댑터 — 로컬은 파일, 배포(서버리스)는 Redis.
//
// 서버리스는 요청마다 다른 인스턴스가 뜰 수 있어 메모리에 들고 있을 수 없다.
// 그래서 요청 시작에 읽고, 바뀐 것만 되쓴다.
//
// **바뀐 레코드 단위로 쓴다.** 컬렉션을 배열 하나로 저장하면 두 사람이 동시에
// 장소를 올렸을 때 나중에 저장한 쪽이 앞사람 것을 통째로 지운다(lost update).
// 그래서 users·places·trash 는 Redis HASH 로 두고 필드(=레코드 id)만 갱신한다.
// 어떤 레코드가 바뀌었는지는 load 시점 스냅샷과 비교해 알아내므로 라우트는 그대로다.
//
// 좋아요는 Redis SET 이다. 가장 자주, 동시에 눌리는 데이터라
// 통째로 덮어쓰면 남의 좋아요가 지워질 수 있기 때문이다. SADD/SREM 은 원자적이다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'db.json')
const SEED_PATH = path.join(__dirname, '..', 'seed', 'db.json')

export const COLLECTIONS = ['users', 'places', 'trash', 'categories', 'areas']

// id 를 가진 레코드 컬렉션 — HASH 로 저장해 레코드 단위로 갱신한다
const HASH_COLLECTIONS = ['users', 'places', 'trash']
// 설정값 — 관리자만, 그것도 가끔 바꾸므로 배열 통째로 써도 안전하다
const ARRAY_COLLECTIONS = ['categories', 'areas']

const PREFIX = 'otb'
const LIKES_KEY = `${PREFIX}:likes`
const hashKey = (name) => `${PREFIX}:h:${name}`
const arrayKey = (name) => `${PREFIX}:${name}`

// load 당시의 레코드 상태. data 에 숨겨 붙여 두어 요청끼리 섞이지 않게 한다.
const BASELINE = Symbol('baseline')

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

// Upstash 는 JSON 을 자동 파싱해 돌려주기도 하고 문자열로 주기도 한다
function parseValue(value) {
  return typeof value === 'string' ? JSON.parse(value) : value
}

// HGETALL 은 순서를 보장하지 않는다. 등록순으로 되돌려 화면 기본 정렬을 안정시킨다.
function sortRecords(records) {
  return records.sort((a, b) => String(a?.createdAt ?? '').localeCompare(String(b?.createdAt ?? '')))
}

// 레코드 배열 → Map(id → JSON 문자열)
function serializeRecords(records, name) {
  const map = new Map()
  ;(records ?? []).forEach((record, i) => {
    // id 는 모든 레코드가 갖고 있지만, 없더라도 데이터를 잃지는 않게 한다
    const id = record?.id ?? `_${i}`
    if (!record?.id) console.warn(`[store] ${name}[${i}] 에 id 가 없습니다`)
    map.set(String(id), JSON.stringify(record))
  })
  return map
}

// load 직후 상태를 data 에 숨겨 붙인다. skip 에 든 컬렉션은 비워 둬서 전부 다시 쓰게 한다.
function attachBaseline(data, skip) {
  const baseline = new Map()
  for (const name of HASH_COLLECTIONS) {
    baseline.set(name, skip === null || skip?.includes(name) ? new Map() : serializeRecords(data[name], name))
  }
  Object.defineProperty(data, BASELINE, { value: baseline, enumerable: false, configurable: true })
  return baseline
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
      const [hashes, arrays, legacy, likeMembers] = await Promise.all([
        Promise.all(HASH_COLLECTIONS.map((name) => redis.hgetall(hashKey(name)))),
        redis.mget(...ARRAY_COLLECTIONS.map(arrayKey)),
        // HASH 도입 전 배열로 저장된 값. 있으면 이번 load 에서 옮긴다.
        redis.mget(...HASH_COLLECTIONS.map(arrayKey)),
        redis.smembers(LIKES_KEY),
      ])

      const data = emptyData()
      let empty = true
      const migrate = []

      HASH_COLLECTIONS.forEach((name, i) => {
        const fields = hashes[i]
        if (fields && Object.keys(fields).length) {
          empty = false
          data[name] = sortRecords(Object.values(fields).map(parseValue))
          return
        }
        const old = legacy[i]
        if (old == null) return
        empty = false
        data[name] = parseValue(old) ?? []
        migrate.push(name)
      })

      ARRAY_COLLECTIONS.forEach((name, i) => {
        const value = arrays[i]
        if (value == null) return
        empty = false
        data[name] = parseValue(value)
      })

      data.likes = (likeMembers ?? []).map(memberToLike)

      // 완전히 빈 저장소면 seed 를 심는다 (첫 배포)
      if (empty && !data.likes.length) {
        const seeded = readSeed()
        if (seeded) {
          console.log('[store] Redis 가 비어 있어 seed/db.json 으로 초기화합니다')
          attachBaseline(seeded, null)
          await this.save(seeded, COLLECTIONS)
          return seeded
        }
      }

      attachBaseline(data, migrate.length ? migrate : undefined)

      if (migrate.length) {
        // 배열 → HASH 이전. 스냅샷을 비워 뒀으므로 전체가 다시 쓰인다.
        console.log(`[store] ${migrate.join(', ')} 를 레코드 단위 저장으로 옮깁니다`)
        await this.save(data, migrate)
        await redis.del(...migrate.map(arrayKey))
      }
      return data
    },

    // 바뀐 레코드만 HSET, 사라진 레코드만 HDEL 한다.
    // 다른 사람이 같은 사이에 추가한 레코드는 건드리지 않으므로 덮어쓰기가 없다.
    async save(data, changed = COLLECTIONS) {
      const baseline = data[BASELINE] ?? attachBaseline(data, null)
      const pipeline = redis.pipeline()
      let queued = 0

      for (const name of changed) {
        if (ARRAY_COLLECTIONS.includes(name)) {
          pipeline.set(arrayKey(name), JSON.stringify(data[name] ?? []))
          queued += 1
          continue
        }
        if (!HASH_COLLECTIONS.includes(name)) continue

        const before = baseline.get(name) ?? new Map()
        const after = serializeRecords(data[name], name)

        const fields = {}
        let dirty = 0
        for (const [id, json] of after) {
          if (before.get(id) !== json) {
            fields[id] = json
            dirty += 1
          }
        }
        const gone = [...before.keys()].filter((id) => !after.has(id))

        if (dirty) {
          pipeline.hset(hashKey(name), fields)
          queued += 1
        }
        if (gone.length) {
          pipeline.hdel(hashKey(name), ...gone)
          queued += 1
        }
        baseline.set(name, after)
      }

      // seed 초기화처럼 전체를 쓸 때만 좋아요도 통째로 넣는다
      if (data.likes && changed === COLLECTIONS) {
        pipeline.del(LIKES_KEY)
        queued += 1
        if (data.likes.length) {
          pipeline.sadd(LIKES_KEY, ...data.likes.map(likeToMember))
          queued += 1
        }
      }

      if (queued) await pipeline.exec()
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
