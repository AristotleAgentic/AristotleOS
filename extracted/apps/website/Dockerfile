FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY . /app

RUN mkdir -p /data && addgroup -S aristotle && adduser -S aristotle -G aristotle
RUN chown -R aristotle:aristotle /app /data

USER aristotle
ENV HOST=0.0.0.0
ENV PORT=8080
ENV ARISTOTLE_WEBSITE_DATA_DIR=/data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "serve.mjs"]
