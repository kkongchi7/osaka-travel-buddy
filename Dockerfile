# 저장목록 일괄 등록에 실제 브라우저가 필요하므로 Chromium 을 함께 설치한다.
# (구글 지도 저장목록은 JS 로만 렌더링돼서 HTML 만으로는 읽을 수 없다)
FROM node:24-slim

# playwright-core 는 브라우저를 내려받지 않는다. 시스템 Chromium 을 쓴다.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       chromium \
       fonts-liberation \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# 의존성 레이어를 먼저 만들어 코드만 바뀔 때 재설치를 피한다
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Railway 가 PORT 를 주입한다. 없으면 3100.
EXPOSE 3100
CMD ["node", "server.js"]
