import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.cwd());
const RAW=path.join(ROOT,'raw');
const HOJE_FILE=path.join(RAW,'estante-hoje.csv');
const HIST_FILE=path.join(RAW,'estante-historico.csv');
const EXCLUSOES_FILE=path.join(RAW,'estante-exclusoes.csv');
const STATUS_FILE=path.join(RAW,'estante-status.json');
const VENDEDORES_FILE=path.join(RAW,'estante-vendedores.json');
const AUTHORS_FILE=path.join(ROOT,'data','authors.json');

const MAX_YEAR=Number(process.env.ESTANTE_MAX_YEAR)||1940;
const DELAY_MS=Number(process.env.ESTANTE_DELAY_MS)||60_000;
const IMAGE_DELAY_MS=Number(process.env.ESTANTE_IMAGE_DELAY_MS)||3_000;
const SELLER_DELAY_MS=Number(process.env.ESTANTE_SELLER_DELAY_MS)||2_000;
const BASE='https://www.estantevirtual.com.br';
const IMAGE_BASE='https://static.estantevirtual.com.br';
const HEADERS=['Autor','Grupo','Título','Ano','Preço (R$)','Na janela 1850-1930?','Link','Imagem','Status','Verificado em','Visto em','Vendedor'];

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>String(v??'').normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const slugify=v=>norm(v).replace(/\s+/g,'-');
const extractYear=v=>{const m=String(v??'').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);return m?Number(m.at(-1)):null};
function price(v){if(v==null||v==='')return null;let s=String(v).trim().replace(/[R$\s]/g,'').replace(/[^\d,.\-]/g,'');if(!s)return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=d>c?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');else if(c>=0)s=(s.length-c-1===2)?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(d>=0&&s.length-d-1!==2)s=s.replace(/\./g,'');const n=Number(s);return Number.isFinite(n)?n:null}
function decodeEntities(s){return String(s??'').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}

function brtStamp(d){const brt=new Date(d.getTime()-3*3600000),pad=n=>String(n).padStart(2,'0');return `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth()+1)}-${pad(brt.getUTCDate())} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`}

function parseDelimitedRows(text){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===','&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text){const rows=parseDelimitedRows(text);if(rows.length<1)return[];const headers=rows[0].map(h=>String(h).trim());return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}
function csvField(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function toCSV(rows){return [HEADERS.join(','),...rows.map(r=>HEADERS.map(h=>csvField(r[h])).join(','))].join('\n')+'\n'}

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

const FETCH_HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

async function fetchSearchPage(author){
  // searchField=autor restringe a busca ao campo de autor (em vez de busca livre
  // por qualquer campo do anúncio), evitando ruído de livros que só mencionam o
  // nome por acaso — mesmo ajuste já validado no monitor Python irmão.
  const url=`${BASE}/busca?q=${encodeURIComponent(author)}&searchField=autor&tipo-de-livro=usado&_preco=3000-10000000&pagina=1&sort=new-releases`;
  const res=await fetch(url,{headers:FETCH_HEADERS});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchCoverImage(productUrl){
  try{
    const res=await fetch(productUrl,{headers:FETCH_HEADERS});
    if(!res.ok)return '';
    const html=await res.text();
    const m=html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)||html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if(!m)return '';
    const raw=m[1];
    if(/indisponivel/i.test(raw))return '';
    return raw.startsWith('http')?raw:`${IMAGE_BASE}${raw}`;
  }catch{return ''}
}

// A busca por autor não mostra qual sebo/livraria está vendendo cada anúncio
// (só um id genérico da plataforma) — só a página do próprio livro mostra o
// vendedor de verdade, embutido num bloco JSON de rastreamento.
async function fetchSellerName(sku){
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
async function fetchSellerInfo(name){
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

function searchFallbackLink(author,year){return `${BASE}/busca?nsCat=Natural&q=${encodeURIComponent(author)}&searchField=titulo-autor&ano-de-publicacao=${encodeURIComponent(year)}`}
function groupLabel(g){return g==='patrons'?'Patrono':'Fundador'}
function rowKey(r){return r['Link']?norm(r['Link']):norm(`${r['Autor']}|${r['Título']}|${r['Ano']}`)}

async function main(){
  const authors=JSON.parse(await fs.readFile(AUTHORS_FILE,'utf8'));
  let exclusoesText='';
  try{exclusoesText=await fs.readFile(EXCLUSOES_FILE,'utf8')}catch{}
  // Itens marcados como erro (autor errado, edição irrelevante etc.) nunca mais
  // devem reentrar em hoje.csv/historico.csv, mesmo que a busca os encontre de
  // novo — ver scripts/recheck-estante.mjs para o fluxo de como adicionar aqui.
  const exclusoesSet=new Set((exclusoesText?readCSV(exclusoesText):[]).map(rowKey));
  let existingHistoryText='';
  try{existingHistoryText=await fs.readFile(HIST_FILE,'utf8')}catch{}
  const existingHistory=(existingHistoryText?readCSV(existingHistoryText):[]).filter(r=>!exclusoesSet.has(rowKey(r)));
  const historySet=new Set(existingHistory.map(rowKey));
  const imageByKey=new Map(existingHistory.map(r=>[rowKey(r),r['Imagem']||'']));
  const statusByKey=new Map(existingHistory.map(r=>[rowKey(r),r['Status']||'ativo']));
  const verifiedByKey=new Map(existingHistory.map(r=>[rowKey(r),r['Verificado em']||'']));
  const vendedorByKey=new Map(existingHistory.map(r=>[rowKey(r),r['Vendedor']||'']));

  // Cache de dados de vendedor (nome->cidade/estado/código), persistido entre
  // execuções — visitar a página de um sebo já visto antes é desperdício, e
  // esse endereço praticamente nunca muda.
  let vendedores=new Map();
  try{
    const raw=JSON.parse(await fs.readFile(VENDEDORES_FILE,'utf8'));
    vendedores=new Map(Object.entries(raw));
  }catch{}

  const hojeRows=[],newRows=[];
  let failures=0,imagesFetched=0,sellersFetched=0,totalCards=0,totalWithYear=0,totalEligible=0;

  for(let i=0;i<authors.length;i++){
    const a=authors[i];
    try{
      const html=await fetchSearchPage(a.name);
      const cards=extractCards(html);
      const years=cards.map(c=>c.year||extractYear(c.title)).filter(Boolean);
      const eligible=years.filter(y=>y<=MAX_YEAR);
      totalCards+=cards.length;totalWithYear+=years.length;totalEligible+=eligible.length;
      console.log(`[${i+1}/${authors.length}] ${a.name}: ${cards.length} cards, ${years.length} com ano, ${eligible.length} elegíveis (<=${MAX_YEAR})${years.length?` — anos: ${[...years].sort((x,y)=>x-y).join(',')}`:''}`);
      for(const c of cards){
        const year=c.year||extractYear(c.title);
        if(!year||year>MAX_YEAR)continue;
        const link=c.href?`${BASE}${c.href}`:searchFallbackLink(a.name,year);
        // .toFixed(2) evita ambiguidade na releitura: um preço tipo 106.2 (JS
        // derruba o zero à direita) seria mal interpretado como separador de
        // milhar por build-data.mjs e viraria 1062 em vez de 106,20.
        const row={'Autor':a.name,'Grupo':groupLabel(a.group),'Título':c.title,'Ano':year,'Preço (R$)':c.price!=null?c.price.toFixed(2):'','Na janela 1850-1930?':(year>=1850&&year<=1930)?'SIM':'','Link':link,'Imagem':'','Status':'ativo','Verificado em':'','Visto em':brtStamp(new Date()),'Vendedor':''};
        const key=rowKey(row);
        if(exclusoesSet.has(key))continue;
        const isNew=!historySet.has(key);
        if(!isNew){
          row['Imagem']=imageByKey.get(key)||'';
          // preserva o status confirmado pela rotina de recheck (scripts/recheck-estante.mjs),
          // em vez de reabrir como "ativo" só porque reapareceu numa busca.
          row['Status']=statusByKey.get(key)||'ativo';
          row['Verificado em']=verifiedByKey.get(key)||'';
          row['Vendedor']=vendedorByKey.get(key)||'';
        }else if(c.href){
          row['Imagem']=await fetchCoverImage(link);
          imagesFetched++;
          await sleep(IMAGE_DELAY_MS);
          // Vendedor: busca APENAS pra achados novos — cada um exige visitar a
          // página do livro, e a página do sebo em si só se ainda não estiver
          // em cache (mesmo vendedor pode aparecer em dezenas de anúncios).
          const sku=(c.href.match(/\/livro\/([^/?]+)/)||[])[1]||'';
          const sellerName=await fetchSellerName(sku);
          if(sellerName){
            row['Vendedor']=sellerName;
            const slug=slugify(sellerName);
            if(!vendedores.has(slug)){
              const info=await fetchSellerInfo(sellerName);
              if(info)vendedores.set(slug,info);
              await sleep(SELLER_DELAY_MS);
            }
          }
          sellersFetched++;
          await sleep(SELLER_DELAY_MS);
        }
        hojeRows.push(row);
        if(isNew){historySet.add(key);imageByKey.set(key,row['Imagem']);statusByKey.set(key,row['Status']);verifiedByKey.set(key,row['Verificado em']);vendedorByKey.set(key,row['Vendedor']);newRows.push(row)}
      }
    }catch(e){
      failures++;
      console.warn(`Falha ao buscar "${a.name}": ${e.message}`);
    }
    if(i<authors.length-1)await sleep(DELAY_MS);
  }

  const updatedHistory=[...existingHistory,...newRows];
  await fs.mkdir(RAW,{recursive:true});
  await fs.writeFile(HOJE_FILE,toCSV(hojeRows));
  await fs.writeFile(HIST_FILE,toCSV(updatedHistory));
  await fs.writeFile(VENDEDORES_FILE,JSON.stringify(Object.fromEntries(vendedores),null,2));
  await fs.writeFile(STATUS_FILE,JSON.stringify({lastRun:new Date().toISOString(),authorsSearched:authors.length,authorFailures:failures,foundToday:hojeRows.length,newToday:newRows.length,imagesFetched,sellersFetched,totalHistory:updatedHistory.length,totalCardsSeen:totalCards,totalWithYear,totalEligible},null,2));

  console.log(`Concluído. Cards vistos: ${totalCards} · Com ano: ${totalWithYear} · Elegíveis (<=${MAX_YEAR}): ${totalEligible} · Hoje: ${hojeRows.length} · Novos no histórico: ${newRows.length} · Imagens buscadas: ${imagesFetched} · Vendedores consultados: ${sellersFetched} (${vendedores.size} no diretório) · Total histórico: ${updatedHistory.length} · Falhas de busca: ${failures}.`);
}

await main();
