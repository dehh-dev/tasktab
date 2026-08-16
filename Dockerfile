# syntax=docker/dockerfile:1

# ---- dependencias de producao ----------------------------------------------
FROM node:24.18.0-alpine AS prod-deps
WORKDIR /app

# O .npmrc entra junto: com engine-strict ligado, a imagem so constroi se a
# versao de Node aqui satisfizer o `engines` do package.json.
COPY package.json package-lock.json .npmrc ./
COPY web/package.json web/package.json

# --ignore-scripts vale tambem para as dependencias nativas da extracao:
# sharp, @napi-rs/canvas e zxing-wasm distribuem binario pre-compilado para
# musl como dependencia opcional, entao nao precisam de postinstall. Medido:
# as quatro (com tesseract.js do M4) carregam nesta imagem, o que dispensou
# trocar a base para Debian. Custo: +115 MB.
RUN npm ci --omit=dev --ignore-scripts

# ---- build da interface -----------------------------------------------------
FROM node:24.18.0-alpine AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY web/package.json web/package.json

RUN npm ci

COPY web ./web
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY infra ./infra

# Templates de exportacao (Anexo I). O diretorio precisa existir no contexto,
# senao o COPY falha o build inteiro.
COPY assets ./assets

# Sem Vite em producao: o Express serve este build na mesma origem da API.
COPY --from=build /app/web/dist ./web/dist

# O usuario `node` ja existe na imagem base. Rodar como root seria dar de
# graca um privilegio que a aplicacao nunca usa.
USER node

EXPOSE 3000

# Reaproveita o proprio /api/health, que consulta o banco: o container so se
# declara saudavel se o Postgres estiver respondendo.
#
# A porta vem de process.env.PORT, e nao fixa em 3000: quem sobe com outra
# porta teria um healthcheck sempre vermelho sem entender por que.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://localhost:'+p+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
