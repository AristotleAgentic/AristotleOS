FROM node:20-alpine
ARG SERVICE_PATH
WORKDIR /app
COPY package.json ./
COPY tsconfig.base.json ./
COPY shared ./shared
COPY services ./services
COPY adapters ./adapters
RUN npm install
WORKDIR /app/${SERVICE_PATH}
RUN npm run build
CMD ["npm", "run", "start"]
