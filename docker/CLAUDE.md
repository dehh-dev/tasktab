# Container

O `Dockerfile` (na raiz) e multi-stage: o runtime nao tem devDependencies,
roda como `node` e nao carrega arquivo de env. O `HEALTHCHECK` usa
`/api/health` e respeita `PORT`.

- Migrations nao rodam desta imagem (ver `src/models/CLAUDE.md`).
- `sharp`, `@napi-rs/canvas`, `zxing-wasm` e `tesseract.js` funcionam nesta
  base Alpine com `--ignore-scripts`: todos trazem binario musl pre-compilado.
  **Nao troque a base para Debian sem medir** — a troca foi avaliada e
  dispensada.
- A extracao roda sem rede: o `.wasm` do zxing e o idioma do Tesseract
  (`@tesseract.js-data/por`, dependencia de producao) entram com o
  `node_modules`. Container sem saida para a internet le QR e faz OCR igual.
- `initdb/` cria o banco `tasktab_test`, so na primeira subida do volume.
