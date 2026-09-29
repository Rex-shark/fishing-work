# syntax=docker/dockerfile:1
# fishing-work 部署映像（plan/docker-deploy.md、spec/architecture.md §3「Docker 部署」）
# 建置：docker build -t fishing-work .   執行：docker run -d -p 80:80 fishing-work

# ---------- build：安裝全部相依並建置三個 workspace ----------
FROM node:24-slim AS build
WORKDIR /app
# 先只複製 package*.json，原始碼變動時可沿用 npm ci 這層快取
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY draw-guess/package.json draw-guess/
RUN npm ci --no-audit --no-fund
COPY . .
# 產出 draw-guess/dist 與 server/dist/index.js（shared 由 tsup 打包進 server）
RUN npm run build \
 && find server/dist draw-guess/dist -name '*.map' -delete

# ---------- deps：只裝 server 的正式相依（express、socket.io） ----------
# 不用 `npm ci --omit=dev -w @fishing-work/server`：server 的 devDependency socket.io-client
# 同時是 draw-guess 的正式相依，lockfile 不會標成 dev，會被一起裝進來（見 plan/docker-deploy.md 踩雷紀錄）。
# 改為：由 server/package.json 產生只含正式相依的 package.json（去掉已打包進 dist 的 @fishing-work/*），
# 搭配 repo 的 package-lock.json 安裝；npm 以 lockfile 為起點，版本與 lockfile 一致。
FROM node:24-slim AS deps
WORKDIR /app
COPY package-lock.json ./
COPY server/package.json /tmp/server-package.json
RUN node -e "const s=require('/tmp/server-package.json');const deps=Object.fromEntries(Object.entries(s.dependencies).filter(([k])=>!k.startsWith('@fishing-work/')));require('fs').writeFileSync('package.json',JSON.stringify({name:'fishing-work-runtime',private:true,dependencies:deps},null,2))" \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ---------- runtime：最小執行映像 ----------
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=80 \
    HOST=0.0.0.0 \
    IN_CONTAINER=1
WORKDIR /app
# 目錄結構與 repo 相同：server/src/static.ts 以 server/.. 找 draw-guess/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY --from=build /app/draw-guess/dist ./draw-guess/dist
# 非 root 執行；Docker 20.10 起容器預設允許非 root 綁 1024 以下的埠
USER node
EXPOSE 80
# 用 Node 內建 fetch 檢查 /healthz，不另裝 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/dist/index.js"]
