FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src
COPY index.js ./
COPY README.md ./

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
