FROM node:24-alpine

WORKDIR /app
COPY --chown=node:node server.js ./server.js
COPY --chown=node:node public ./public

ENV PORT=4180
USER node
EXPOSE 4180

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4180/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
