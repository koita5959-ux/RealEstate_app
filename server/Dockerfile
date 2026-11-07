FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js admin.js land.js admin.html system.txt ./
ENV NODE_ENV=production TZ=Asia/Tokyo
USER node
EXPOSE 3000
CMD ["node", "server.js"]
