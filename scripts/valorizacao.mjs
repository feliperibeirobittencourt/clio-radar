import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.cwd());
const COLLECTION_FILE=path.join(ROOT,'data','collection.json');
const ESTANTE_FILE=path.join(ROOT,'raw','estante-historico.csv');
const IPCA_FILE=path.join(ROOT,'raw','ipca.json');
const OUT_HISTORICO=path.join(ROOT,'data','valorizacao.json');
const OUT_DETALHE=path.join(ROOT,'raw','valorizacao-detalhe.json');
const MARKET_URL=process.env.MARKET_URL||'https://raw.githubusercontent.com/feliperibeirobittencourt/monitor-leiloes/refs/heads/main/leiloes.csv';

// ---- mesmo pipeline de normalização usado no app (index.html) ----
const norm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function stripListingNoise(s){return s.replace(/^livro\s*/,'').replace(/^raro\s*-?\s*/,'').replace(/\b\d+\s*[aoªº]?\s*edicao\b/g,' ').replace(/\bvolume\s+[ivxlcdm\d]+\b/g,' ').replace(/\b\d+\s+volumes?\b/g,' ').replace(/\s+/g,' ').trim()}
function archaicSpelling(s){return s.replace(/ph/g,'f').replace(/th/g,'t').replace(/(ll|tt|pp|cc|mm|nn|bb|dd|ff|gg)/g,m=>m[0]).replace(/pt/g,'t').replace(/ct/g,'t').replace(/y/g,'i').replace(/z/g,'s')}
function canon(v){return archaicSpelling(stripListingNoise(norm(v)))}

// Palavras de anúncio (raridade, estado de conservação etc.) que aparecem em
// QUALQUER posição do texto, não só como prefixo — diferente do que
// stripListingNoise já cobre. Servem só pra decidir se um comparável tem
// "conteúdo extra" de verdade (ex.: outro título de livro junto, sinal de
// que é uma coletânea) ou só ruído descritivo do anúncio.
const PALAVRAS_RUIDO=new Set(['antigo','antiga','raro','rara','raridade','exemplar','otimo','otima','bom','boa','estado','conservado','conservada','original','completo','completa','ilustrado','ilustrada','capa','dura','brochura','encadernado','encadernada','edicao','tomo','volume','livro','obra','conjunto','colecao']);
function tokensSignificativos(v){return canon(v).split(' ').filter(x=>x.length>3&&!PALAVRAS_RUIDO.has(x))}

// "Vol. II" e "Tomo VI" do mesmo título/autor/ano são LIVROS DIFERENTES (tomos
// de uma obra em vários volumes) — texto e valor não têm nada a ver um com o
// outro. stripListingNoise() apaga essa marcação de propósito (serve pra "eu
// tenho alguma edição"), mas pra comparável de preço isso é o oposto do que
// se quer: dois tomos diferentes não são comparáveis entre si.
function marcadorVolume(v){const s=norm(v);const m=s.match(/\b(?:vol|volume|tomo)\.?\s*([ivxlcdm]+|\d+)\b/);return m?m[1]:null}

