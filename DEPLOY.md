# 배포 (Vercel + Upstash Redis)

## 구조

```
브라우저 → Vercel CDN (화면·사진 캐시)
              ↓
         api/index.js  ← Express 앱을 서버리스 함수로 감쌈 (도쿄 리전 hnd1)
              ↓
         Upstash Redis ← 장소·유저·좋아요 저장
```

서버리스는 파일 쓰기가 안 되므로 저장소를 Redis 로 둔다. `src/store.js` 가 어댑터라
**로컬에서는 예전처럼 `data/db.json` 파일을 쓰고, 배포에서는 Redis 를 쓴다.**
환경변수(`KV_REST_API_URL`)가 있으면 Redis, 없으면 파일이다.

---

## 1. GitHub 저장소

```bash
cd osaka_travel_buddy
git init
git add .
git commit -m "오사카 여행 도우미"
gh repo create osaka-travel-buddy --private --source=. --push
```

`.gitignore` 가 `.env` 와 `data/` 를 제외한다. `seed/db.json`(관리자 계정 + 카테고리·지역)은 올라간다.

## 2. Vercel 프로젝트 생성

```bash
npm i -g vercel
vercel login
vercel link
```

또는 [vercel.com/new](https://vercel.com/new) 에서 저장소를 선택한다.
`vercel.json` 이 있으므로 프레임워크는 **Other** 로 두면 된다.

## 3. Redis 붙이기

```bash
vercel install upstash
```

대시보드에서 해도 된다: 프로젝트 → **Storage** → **Upstash Redis** → Create.
**리전은 도쿄(ap-northeast-1)** 로 고른다 — 함수와 가까워야 빠르다.

연결하면 `KV_REST_API_URL`·`KV_REST_API_TOKEN` 이 자동으로 주입된다. 직접 넣을 필요 없다.

> Redis 가 비어 있으면 첫 요청에 `seed/db.json` 이 자동으로 들어간다.
> 관리자 계정(`이재혁`)과 카테고리·지역 설정이 그대로 살아난다.

## 4. 환경변수

프로젝트 → **Settings** → **Environment Variables**

| 이름 | 값 | 필수 |
|---|---|---|
| `GOOGLE_API_KEY` | 서버용 키 (Places API New) | ✅ |
| `GOOGLE_MAPS_BROWSER_KEY` | 브라우저용 키 (Maps JavaScript API) | ✅ |
| `ADMIN_NICKNAME` | `이재혁` | ✅ |
| `SESSION_SECRET` | 아래 명령으로 생성 | ✅ |
| `ANTHROPIC_API_KEY` | (선택) | |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `SESSION_SECRET` 을 비우면 배포할 때마다 전원 로그아웃된다.

## 5. 배포

```bash
vercel --prod
```

## 6. 구글 API 키에 도메인 등록 ⚠️

**이걸 빼먹으면 지도만 안 뜬다.**

[console.cloud.google.com](https://console.cloud.google.com) → 사용자 인증 정보 → 브라우저 키
→ 애플리케이션 제한사항 → 웹사이트 → 항목 추가:

```
https://<프로젝트>.vercel.app/*
```

`http://localhost:3100/*` 는 지우지 말고 함께 둔다. 반영까지 최대 5분.
서버 키(`GOOGLE_API_KEY`)는 애플리케이션 제한이 **없음**이어야 한다 — 서버 요청엔 리퍼러가 없다.

---

## 배포 후 확인

```bash
curl https://<도메인>/api/health
# {"ok":true,"hasPlacesKey":true,"hasClaudeKey":false}
```

- [ ] `이재혁` / `0710` 로그인
- [ ] 구글 지도 링크 등록 → 사진·평점 표시
- [ ] 지도 탭 → 마커 (안 뜨면 6번 확인)
- [ ] 저장목록 링크 → 일괄 등록 (첫 실행 12~15초, chromium 콜드 스타트 포함)
- [ ] 휴대폰 접속

## 알아둘 것

**저장목록 가져오기 속도** — 로컬 10초, 배포 12~15초. 서버리스는 요청마다 chromium 을
새로 띄우기 때문이다(로컬은 인스턴스를 재사용). 함수 제한이 300초라 여유는 충분하다.

**사진** — 서버리스는 디스크 캐시를 못 쓰므로 CDN 캐시(`s-maxage=2592000`)로 대신한다.
첫 요청만 구글 API 를 호출하고 이후 30일간 CDN 이 응답한다.

**동시 편집** — 좋아요는 Redis SET 원자 연산이라 동시에 눌러도 안전하다.
장소·유저 같은 다른 컬렉션은 바뀐 것만 골라 쓰므로 서로 덮어쓰지 않는다.

## 데이터 백업

```bash
vercel env pull .env.production
node -e "
const {Redis}=require('@upstash/redis');
const r=new Redis({url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN});
(async()=>{
  const keys=['users','places','trash','categories','areas'];
  const values=await r.mget(...keys.map(k=>'otb:'+k));
  const likes=await r.smembers('otb:likes');
  const out=Object.fromEntries(keys.map((k,i)=>[k,values[i]??[]]));
  out.likes=likes.map(m=>{const[p,u,a]=m.split('::');return{placeId:p,userId:u,at:a||null}});
  require('fs').writeFileSync('backup.json',JSON.stringify(out,null,2));
  console.log('backup.json 저장 완료');
})()"
```

## 로컬 개발

환경변수에 Redis 키가 없으면 자동으로 파일 저장소를 쓴다. 지금까지처럼 그대로다.

```bash
npm run dev   # http://localhost:3100
```

---

## Docker 로 배포하고 싶다면

`Dockerfile` 과 `railway.json` 도 함께 들어 있다. Railway·Fly.io 등 디스크가 붙는
호스트에 올리면 Redis 없이 파일 저장소로 동작하고, chromium 도 시스템 패키지를 쓴다.
다만 Railway 는 영구 무료 플랜이 없다(월 $5 최소).
