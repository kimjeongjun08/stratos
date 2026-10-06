# STRATOS — full-stack image (HTTP + WebSocket + SQLite).
# Node 24 ships node:sqlite without an experimental flag.
# Zero npm dependencies, so there is nothing to install.
FROM node:24-alpine

WORKDIR /app
COPY . .

# Render/Railway/Fly inject PORT; the server reads process.env.PORT.
ENV PORT=4173
EXPOSE 4173

# Persist the SQLite file under /app/server/data (mount a volume for durability).
CMD ["node", "server/index.mjs"]
