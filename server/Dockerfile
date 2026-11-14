FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js admin.js land.js around.js trigger.js altland.js admin.html system.txt system_talk.txt system_talk_staff.txt ./
COPY shop ./shop
ENV NODE_ENV=production TZ=Asia/Tokyo
USER node
EXPOSE 3000
CMD ["node", "server.js"]
