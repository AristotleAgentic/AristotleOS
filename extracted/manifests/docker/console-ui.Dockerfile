FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY tsconfig.base.json ./
COPY shared ./shared
COPY apps ./apps
RUN npm install
WORKDIR /app/apps/console-ui
RUN npm run build
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
