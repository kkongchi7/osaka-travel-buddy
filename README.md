<p align="center">
  <img src="public/logo.png" alt="오사카 여행 도우미" width="120" />
</p>

<h1 align="center">오사카 여행 도우미</h1>

<p align="center">
  카톡에 흩어지는 구글 지도 링크를, 지인들과 한곳에 모아 자동으로 정리하는 웹앱
</p>

---

여행 갈 곳을 정할 때 구글 지도 링크를 단톡방에 올리면 금방 위로 밀려 사라진다.
링크만 붙여넣으면 장소 이름·사진·평점·분류·지역을 알아서 채워 넣고,
누가 올렸는지, 어디로 확정했는지, 어디를 다녀왔는지까지 함께 보이게 만든 사이트다.

- 구글 지도 **링크 한 줄**만 붙여넣으면 등록 끝
- 구글 지도의 **저장 목록** 링크는 통째로 가져오기
- 등록자 · 카테고리 · 지역 · 상태로 **필터**, 목록과 지도에 동시 반영
- 좋아요 · **확정** · **다녀옴** 표시, 삭제해도 **휴지통**에서 복원

## 주요 기능

| | |
|---|---|
| **링크 해석** | 단축 링크(`maps.app.goo.gl`)를 따라가 place_id 를 찾고, Places API 로 이름·주소·평점·사진·분류를 채운다. 실패하면 이름 검색으로 넘긴다 |
| **저장 목록 일괄 등록** | 구글 지도의 공유된 저장 목록(`!3e3`)을 헤드리스 브라우저로 읽어 한 번에 등록한다. 이름이 번역돼 있어도 **평점을 대조해** 같은 장소를 찾아낸다 |
| **자동 분류** | 구글이 주는 `types` 로 카테고리를, 좌표로 오사카 내 지역을 결정적으로 판정한다. 둘 다 나중에 손으로 고칠 수 있다 |
| **일본 밖 차단** | 주소의 국가 코드가 일본이 아니면 등록을 거부한다 |
| **목록 · 검색 · 정렬** | 이름 부분 일치 검색, 등록순 / 평점순 / 좋아요순 / 이름순 × 오름·내림차순 |
| **지도** | 마커 색은 올린 사람, 확정은 테두리, 다녀옴은 반투명. 마커를 누르면 정보창에서 바로 편집 |
| **권한** | 이름·카테고리·지역·메모·확정·다녀옴은 누구나 수정(이력 기록). **고정**은 관리자만이며 걸면 전부 잠긴다. 좋아요는 잠겨도 허용 |
| **관리자 패널** | 멤버 관리(색상·권한·정지·삭제·PIN 재설정), 카테고리·지역 추가/삭제/이름 변경 |

## 빠르게 실행하기

Node 20 이상이 필요하다. 빌드 단계는 없다.

```bash
git clone https://github.com/kkongchi7/osaka-travel-buddy.git
cd osaka-travel-buddy
npm install

cp .env.example .env    # 아래 표를 보고 채운다
npm run dev             # http://localhost:3100
```

첫 실행에 `seed/db.json` 으로 카테고리·지역이 채워진다. `ADMIN_NICKNAME` 과 같은
닉네임으로 가입하면 그 계정이 관리자가 된다.

### 환경변수

| 이름 | 필수 | 설명 |
|---|:---:|---|
| `GOOGLE_API_KEY` | ✅ | Places API (New) 호출용 **서버 키**. 애플리케이션 제한 없음으로 둘 것 |
| `GOOGLE_MAPS_BROWSER_KEY` | ✅ | 지도 표시용 **브라우저 키**. 프론트로 내려가므로 HTTP 리퍼러 제한 필수 |
| `ADMIN_NICKNAME` | ✅ | 이 닉네임으로 가입하면 관리자가 된다 |
| `SESSION_SECRET` | ✅ | 세션 쿠키 서명 키. **비우면 재시작마다 전원 로그아웃**되고, 서버가 여럿이면 로그인이 아예 유지되지 않는다 |
| `PORT` | | 기본 3100 |

```bash
# SESSION_SECRET 값 만들기
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

설정이 제대로 들어갔는지는 `/api/health` 에서 확인할 수 있다. 값은 노출되지 않고
빠진 것과 이름이 잘못된 것만 알려준다.

```jsonc
{ "ok": true, "hint": "설정 정상", "storage": "redis", "adminCount": 1 }
```

## 배포

Vercel + Upstash Redis 조합을 쓴다. 단계별 절차는 **[DEPLOY.md](DEPLOY.md)** 에 있다.

파일 저장소를 쓸 수 없는 환경이므로 저장소 어댑터(`src/store.js`)가
**로컬에서는 `data/db.json`, 배포에서는 Redis** 를 자동으로 고른다.
`KV_REST_API_URL` 이 있으면 Redis 다.

Docker 로 올리고 싶으면 `Dockerfile` 과 `railway.json` 도 함께 들어 있다.
디스크가 붙는 호스트라면 Redis 없이 파일 저장소로 그대로 돈다.

## 구조

```
server.js            Express 앱 · /api/health · 부팅 시 마이그레이션
api/index.js         Vercel 서버리스 진입점

src/
  store.js           저장소 어댑터 (파일 ↔ Redis)
  db.js              메모리 상태와 save() 래퍼
  resolve.js         구글 지도 링크 → place_id
  places.js          Places API 호출
  savedList.js       저장 목록 스크래핑 (playwright-core)
  placeModel.js      레코드 형식 · 일본 여부 검사 · 직렬화
  meta.js            카테고리 · 지역 판정
  auth.js            PIN 해시(scrypt) · 서명 쿠키 · 권한 미들웨어
  routes/            auth · places · admin · photo

public/              번들러 없는 vanilla ES modules
  ui.js              h() · mount() · api() · 시트 · 토스트
  app.js             상태와 렌더 진입점
  list.js filters.js map.js add.js admin.js trash.js profile.js
```

기술 선택은 단순하다. **Node ESM + Express 5, 빌드 단계 없음, 프레임워크 없음.**
프론트도 번들러 없이 상대 경로 ES import 만 쓴다. 저장소는 JSON 한 덩어리다.

## 알아둘 점

- **저장 목록 가져오기는 Chrome 이나 Edge 가 필요하다.** 로컬에서는 설치된 브라우저를,
  배포에서는 서버리스용 chromium 을 쓴다. 개별 링크 등록은 브라우저 없이도 된다.
- **`maps.google.com/?cid=<숫자>` 형태는 place_id 를 얻을 수 없다.** 이름 검색으로 넘긴다.
- **구글 지도 페이지 HTML 에는 장소 정보가 없다.** JS 앱 셸이라 스크래핑이 통하지 않는다.
  리다이렉트 결과만 신뢰한다.
- Places API 는 **등록 시점에 한 번만** 부르고 결과를 저장한다. 조회할 때 다시 부르지 않는다.
  사진 URL 에는 키가 들어 있어 브라우저로 내려보내지 않고 `/api/photo/:placeId` 가 프록시한다.
- 화면은 **목록 하나뿐이다.** 카드를 누르면 페이지 이동 없이 시트가 열린다.
  가볍게 유지하려고 상세 페이지와 리뷰를 의도적으로 뺐다.
- **주로 휴대폰에서 쓴다.** 화면을 고쳤다면 390px 폭에서 확인할 것.
- 테스트 러너는 없다. 검증은 임시 스크립트로 실제 API 와 브라우저를 두드려서 한다.

## 라이선스

개인용 프로젝트.
