import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.cwd());
const HIST_FILE=process.env.ESTANTE_HISTORY_FILE?path.resolve(process.env.ESTANTE_HISTORY_FILE):path.join(ROOT,'raw','estante-historico.csv');
const SCOPE=(process.env.RECHECK_SCOPE||'window').toLowerCase(); // 'window' (janela 1850-1930, diário) | 'all' (semanal)
const DELAY_MS=Number(process.env.RECHECK_DELAY_MS)||3_000;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function parseDelimitedRows(text){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===','&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text){const rows=parseDelimitedRows(text);if(rows.length<1)return{headers:[],rows:[]};const headers=rows[0].map(h=>String(h).trim());return{headers,rows:rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}}
function csvField(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function toCSV(headers,rows){return [headers.join(','),...rows.map(r=>headers.map(h=>csvField(r[h])).join(','))].join('\n')+'\n'}
function brtStamp(d){const brt=new Date(d.getTime()-3*3600000),pad=n=>String(n).padStart(2,'0');return `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth()+1)}-${pad(brt.getUTCDate())} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`}

const FETCH_HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

// Textos comuns em anúncios encerrados/vendidos em marketplaces brasileiros.
// Este regex não pôde ser validado contra o HTML real da Estante Virtual (o
// ambiente onde este script foi escrito não tem acesso ao site); por isso o
// critério é conservador por design — veja checkLink().
const CLOSED_HINTS=/produto indispon[íi]vel|an[úu]ncio encerrado|n[ãa]o est[áa] mais dispon[íi]vel|item indispon[íi]vel|p[áa]gina n[ãa]o encontrada/i;

// Confere se o link de um anúncio ainda resolve para um produto ativo.
// Critério conservador: só devolve 'vendido' com um sinal explícito (HTTP 404
// ou texto de indisponibilidade). Qualquer resposta ambígua (erro de rede,
// bloqueio, 5xx) devolve null e o item mantém o status anterior, para ser
// reconferido no próximo ciclo — melhor um falso "ainda ativo" temporário do
// que marcar como vendido algo que só falhou por instabilidade.
async function checkLink(url){
  try{
    const res=await fetch(url,{headers:FETCH_HEADERS,redirect:'follow'});
    if(res.status===404)return'vendido';
    if(!res.ok)return null;
    const html=await res.text();
    return CLOSED_HINTS.test(html)?'vendido':'ativo';
  }catch{
    return null;
  }
}

async function main(){
  const text=await fs.readFile(HIST_FILE,'utf8').catch(()=>'');
  if(!text){console.log('Sem histórico da Estante Virtual para reconferir ainda.');return}

  const {headers,rows}=readCSV(text);
  if(!headers.includes('Status'))headers.push('Status');
  if(!headers.includes('Verificado em'))headers.push('Verificado em');

  const candidates=rows.filter(r=>r['Link']&&r['Status']!=='vendido'&&(SCOPE==='all'||r['Na janela 1850-1930?']==='SIM'));
  console.log(`Reconferindo ${candidates.length} de ${rows.length} anúncio(s) no histórico (escopo: ${SCOPE}).`);

  let checked=0,sold=0,unsure=0;
  for(let i=0;i<candidates.length;i++){
    const r=candidates[i];
    const result=await checkLink(r['Link']);
    if(result){
      r['Status']=result;
      r['Verificado em']=brtStamp(new Date());
      checked++;
      if(result==='vendido')sold++;
    }else{
      unsure++;
    }
    if(i<candidates.length-1)await sleep(DELAY_MS);
  }

  await fs.writeFile(HIST_FILE,toCSV(headers,rows));
  console.log(`Concluído. Verificados: ${checked} · Confirmados vendidos agora: ${sold} · Resposta incerta (status mantido): ${unsure}.`);
}

await main();
