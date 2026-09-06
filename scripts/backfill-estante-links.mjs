import fs from 'node:fs/promises';
import path from 'node:path';
import {BASE,extractCards,fetchSearchPage} from './lib/estante-busca.mjs';

const ROOT=path.resolve(process.cwd());
const RAW=path.join(ROOT,'raw');
const HIST_FILE=path.join(RAW,'estante-historico.csv');

// Mesmo espírito das outras pausas do projeto: cada rodada é 1 busca (leve),
// mas não convém martelar o site.
const DELAY_MS=Number(process.env.ESTANTE_LINKS_DELAY_MS)||3_000;
// Processa tudo que faltar por padrão; existe só como válvula de escape caso
// precise interromper um backfill grande em pedaços menores.
const LIMIT=Number(process.env.ESTANTE_LINKS_LIMIT)||Infinity;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>String(v??'').normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function stripListingNoise(s){return s.replace(/^livro\s*/,'').replace(/^raro\s*-?\s*/,'').replace(/\b\d+\s*[aoªº]?\s*edicao\b/g,' ').replace(/\bvolume\s+[ivxlcdm\d]+\b/g,' ').replace(/\b\d+\s+volumes?\b/g,' ').replace(/\s+/g,' ').trim()}
function canon(v){return stripListingNoise(norm(v))}

function parseDelimitedRows(text){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===','&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text){const rows=parseDelimitedRows(text);if(rows.length<1)return{headers:[],rows:[]};const headers=rows[0].map(h=>String(h).trim());return{headers,rows:rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}}
function csvField(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function toCSV(headers,rows){return [headers.join(','),...rows.map(r=>headers.map(h=>csvField(r[h])).join(','))].join('\n')+'\n'}

// Link de busca melhor que o antigo (só autor): inclui o título, então mesmo
// sem achar o link direto, quem clicar cai numa busca bem mais específica em
// vez de ter que vasculhar tudo daquele autor.
function fallbackLink(author,title,year){return `${BASE}/busca?nsCat=Natural&q=${encodeURIComponent(`${author} ${title}`)}&searchField=titulo-autor&ano-de-publicacao=${encodeURIComponent(year)}`}

async function acharLinkDireto(row){
  const author=row['Autor'],title=row['Título'],year=Number(row['Ano'])||null;
  const html=await fetchSearchPage(`${author} ${title}`,{searchField:'titulo-autor',page:1,ano:year});
  const cards=extractCards(html);
  const titleTokens=canon(title).split(' ').filter(x=>x.length>3);
  const authorKey=norm(author);
  let melhor=null,melhorScore=-1;
  for(const c of cards){
    if(year&&c.year&&c.year!==year)continue;
    if(c.cardAuthor&&norm(c.cardAuthor)&&!(norm(c.cardAuthor).includes(authorKey)||authorKey.includes(norm(c.cardAuthor))))continue;
    const ct=canon(c.title),overlap=titleTokens.filter(t=>ct.includes(t)).length;
    if(!titleTokens.length||overlap<Math.min(2,titleTokens.length))continue;
    const score=overlap-Math.abs(ct.split(' ').length-titleTokens.length)*0.1;
    if(score>melhorScore){melhorScore=score;melhor=c}
  }
  return melhor?`${BASE}${melhor.href}`:null;
}

async function main(){
  const text=await fs.readFile(HIST_FILE,'utf8').catch(()=>'');
  if(!text){console.log('Sem histórico da Estante Virtual ainda.');return}
  const {headers,rows}=readCSV(text);

  const pendentes=rows.filter(r=>!/\/livro\//.test(r['Link']||''));
  const alvo=Number.isFinite(LIMIT)?pendentes.slice(0,LIMIT):pendentes;
  console.log(`Histórico: ${rows.length} linha(s). Sem link direto: ${pendentes.length}. Processando: ${alvo.length}.`);

  let achados=0,melhorados=0,falhas=0;
  for(let i=0;i<alvo.length;i++){
    const r=alvo[i];
    try{
      const link=await acharLinkDireto(r);
      if(link){r['Link']=link;achados++}
      else{r['Link']=fallbackLink(r['Autor'],r['Título'],r['Ano']);melhorados++}
    }catch(e){
      falhas++;
      console.warn(`Falha em "${r['Autor']} — ${r['Título']}": ${e.message}`);
    }
    if((i+1)%25===0||i===alvo.length-1){
      console.log(`[${i+1}/${alvo.length}] link direto achado: ${achados} · só melhorado (autor+título): ${melhorados} · falhas: ${falhas}`);
      // salva parcial a cada lote — retomável se o job for interrompido no meio.
      await fs.writeFile(HIST_FILE,toCSV(headers,rows));
    }
    await sleep(DELAY_MS);
  }

  await fs.writeFile(HIST_FILE,toCSV(headers,rows));
  console.log(`Concluído. Processados: ${alvo.length} · Link direto achado: ${achados} · Só melhorado (autor+título, sem link direto): ${melhorados} · Falhas: ${falhas} · Ainda pendentes (fora do limite desta rodada): ${pendentes.length-alvo.length}.`);
}

await main();
