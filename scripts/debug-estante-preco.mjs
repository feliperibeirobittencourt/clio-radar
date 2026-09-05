const BASE='https://www.estantevirtual.com.br';
const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};
async function get(url){const res=await fetch(url,{headers:HEADERS});return {status:res.status,txt:await res.text()}}

function extractCards(html){
  const tagRe=/<a\b[^>]*>/g;
  const productTags=[...html.matchAll(tagRe)].filter(m=>/class="[^"]*product-item__link/.test(m[0]));
  const seen=new Set(),cards=[];
  for(let idx=0;idx<productTags.length;idx++){
    const m=productTags[idx],tag=m[0];
    const hrefMatch=tag.match(/href="([^"]+)"/);
    if(!hrefMatch||!hrefMatch[1].startsWith('/livro/'))continue;
    const href=hrefMatch[1];
    if(seen.has(href))continue;
    seen.add(href);
    const titleMatch=tag.match(/title="([^"]*)"/);
    const title=titleMatch?titleMatch[1].trim():'';
    const start=m.index,end=idx+1<productTags.length?productTags[idx+1].index:Math.min(html.length,start+4000);
    const segment=html.slice(start,end);
    const yearMatch=segment.match(/product-item__year"[^>]*>\s*(\d{4})\s*<\/p>/);
    const priceMatch=segment.match(/data-auto="price"[^>]*>\s*R\$\s*([\d.,]+)/)||segment.match(/A partir de R\$\s*([\d.,]+)/)||segment.match(/R\$\s*([\d.,]+)/);
    cards.push({title,year:yearMatch?yearMatch[1]:null,priceRaw:priceMatch?priceMatch[1]:null});
  }
  return cards;
}

const out=[];
function log(...a){out.push(a.join(' '));console.log(...a)}

const author='Casimiro de Abreu';

const urlComFiltro=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&_preco=3000-10000000&pagina=1&sort=new-releases`;
const r1=await get(urlComFiltro);
const cards1=extractCards(r1.txt);
log('=== COM filtro _preco=3000-10000000 (pág 1) ===');
for(const c of cards1)log(`preço bruto: R$ ${c.priceRaw} | ano: ${c.year} | ${c.title}`);

const urlSemFiltro=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&pagina=1&sort=new-releases`;
const r2=await get(urlSemFiltro);
const cards2=extractCards(r2.txt);
log('\n=== SEM filtro (pág 1) ===');
for(const c of cards2)log(`preço bruto: R$ ${c.priceRaw} | ano: ${c.year} | ${c.title}`);

// também testar um valor bem baixo pra ver se aparece
const urlBaixo=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&_preco=0-2999&pagina=1&sort=new-releases`;
const r3=await get(urlBaixo);
const cards3=extractCards(r3.txt);
log('\n=== SÓ faixa 0-2999 (o que o filtro atual EXCLUI) ===');
for(const c of cards3)log(`preço bruto: R$ ${c.priceRaw} | ano: ${c.year} | ${c.title}`);

import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('debug',{recursive:true});
await writeFile('debug/estante-preco.txt', out.join('\n'));
