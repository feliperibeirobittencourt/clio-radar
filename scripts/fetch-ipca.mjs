import fs from 'node:fs/promises';
import path from 'node:path';

// Série 433 do SGS/Banco Central = IPCA, variação mensal (%). Fonte oficial,
// pública, sem necessidade de chave — mesmo índice usado por qualquer
// correção monetária no Brasil. Guardamos aqui em vez de buscar toda vez
// porque só um mês novo é publicado por mês (não faz sentido bater na API
// do Bacen a cada build) e porque a sandbox de desenvolvimento não tem
// acesso a api.bcb.gov.br — só o job do GitHub Actions que roda este
// script tem internet de verdade.
const OUT_FILE=path.join(path.resolve(process.cwd()),'raw','ipca.json');
const DATA_INICIAL='01/01/2014';

async function main(){
  const url=`https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=${DATA_INICIAL}`;
  const res=await fetch(url,{headers:{'User-Agent':'CLIO-Radar/1.0'}});
  if(!res.ok)throw new Error(`HTTP ${res.status} ao buscar IPCA`);
  const rows=await res.json();
  // rows: [{data:"01/2014", valor:"0.55"}, ...] — variação % daquele mês.
  const serie=rows.map(r=>{
    const [dia,mes,ano]=r.data.split('/');
    return {mes:`${ano}-${mes}`,variacaoPct:Number(r.valor)};
  }).filter(r=>Number.isFinite(r.variacaoPct));

  await fs.mkdir(path.dirname(OUT_FILE),{recursive:true});
  await fs.writeFile(OUT_FILE,JSON.stringify({fonte:'BCB SGS série 433 (IPCA mensal)',atualizadoEm:new Date().toISOString(),serie},null,2));
  console.log(`IPCA salvo: ${serie.length} meses, de ${serie[0]?.mes} até ${serie[serie.length-1]?.mes}.`);
}

await main();
