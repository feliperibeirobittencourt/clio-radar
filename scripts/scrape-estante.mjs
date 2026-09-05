import fs from 'node:fs/promises';
import path from 'node:path';
import {slugify,fetchSellerName,fetchSellerInfo,skuFromLink} from './lib/estante-vendedor.mjs';
import {BASE,FETCH_HEADERS,extractYear,price,extractCards,fetchSearchPage} from './lib/estante-busca.mjs';

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
// A busca ordena por "anunciado mais recentemente", não pelo ano do livro —
// reedições modernas (muito mais anunciadas que exemplares antigos de
// verdade) enchem a página 1 e empurram achados elegíveis pra páginas
// seguintes, que a rodada diária (PAGES=1) nunca revisita. ESTANTE_PAGES>1
// serve só pra uma varredura pontual (backfill) desencalhar esse estoque
// parado; no dia a dia 1 página já cobre o que é publicado de fato novo.
const PAGES=Math.max(1,Number(process.env.ESTANTE_PAGES)||1);
const PAGE_DELAY_MS=Number(process.env.ESTANTE_PAGE_DELAY_MS)||8_000;
const IMAGE_BASE='https://static.estantevirtual.com.br';
const HEADERS=['Autor','Grupo','Título','Ano','Preço (R$)','Na janela 1850-1930?','Link','Imagem','Status','Verificado em','Visto em','Vendedor'];

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>String(v??'').normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

function brtStamp(d){const brt=new Date(d.getTime()-3*3600000),pad=n=>String(n).padStart(2,'0');return `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth()+1)}-${pad(brt.getUTCDate())} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`}

function parseDelimitedRows(text){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===','&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text){const rows=parseDelimitedRows(text);if(rows.length<1)return[];const headers=rows[0].map(h=>String(h).trim());return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}
function csvField(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function toCSV(rows){return [HEADERS.join(','),...rows.map(r=>HEADERS.map(h=>csvField(r[h])).join(','))].join('\n')+'\n'}

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

// Só usada se um card vier sem link direto (hoje extractCards já exige
// href "/livro/…", então isso é rede de segurança, não o caminho normal).
// Levar só o autor (sem o título) faz cair na página com TODOS os livros
// do autor — o próprio usuário reportou isso como confuso; incluir o
// título deixa a busca muito mais específica.
function searchFallbackLink(author,title,year){return `${BASE}/busca?nsCat=Natural&q=${encodeURIComponent(`${author} ${title}`)}&searchField=titulo-autor&ano-de-publicacao=${encodeURIComponent(year)}`}
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
      const cards=[];
      for(let page=1;page<=PAGES;page++){
        const html=await fetchSearchPage(a.name,{searchField:'autor',page});
        const pageCards=extractCards(html);
        cards.push(...pageCards);
        // página vazia (ou já repetindo o fim da paginação) — nada mais a
        // buscar pra esse autor, mesma lógica do backfill de leilão irmão.
        if(!pageCards.length)break;
        if(page<PAGES)await sleep(PAGE_DELAY_MS);
      }
      const years=cards.map(c=>c.year||extractYear(c.title)).filter(Boolean);
      const eligible=years.filter(y=>y<=MAX_YEAR);
      totalCards+=cards.length;totalWithYear+=years.length;totalEligible+=eligible.length;
      console.log(`[${i+1}/${authors.length}] ${a.name}: ${cards.length} cards, ${years.length} com ano, ${eligible.length} elegíveis (<=${MAX_YEAR})${years.length?` — anos: ${[...years].sort((x,y)=>x-y).join(',')}`:''}`);
      for(const c of cards){
        const year=c.year||extractYear(c.title);
        if(!year||year>MAX_YEAR)continue;
        const link=c.href?`${BASE}${c.href}`:searchFallbackLink(a.name,c.title,year);
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
          const sku=skuFromLink(c.href);
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
