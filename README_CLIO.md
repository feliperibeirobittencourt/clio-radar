# CLIO Radar — pacote otimizado

Arquivos para colocar na raiz do mesmo repositório do site:

- `index.html` — interface do CLIO.
- `package.json` e `scripts/build-data.mjs` — gerador dos dados leves.
- `.github/workflows/build-clio-data.yml` — atualização automática de hora em hora e sempre que `leiloes.csv` mudar.
- `data/` — JSONs já pré-processados.
- `assets/autores/` — fotos locais WebP dos autores.

## Como publicar só pelo iPad/iPhone

1. Envie todos os arquivos e pastas para a raiz do repositório do CLIO no GitHub.
2. Abra `Actions` no GitHub.
3. Abra `Atualizar dados otimizados do CLIO`.
4. Toque em `Run workflow` uma vez.
5. A ação baixa a coleção publicada no Google Sheets, processa a base de mercado, baixa as fotos disponíveis, converte para WebP e grava tudo no repositório.

Depois disso, a atualização roda automaticamente a cada hora e quando `leiloes.csv` é alterado no mesmo repositório.

O HTML tenta primeiro os JSONs pré-processados. Se eles ainda não existirem ou falharem, usa o CSV original como fallback.