function parseDelimitedRows(text,delim){text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){field+='"';i++}else if(c==='"')quote=!quote;else if(c===delim&&!quote){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[]}else field+=c}row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows}
function readCSV(text,delim=','){const rows=parseDelimitedRows(text,delim);if(rows.length<1)return[];const headers=rows[0].map(h=>String(h).trim());return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()])))}
function price(v){if(v==null||v==='')return null;let s=String(v).trim().replace(/[R$\s]/g,'').replace(/[^\d,.\-]/g,'');if(!s)return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=d>c?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');else if(c>=0)s=(s.length-c-1===2)?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(d>=0&&s.length-d-1!==2)s=s.replace(/\./g,'');const n=Number(s);return Number.isFinite(n)?n:null}
function median(arr){const s=[...arr].sort((a,b)=>a-b);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2}

async function main(){
  const ipca=JSON.parse(await fs.readFile(IPCA_FILE,'utf8'));
  const ultimoMes=ipca.serie[ipca.serie.length-1].mes;
  const fatorPorMes=new Map();
  {
    let acc=1;
    fatorPorMes.set(ultimoMes,1);
    for(let i=ipca.serie.length-1;i>0;i--){
      acc*=1+ipca.serie[i].variacaoPct/100;
      fatorPorMes.set(ipca.serie[i-1].mes,acc);
    }
  }
  function fatorCorrecao(dataISO){
    if(!dataISO)return null;
    let mes=dataISO.slice(0,7);
    if(mes>ultimoMes)mes=ultimoMes; // data futura/mês ainda sem IPCA publicado: sem correção
    if(mes<ipca.serie[0].mes)mes=ipca.serie[0].mes;
    return fatorPorMes.get(mes)??1;
  }

  const collection=JSON.parse(await fs.readFile(COLLECTION_FILE,'utf8')).filter(c=>c.owned);

  const leiloesText=await(await fetch(MARKET_URL,{headers:{'user-agent':'CLIO-Radar-Valorizacao/1.0'}})).text();
  const leiloesRows=readCSV(leiloesText,';');
  function dataPregaoToISO(s){const m=String(s||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`:null}
  const leilaoComps=leiloesRows
    .filter(r=>r['Status']==='vendido'&&price(r['Valor final (R$)'])!=null)
    .map(r=>({author:r['Autor'],title:r['Título'],year:Number(r['Ano'])||null,price:price(r['Valor final (R$)']),date:dataPregaoToISO(r['Data do pregão']),source:'leilao'}))
    .filter(c=>c.date);

  const estanteText=await fs.readFile(ESTANTE_FILE,'utf8').catch(()=>'');
  const estanteRows=estanteText?readCSV(estanteText,','):[];
  function brtStampToISO(s){const m=String(s||'').match(/(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null}
  const estanteComps=estanteRows
    .filter(r=>r['Status']==='vendido'&&price(r['Preço (R$)'])!=null)
    .map(r=>({author:r['Autor'],title:r['Título'],year:Number(r['Ano'])||null,price:price(r['Preço (R$)']),date:brtStampToISO(r['Verificado em']||r['Visto em']),source:'estante'}))
    .filter(c=>c.date);

  const compsPrep=[...leilaoComps,...estanteComps].map(c=>({...c,authorNorm:norm(c.author),titleTokensLimpos:tokensSignificativos(c.title)}));

  function findComps(item){
    const authorKey=norm(item.author);
    const titleTokens=tokensSignificativos(item.title).slice(0,8);
    if(!authorKey||!titleTokens.length||!item.year)return [];
    return compsPrep.filter(c=>{
      // Mesmo título/autor não basta: clássicos como "Dom Casmurro" foram
      // reeditados por mais de um século, e uma reedição comum vale uma
      // fração de uma primeira edição — sem exigir o MESMO ano de edição,
      // o "comparável" mistura exemplares completamente diferentes.
      if(c.year!==item.year)return false;
      if(!c.authorNorm)return false;
      if(!(c.authorNorm.includes(authorKey)||authorKey.includes(c.authorNorm)))return false;
      const ctTokens=c.titleTokensLimpos,overlap=titleTokens.filter(t=>ctTokens.includes(t)).length;
      if(overlap<Math.min(2,titleTokens.length))return false;
      // Título curto é fácil demais de casar por acidente com uma coletânea
      // que junta esse título com outro. Se o comparável tem conteúdo
      // significativo de sobra muito maior que o próprio título procurado,
      // provavelmente é outra coisa (coletânea, obra completa), não a mesma
      // edição isolada.
      if(ctTokens.length-overlap>titleTokens.length)return false;
      const mi=marcadorVolume(item.title),mc=marcadorVolume(c.title);
      if(mi&&mc&&mi!==mc)return false;
      return true;
    });
  }

  const results=[];
  for(const item of collection){
    const temCusto=item.value!=null&&item.acquired;
    const custoCorrigido=temCusto?item.value*fatorCorrecao(item.acquired):null;
    const comps=findComps(item);
    const compsAjustados=comps.map(c=>c.price*fatorCorrecao(c.date));
    // Comparável único não é comparável de verdade — é só um ponto, sem
    // nenhuma proteção contra erro de casamento (tomo errado, estado de
    // conservação muito diferente etc.). Exige pelo menos 2 vendas
    // concordando antes de tratar como sinal confiável de mercado.
    const valorMercadoReal=compsAjustados.length>=2?median(compsAjustados):null;
    results.push({bookId:item.bookId,author:item.author,title:item.title,year:item.year,valorPago:item.value??null,acquired:item.acquired??null,custoCorrigido,valorMercadoReal,nComps:comps.length});
  }

  const comAmbos=results.filter(r=>r.custoCorrigido&&r.valorMercadoReal);
  const multiplicadores=comAmbos.map(r=>r.valorMercadoReal/r.custoCorrigido);
  const multiplicadorMediano=multiplicadores.length?median(multiplicadores):1;

  for(const r of results){
    if(r.custoCorrigido==null){r.valorEstimado=r.valorMercadoReal??null;r.confianca=r.valorMercadoReal!=null?'real_sem_custo':'sem_dado';continue}
    if(r.valorMercadoReal!=null){r.valorEstimado=r.valorMercadoReal;r.confianca='real'}
    else{r.valorEstimado=r.custoCorrigido*multiplicadorMediano;r.confianca='extrapolado'}
  }

  const comCusto=results.filter(r=>r.custoCorrigido!=null);
  const totalPagoNominal=comCusto.reduce((s,r)=>s+r.valorPago,0);
  const totalPagoCorrigido=comCusto.reduce((s,r)=>s+r.custoCorrigido,0);
  const totalEstimadoHoje=comCusto.reduce((s,r)=>s+r.valorEstimado,0);
  const nReal=comCusto.filter(r=>r.confianca==='real').length;
  const nExtrapolado=comCusto.filter(r=>r.confianca==='extrapolado').length;
  const semCusto=results.length-comCusto.length;

  const snapshot={
    mes:ultimoMes,
    geradoEm:new Date().toISOString(),
    itensPossuidos:results.length,
    itensComCusto:comCusto.length,
    itensSemCusto:semCusto,
    itensComComparavelReal:nReal,
    itensExtrapolados:nExtrapolado,
    multiplicadorMediano,
    totalPagoNominal,
    totalPagoCorrigido,
    totalEstimadoHoje,
    valorizacaoSobreCorrigidoPct:totalPagoCorrigido?(totalEstimadoHoje/totalPagoCorrigido-1)*100:null,
    valorizacaoSobreNominalPct:totalPagoNominal?(totalEstimadoHoje/totalPagoNominal-1)*100:null,
  };

  let historico=[];
  try{historico=JSON.parse(await fs.readFile(OUT_HISTORICO,'utf8'))}catch{}
  historico=historico.filter(h=>h.mes!==snapshot.mes);
  historico.push(snapshot);
  historico.sort((a,b)=>a.mes.localeCompare(b.mes));

  await fs.mkdir(path.dirname(OUT_HISTORICO),{recursive:true});
  await fs.writeFile(OUT_HISTORICO,JSON.stringify(historico,null,2));
  await fs.writeFile(OUT_DETALHE,JSON.stringify(results,null,2));

  console.log(`Snapshot ${snapshot.mes}: ${comCusto.length} itens com custo (${nReal} com comparável real, ${nExtrapolado} extrapolados) · pago corrigido R$ ${totalPagoCorrigido.toFixed(2)} · estimado hoje R$ ${totalEstimadoHoje.toFixed(2)} (${snapshot.valorizacaoSobreCorrigidoPct.toFixed(1)}%).`);
}

await main();
