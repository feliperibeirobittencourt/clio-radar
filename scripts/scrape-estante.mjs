import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.cwd());
const RAW=path.join(ROOT,'raw');
const HOJE_FILE=path.join(RAW,'estante-hoje.csv');
const HIST_FILE=path.join(RAW,'estante-historico.csv');
const STATUS_FILE=path.join(RAW,'estante-status.json');
const AUTHORS_FILE=path.join(ROOT,'data','authors.json');

const MAX_YEAR=Number(process.env.ESTANTE_MAX_YEAR)||1940;
const DELAY_MS=Number(process.env.ESTANTE_DELAY_MS)||60_000;
const BASE='https://www.estantevirtual.com.br';
const HEADERS=['Autor','Grupo','Título','Ano','Preço (R$)','Na janela 1850-1930?','Link','Visto em'];

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>String(v??'').normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const extractYear=v=>{const m=String(v??'').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);return m?Number(m.at(-1)):null};
function price(v){if(v==null||v==='')return null;let s=String(v).trim().replace(/[R$\s]/g,'').replace(/[^\d,.\-]/g,'');if(!s)return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=d>c?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');else if(c>=0)s=(s.length-c-1===2)?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(d>=0&&s.length-d-1!==2)s=s.replace(/\./g,'');const n=Number(s);return Number.isFinite(n)?n:null}
function decodeEntities(s){return String(s??'').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}

function brtStamp(d){const brt=new Date(d.getTime()-3*3600000),pad=n=>String(n).padStart(2,'0');return `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth()+1)}-${pad(brt.getUTCDate())} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`}

function parseDelimitedRows(text){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===','&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text){const rows=parseDelimitedRows(text);if(rows.length<1)return[];const headers=rows[0].map(h=>String(h).trim());return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}
function csvField(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function toCSV(rows){return [HEADERS.join(','),...rows.map(r=>HEADERS.map(h=>csvField(r[h])).join(','))].join('\n')+'\n'}

function extractCards(html){
  const linkRe=/<a class="product-item__link[^"]*"[^>]*href="(\/livro\/[^"]+)"[^>]*title="([^"]*)"/g;
  const matches=[...html.matchAll(linkRe)];
  const seen=new Set(),cards=[];
  for(let idx=0;idx<matches.length;idx++){
    const m=matches[idx],href=m[1];
    if(seen.has(href))continue;
    seen.add(href);
    const title=decodeEntities(m[2]).trim();
    const start=m.index,end=idx+1<matches.length?matches[idx+1].index:Math.min(html.length,start+4000);
    const segment=html.slice(start,end);
    const authorMatch=segment.match(/product-item__author"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const yearMatch=segment.match(/product-item__year"[^>]*>\s*(\d{4})\s*<\/p>/);
    const priceMatch=segment.match(/A partir de R\$\s*([\d.,]+)/);
    cards.push({href,title,cardAuthor:authorMatch?decodeEntities(authorMatch[1]).trim():'',year:yearMatch?Number(yearMatch[1]):null,price:priceMatch?price(priceMatch[1]):null});
  }
  return cards;
}

async function fetchSearchPage(author){
  const url=`${BASE}/busca?q=${encodeURIComponent(author)}&tipo-de-livro=usado&_preco=3000-10000000&pagina=1&sort=new-releases`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'}});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function searchFallbackLink(author,year){return `${BASE}/busca?q=${encodeURIComponent(`${author} ${year}`)}`}
function groupLabel(g){return g==='patrons'?'Patrono':'Fundador'}
function rowKey(r){return r['Link']?norm(r['Link']):norm(`${r['Autor']}|${r['Título']}|${r['Ano']}`)}

async function main(){
  const authors=JSON.parse(await fs.readFile(AUTHORS_FILE,'utf8'));
  let existingHistoryText='';
  try{existingHistoryText=await fs.readFile(HIST_FILE,'utf8')}catch{}
  const existingHistory=existingHistoryText?readCSV(existingHistoryText):[];
  const historySet=new Set(existingHistory.map(rowKey));

  const hojeRows=[],newRows=[];
  let failures=0;

  for(let i=0;i<authors.length;i++){
    const a=authors[i];
    console.log(`[${i+1}/${authors.length}] Buscando: ${a.name}`);
    try{
      const html=await fetchSearchPage(a.name);
      const cards=extractCards(html);
      for(const c of cards){
        const year=c.year||extractYear(c.title);
        if(!year||year>MAX_YEAR)continue;
        const link=c.href?`${BASE}${c.href}`:searchFallbackLink(a.name,year);
        const row={'Autor':a.name,'Grupo':groupLabel(a.group),'Título':c.title,'Ano':year,'Preço (R$)':c.price??'','Na janela 1850-1930?':(year>=1850&&year<=1930)?'SIM':'','Link':link,'Visto em':brtStamp(new Date())};
        hojeRows.push(row);
        const key=rowKey(row);
        if(!historySet.has(key)){historySet.add(key);newRows.push(row)}
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
  await fs.writeFile(STATUS_FILE,JSON.stringify({lastRun:new Date().toISOString(),authorsSearched:authors.length,authorFailures:failures,foundToday:hojeRows.length,newToday:newRows.length,totalHistory:updatedHistory.length},null,2));

  console.log(`Concluído. Hoje: ${hojeRows.length} · Novos no histórico: ${newRows.length} · Total histórico: ${updatedHistory.length} · Falhas de busca: ${failures}.`);
}

await main();
