# Greenlight server: a persistent container with Chromium and the pinned Kane CLI.
# Kane runs as a subprocess of this server for up to GREENLIGHT_KANE_TIMEOUT_MINUTES; never
# deploy this as a serverless function (brief §13).
#
#   docker build -t greenlight-server .
#   docker compose up -d            (see compose.yaml; secrets come from .env, never the image)
#
# No secret is baked into the image. Supabase settings arrive as environment variables at
# run time; Kane's login lives in the kane-home volume (one-time `kane-cli login`, see
# docs/HOSTING.md).

FROM node:22-bookworm-slim

# Chromium (Kane 0.10.6 finds /usr/bin/chromium), fonts for faithful rendering, CA certs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The exact Kane CLI version Greenlight is built and tested against.
RUN npm install -g @testmuai/kane-cli@0.10.6 \
 && npm cache clean --force \
 && kane-cli --version | grep -qx '0.10.6'

ENV NODE_ENV=production \
    KANE_CLI_CHROME_PATH=/usr/bin/chromium \
    GREENLIGHT_HOST=0.0.0.0 \
    GREENLIGHT_PORT=8787 \
    GREENLIGHT_WORK_DIR=/var/lib/greenlight/work \
    GREENLIGHT_KANE_BIN=kane-cli

WORKDIR /app
# Greenlight has no runtime dependencies; dev dependencies (test database) are not installed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bin ./bin
COPY src ./src

# Unprivileged user; Kane keeps its login under $HOME/.testmuai (a volume).
RUN useradd --create-home --uid 10001 greenlight \
 && mkdir -p /var/lib/greenlight/work /home/greenlight/.testmuai \
 && chown -R greenlight:greenlight /var/lib/greenlight /home/greenlight
USER greenlight
ENV HOME=/home/greenlight
VOLUME ["/home/greenlight/.testmuai", "/var/lib/greenlight/work"]

EXPOSE 8787
# Readiness: server, Supabase database API, private evidence bucket, Kane CLI and Chrome.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GREENLIGHT_PORT||8787)+'/v1/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "bin/greenlight-server.js"]
