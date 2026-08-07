import fs from 'node:fs/promises';
import path from 'node:path';
import {slugify,fetchSellerName,fetchSellerInfo,skuFromLink} from './lib/estante-vendedor.mjs';

const ROOT=path.resolve(process.cwd());
const RAW=path.join(ROOT,'raw');
const HIST_FILE=path.join(RAW,'estante-historico.csv');
const VENDEDORES_FILE=path.join(RAW,'estante-vendedores.json');

// Mesmo espírito das outras pausas do projeto: nada de martelar o site. Um
// pouco mais rápido que o scraper diário (que espera 1 min entre AUTORES,
// cada um trazendo dezenas de resultados de uma vez) porque aqui cada
// requisição é 1 livro só — mas ainda assim, gentil.
const DELAY_MS=Number(process.env.ESTANTE_BACKFILL_DELAY_MS)||2_500;
// Processa tudo que faltar por padrão; existe só como válvula de escape caso
// precise interromper um backfill grande em pedaços menores.
const LIMIT=Number(process.env.ESTANTE_BACKFILL_LIMIT)||Infinity;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parseDelimitedRows(text){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===','&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text){const rows=parseDelimitedRows(text);if(rows.length<1)return{headers:[],rows:[]};const headers=rows[0].map(h=>String(h).trim());return{headers,rows:rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}}
function csvField(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function toCSV(headers,rows){return [headers.join(','),...rows.map(r=>headers.map(h=>csvField(r[h])).join(','))].join('\n')+'\n'}

async function main(){
  const text=await fs.readFile(HIST_FILE,'utf8').catch(()=>'');
  if(!text){console.log('Sem histórico da Estante Virtual ainda.');return}
  const {headers,rows}=readCSV(text);
  if(!headers.includes('Vendedor'))headers.push('Vendedor');

  let vendedores=new Map();
  try{vendedores=new Map(Object.entries(JSON.parse(await fs.readFile(VENDEDORES_FILE,'utf8'))))}catch{}

  // Só livros com página própria (link "/livro/<sku>") têm de onde extrair o
  // vendedor — anúncios sem página própria (link de busca genérico, usado
  // quando o achado original não tinha link direto) ficam sem essa info.
  const pendentes=rows.filter(r=>!r['Vendedor']&&skuFromLink(r['Link']));
  const alvo=Number.isFinite(LIMIT)?pendentes.slice(0,LIMIT):pendentes;
  console.log(`Histórico: ${rows.length} linha(s). Sem vendedor e com página própria: ${pendentes.length}. Processando: ${alvo.length}.`);

  let achados=0,semVendedor=0,vendedoresNovos=0;
  for(let i=0;i<alvo.length;i++){
    const r=alvo[i];
    const sku=skuFromLink(r['Link']);
    const sellerName=await fetchSellerName(sku);
    if(sellerName){
      r['Vendedor']=sellerName;
      achados++;
      const slug=slugify(sellerName);
      if(!vendedores.has(slug)){
        await sleep(DELAY_MS);
        const info=await fetchSellerInfo(sellerName);
        if(info){vendedores.set(slug,info);vendedoresNovos++}
      }
    }else{
      semVendedor++;
    }
    if((i+1)%25===0||i===alvo.length-1){
      console.log(`[${i+1}/${alvo.length}] com vendedor: ${achados} · sem sucesso: ${semVendedor} · vendedores no diretório: ${vendedores.size}`);
      // salva parcial a cada lote — se o job for interrompido no meio (limite
      // de tempo do runner, falha de rede persistente etc.), o progresso feito
      // até ali não se perde e uma nova rodada retoma dali.
      await fs.writeFile(HIST_FILE,toCSV(headers,rows));
      await fs.writeFile(VENDEDORES_FILE,JSON.stringify(Object.fromEntries(vendedores),null,2));
    }
    await sleep(DELAY_MS);
  }

  await fs.writeFile(HIST_FILE,toCSV(headers,rows));
  await fs.writeFile(VENDEDORES_FILE,JSON.stringify(Object.fromEntries(vendedores),null,2));
  console.log(`Concluído. Processados: ${alvo.length} · Vendedor encontrado: ${achados} · Sem sucesso: ${semVendedor} · Vendedores novos no diretório: ${vendedoresNovos} · Total no diretório: ${vendedores.size} · Ainda pendentes (fora do limite desta rodada): ${pendentes.length-alvo.length}.`);
}

await main();
