# Portable image for the WebSocket relay — works on Railway, Fly.io, Cloud Run,
# or any container host. The relay reads process.env.PORT (falls back to 3001).
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY index.js ./
EXPOSE 3001
CMD ["node", "index.js"]
