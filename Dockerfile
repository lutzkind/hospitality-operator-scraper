FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src
COPY index.js ./
COPY README.md ./

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
