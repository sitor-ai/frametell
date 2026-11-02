# The render image: draws a finished Frametell project to mp4 without a desktop, a GPU or a Mac.
#   docker build -f docker/render.Dockerfile -t frametell-render .
#   docker run --rm -v "$PWD/my-project:/project" frametell-render /project [render.mjs flags, e.g. --workers 4 --fps 30]
# Chromium and ffmpeg come from Debian (ffmpeg there is a GPL build: fine on a server, which does not redistribute it).
# fonts-noto-core: the scripts a film may be in beyond Chinese and Latin (Arabic, Persian, Hebrew, Devanagari, Thai…)
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk fonts-noto-core fonts-noto-color-emoji fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium FFMPEG_PATH=/usr/bin/ffmpeg

WORKDIR /opt/frametell
# the engine as it publishes itself, with its own node_modules (the pages load fonts and libraries from it), installed
# with the repo's pnpm; ffmpeg-static's download is skipped: FFMPEG_PATH points at Debian's
COPY packages/engine/package.json engine/package.json
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate \
 && cd engine && pnpm install --prod --ignore-scripts --config.lockfile=false --config.fetch-retries=5
COPY packages/engine/boot.js engine/
COPY packages/engine/runtime engine/runtime
COPY packages/engine/lib engine/lib
COPY packages/engine/styles engine/styles
COPY packages/engine/template engine/template
COPY packages/engine/tools engine/tools
COPY packages/engine/vendor engine/vendor
COPY docker/render.mjs render.mjs

USER node
ENTRYPOINT ["node", "/opt/frametell/render.mjs"]
