# ===== 构建阶段 =====
FROM node:24-slim AS build
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# 换国内镜像源 + 跳过安装脚本（better-sqlite3 用预构建二进制，避免 node-gyp 找 Python）+ 加大超时重试
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --ignore-scripts --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-timeout=600000

# 复制源码并编译（后端 tsc + 前端 vite build）
COPY . .
# mapping_actor.xml 是可选数据文件（演员别名映射，默认不随仓库分发）；
# 若不存在则生成空模板，保证编译/运行不因缺文件而失败
RUN test -f /app/mapping_actor.xml || printf '<?xml version="1.0" encoding="UTF-8"?>\n<actor></actor>' > /app/mapping_actor.xml
RUN npm run build

# 移除 devDependencies，只保留生产依赖（含 ffmpeg 平台包 + better-sqlite3 prebuild）
RUN npm prune --omit=dev

# ===== 运行阶段 =====
FROM node:24-slim
WORKDIR /app

ENV NODE_ENV=production

# 安装系统 ffmpeg（带 VAAPI 硬件加速）+ Intel iHD 驱动，用于群晖核显硬解 4K HEVC 转码
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        intel-media-va-driver \
        libva2 \
        libva-drm2 \
    && rm -rf /var/lib/apt/lists/*

# 只复制运行时需要的内容
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/config.json ./config.json
COPY --from=build /app/mapping_actor.xml ./mapping_actor.xml

EXPOSE 8899
CMD ["node", "server/dist/index.js"]
