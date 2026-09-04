const BASE='https://www.estantevirtual.com.br';
const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

async function get(url){
  const res=await fetch(url,{headers:HEADERS});
  const txt=await res.text();
  return {status:res.status,txt};
}

const out=[];
function log(...args){out.push(args.join(' '));console.log(...args)}

// 1) autor de volume médio, ordenado por "new-releases", COM o filtro de preço atual
const author='Casimiro de Abreu';
const urlAtual=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&_preco=3000-10000000&pagina=1&sort=new-releases`;
const r1=await get(urlAtual);
log('=== URL ATUAL (com _preco=3000-10000000) ===', urlAtual);
log('status:', r1.status, 'tamanho:', r1.txt.length);
const totalMatch=r1.txt.match(/(\d[\d.]*)\s*resultados?/i)||r1.txt.match(/"total"\s*:\s*(\d+)/i);
log('total de resultados encontrado no HTML:', totalMatch?totalMatch[1]:'não achei o texto de contagem');
const cardCount1=(r1.txt.match(/product-item__link/g)||[]).length;
log('cards na página (contagem bruta de product-item__link):', cardCount1);

// 2) mesma busca SEM o parâmetro de preço
const urlSemPreco=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&pagina=1&sort=new-releases`;
const r2=await get(urlSemPreco);
log('\n=== SEM _preco ===', urlSemPreco);
log('status:', r2.status, 'tamanho:', r2.txt.length);
const totalMatch2=r2.txt.match(/(\d[\d.]*)\s*resultados?/i)||r2.txt.match(/"total"\s*:\s*(\d+)/i);
log('total de resultados encontrado no HTML:', totalMatch2?totalMatch2[1]:'não achei');
const cardCount2=(r2.txt.match(/product-item__link/g)||[]).length;
log('cards na página:', cardCount2);

// 3) procurar por facetas/filtros de ano na própria página (pra achar o nome real do parâmetro)
const anoFacetIdx=r2.txt.search(/ano.{0,40}publica/i);
log('\n=== trecho perto de "ano de publicação" (facetas/filtros) ===');
log(anoFacetIdx>=0?r2.txt.slice(anoFacetIdx-200,anoFacetIdx+600):'não achei nada com "ano...publica" no HTML');

// 4) checar se existe algum link/href com parâmetro de ano na página (ex: filtro clicável)
const anoParamMatches=[...r2.txt.matchAll(/[?&](ano-de-publicacao[^=&"']*)=([^&"']*)/g)].slice(0,10);
log('\nparâmetros de ano encontrados em links da página:', JSON.stringify(anoParamMatches.map(m=>[m[1],m[2]])));

// 5) tentar página 2 da busca sem preço, pra ver se ano "elegível" aparece mais fundo
const urlPag2=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&pagina=2&sort=new-releases`;
const r3=await get(urlPag2);
log('\n=== PÁGINA 2 sem preço ===', urlPag2);
log('status:', r3.status, 'cards:', (r3.txt.match(/product-item__link/g)||[]).length);
const anosPag2=[...r3.txt.matchAll(/product-item__year"[^>]*>\s*(\d{4})\s*<\/p>/g)].map(m=>m[1]);
log('anos na página 2:', anosPag2.join(','));

// 6) tentar usar um range de ano direto na query, formato chute nº1: ano-de-publicacao=ate-1940
const chute1=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&ano-de-publicacao=-1940&pagina=1`;
const r4=await get(chute1);
log('\n=== CHUTE range de ano (ano-de-publicacao=-1940) ===', chute1);
log('status:', r4.status, 'cards:', (r4.txt.match(/product-item__link/g)||[]).length);

import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('debug',{recursive:true});
await writeFile('debug/estante-cobertura.txt', out.join('\n'));
