# CLIO Radar de Acervo

MVP estático para cruzar:
- coleção pessoal publicada em Google Sheets;
- mercado observado em um CSV atualizado no GitHub;
- oportunidades atuais e histórico de vendas.

## Publicar no GitHub Pages

1. Crie um repositório, por exemplo `clio-radar`.
2. Envie `index.html` para a raiz.
3. No GitHub, abra **Settings > Pages**.
4. Em **Build and deployment**, escolha publicação a partir da branch `main` e pasta `/root`.
5. Abra o endereço publicado.
6. Abra o CLIO Radar. A fonte de mercado já vem conectada automaticamente ao repositório `feliperibeirobittencourt/monitor-leiloes`.

Exemplo de URL Raw:

`https://raw.githubusercontent.com/USUARIO/REPOSITORIO/main/data/leiloes.csv`

## Coleção

O painel já vem apontando para:

`https://docs.google.com/spreadsheets/d/e/2PACX-1vTy71HxXBO-cXNMpbsoSa-GwSDPPaVAzqh7hXMNUEpWsThdGyj7KYtzrGQalsYGMg/pub?gid=416493939&single=true&output=csv`

A leitura é dinâmica. O código tenta reconhecer colunas de autor, título, ano e tipo por variações de cabeçalho.

## Funcionamento do MVP

- Radar de oportunidades atuais.
- Score de interesse de 0 a 100.
- Cruzamento com a coleção.
- Pesquisa sem depender de acentos.
- Agrupamento de ocorrências similares por obra/edição.
- Histórico de preços finais observados.
- Lista "Minha Caça", salva no navegador.
- Upload manual de CSV para testes.
- Layout responsivo para iPhone e iPad.

## Campos ideais no CSV de mercado

O painel aceita o CSV atual, mas ganha precisão com:

- `Tipo`
- `Obra normalizada`
- `Ano da edição`
- `Edição`
- `Editora`
- `Cidade de publicação`
- `Assinado/autógrafo`
- `Primeira edição`
- `URL da imagem`
- `URL direta do lote`
- `ID do leilão`
- `ID do lote no leiloeiro`
- `Confiança da classificação`

Os campos atuais `Autor`, `Título`, `Ano`, `Situação na coleção`, `Descrição completa`, `Leiloeiro`, `Data do pregão`, `Lance inicial (R$)`, `Valor final (R$)`, `Status`, `Link` e `Detectado em` já são utilizados.


## Fonte de mercado já conectada

`https://raw.githubusercontent.com/feliperibeirobittencourt/monitor-leiloes/refs/heads/main/leiloes.csv`

O painel faz `fetch` dessa URL com `cache: no-store`, portanto consulta o CSV publicado no GitHub quando é aberto ou quando o botão de atualização é acionado.
