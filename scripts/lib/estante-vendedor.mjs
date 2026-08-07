// Extração de vendedor (sebo/livraria) na Estante Virtual — compartilhado entre
// scrape-estante.mjs (achados novos, dia a dia) e backfill-estante-vendedores.mjs
// (preenchimento do histórico já existente). Mantido num só lugar porque veio
// de engenharia reversa do site (nada disso é documentado publicamente) — um
// ajuste de regex feito num dos dois scripts e esquecido no outro os deixaria
// silenciosamente divergentes.

export const BASE='https://www.estantevirtual.com.br';
export const FETCH_HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

export const norm=v=>String(v??'').normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const slugify=v=>norm(v).replace(/\s+/g,'-');
export function decodeEntities(s){return String(s??'').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}

// A busca por autor não mostra qual sebo/livraria está vendendo cada anúncio
// (só um id genérico da plataforma) — só a página do próprio livro mostra o
// vendedor de verdade, embutido num bloco JSON de rastreamento.
export async function fetchSellerName(sku){
  if(!sku)return '';
  try{
    const res=await fetch(`${BASE}/livro/${sku}`,{headers:FETCH_HEADERS});
    if(!res.ok)return '';
    const html=await res.text();
    const m=html.match(/"seller"\s*:\s*"([^"]+)"/);
    return m?decodeEntities(m[1]).trim():'';
  }catch{return ''}
}

// Cidade/estado do vendedor só aparecem na própria página do sebo/livraria
// (nunca na busca nem na página do livro), num bloco "Seller" com o endereço
// de distribuição. A URL do vendedor é o nome dele "fatiado" (slug) — mesmo
// padrão de slug usado no resto do projeto — e funciona sem precisar do id
// numérico da query string (?sellers=NNNN) que aparece quando se navega pelo
// site.
export async function fetchSellerInfo(name){
  const slug=slugify(name);
  if(!slug)return null;
  try{
    const res=await fetch(`${BASE}/sebos-e-livreiros/${slug}`,{headers:FETCH_HEADERS});
    if(!res.ok)return null;
    const html=await res.text();
    const idx=html.indexOf('distributionAddress');
    if(idx===-1)return {name,slug,code:'',city:'',state:'',checkedAt:new Date().toISOString()};
    const janela=html.slice(idx,idx+400);
    const antes=html.slice(Math.max(0,idx-600),idx);
    const city=(janela.match(/"city":"([^"]*)"/)||[])[1]||'';
    const state=(janela.match(/"state":"([^"]{0,4})"/)||[])[1]||'';
    const code=(antes.match(/"code":"(\d+)"/)||[])[1]||'';
    return {name,slug,code,city:decodeEntities(city),state,checkedAt:new Date().toISOString()};
  }catch{return null}
}

export function skuFromLink(link){return (String(link||'').match(/\/livro\/([^/?]+)/)||[])[1]||''}
