# Meridian BI · imagem de produção (Node 24, sem dependências de runtime)
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4173 \
    HOST=0.0.0.0

# Código e dataset demo (usado apenas para semear um volume vazio).
COPY app ./app
COPY server ./server
COPY scripts ./scripts
COPY config ./seed-config
COPY data ./seed-data
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/meridian-entrypoint

RUN apk add --no-cache su-exec \
 && chmod +x /usr/local/bin/meridian-entrypoint \
 && mkdir -p /app/data /app/config /app/logs /app/.secrets

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["meridian-entrypoint"]
CMD ["node", "server/prod.mjs"]
