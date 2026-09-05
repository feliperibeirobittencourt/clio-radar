// Extração de cards de busca da Estante Virtual — compartilhado entre
// scrape-estante.mjs (busca diária por autor) e backfill-estante-links.mjs
// (busca pontual por autor+título, pra achar o link direto de anúncios
// antigos que só têm link de busca genérico). Mantido num só lugar porque
// veio de engenharia reversa do site: um ajuste de regex feito num script e
// esquecido no outro os deixaria silenciosamente divergentes.

export const BASE='https://www.estantevirtual.com.br';
export const FETCH_HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

export const extractYear=v=>{const m=String(v??'').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);return m?Number(m.at(-1)):null};
export function price(v){if(v==null||v==='')return null;let s=String(v).trim().replace(/[R$\s]/g,'').replace(/[^\d,.\-]/g,'');if(!s)return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=d>c?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');else if(c>=0)s=(s.length-c-1===2)?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(d>=0&&s.length-d-1!==2)s=s.replace(/\./g,'');const n=Number(s);return Number.isFinite(n)?n:null}
export function decodeEntities(s){return String(s??'').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}

export function extractCards(html){
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
    const title=titleMatch?decodeEntities(titleMatch[1]).trim():'';
    const start=m.index,end=idx+1<productTags.length?productTags[idx+1].index:Math.min(html.length,start+4000);
    const segment=html.slice(start,end);
    const authorMatch=segment.match(/product-item__author"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const yearMatch=segment.match(/product-item__year"[^>]*>\s*(\d{4})\s*<\/p>/);
    const priceMatch=segment.match(/data-auto="price"[^>]*>\s*R\$\s*([\d.,]+)/)||segment.match(/A partir de R\$\s*([\d.,]+)/)||segment.match(/R\$\s*([\d.,]+)/);
    cards.push({href,title,cardAuthor:authorMatch?decodeEntities(authorMatch[1]).trim():'',year:yearMatch?Number(yearMatch[1]):null,price:priceMatch?price(priceMatch[1]):null});
  }
  return cards;
}

export async function fetchSearchPage(query,{searchField='autor',page=1}={}){
  const url=`${BASE}/busca?q=${encodeURIComponent(query)}&searchField=${searchField}&tipo-de-livro=usado&_preco=3000-10000000&pagina=${page}&sort=new-releases`;
  const res=await fetch(url,{headers:FETCH_HEADERS});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res.text();
}
