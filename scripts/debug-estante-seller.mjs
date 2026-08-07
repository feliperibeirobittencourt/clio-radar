import fs from 'node:fs/promises';

const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

async function fetchHtml(url){
  const res=await fetch(url,{headers:HEADERS});
  return {status:res.status,html:res.ok?await res.text():''};
}

function around(html,needle,before=200,after=500){
  const out=[];
  let idx=html.indexOf(needle);
  let count=0;
  while(idx!==-1&&count<4){
    out.push(html.slice(Math.max(0,idx-before),idx+after));
    idx=html.indexOf(needle,idx+needle.length);
    count++;
  }
  return out;
}

async function main(){
  const lines=[];

  // 1) Página do vendedor: bloco JSON-LD completo + busca por chaves em inglês
  const sellerUrl='https://www.estantevirtual.com.br/sebos-e-livreiros/books-denise-damasceno?sellers=1002344';
  lines.push(`===== PAGINA DO VENDEDOR — JSON-LD completo =====\nurl=${sellerUrl}`);
  try{
    const {status,html}=await fetchHtml(sellerUrl);
    lines.push(`status=${status} tamanho=${html.length}`);
    const ldBlocks=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    lines.push(`blocos ld+json encontrados: ${ldBlocks.length}`);
    ldBlocks.forEach((m,i)=>lines.push(`--- bloco ld+json #${i} ---\n${m[1]}`));
    for(const kw of ['"city','"state','"region','"address','"geo','localidade','municipio','sellerName','"uf"','companyName','tradeName']){
      const hits=around(html,kw);
      if(hits.length){
        lines.push(`--- ocorrências de ${kw} (${hits.length}) ---`);
        hits.forEach((h,i)=>lines.push(`[${kw} #${i}]\n${h}`));
      }
    }
    // trecho ao redor do checkbox de loja pra ver se tem id numerico do vendedor perto
    const lojaIdx=html.indexOf('loja-sebo-da-nove');
    if(lojaIdx!==-1)lines.push('--- contexto do checkbox de loja (mais largo) ---\n'+html.slice(Math.max(0,lojaIdx-1500),lojaIdx+500));
  }catch(e){lines.push('ERRO: '+e.message)}

  // 2) Página de produto individual (sku da busca anterior) — ver se mostra
  // origem de envio / cidade do vendedor
  const productUrl='https://www.estantevirtual.com.br/livro/1U2-1068-000';
  lines.push(`\n\n===== PAGINA DE PRODUTO =====\nurl=${productUrl}`);
  try{
    const {status,html}=await fetchHtml(productUrl);
    lines.push(`status=${status} tamanho=${html.length}`);
    const ldBlocks=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    lines.push(`blocos ld+json encontrados: ${ldBlocks.length}`);
    ldBlocks.forEach((m,i)=>lines.push(`--- bloco ld+json #${i} ---\n${m[1].slice(0,3000)}`));
    for(const kw of ['enviado','origem','localizad','"city','"state','"region','vendido por','seller','loja','Sebo','Livraria']){
      const hits=around(html,kw);
      if(hits.length){
        lines.push(`--- ocorrências de "${kw}" (${hits.length}) ---`);
        hits.forEach((h,i)=>lines.push(`[${kw} #${i}]\n${h}`));
      }
    }
  }catch(e){lines.push('ERRO: '+e.message)}

  await fs.mkdir('debug',{recursive:true});
  await fs.writeFile('debug/estante-seller.txt',lines.join('\n\n'));
  console.log('Gravado em debug/estante-seller.txt ('+lines.join('\n\n').length+' chars)');
}

await main();
