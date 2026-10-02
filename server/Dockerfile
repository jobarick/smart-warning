# Node 22 to match the repository's engines field (>=22.12.0); this said 20.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# npm ci installs exactly what package-lock.json pins, and fails if the two
# disagree, so the image runs the dependency versions the tests ran against.
COPY package*.json ./
RUN npm ci --omit=dev

# What gets copied is limited by .dockerignore; above all, no .env file.
COPY . .

# The official image ships an unprivileged "node" user; the server needs no
# root (it listens on an unprivileged port and writes nothing to disk).
USER node

EXPOSE 3001

CMD ["node", "index.js"]
