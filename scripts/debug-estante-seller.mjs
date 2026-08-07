import fs from 'node:fs/promises';

const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'};

async function fetchHtml(url){
  const res=await fetch(url,{headers:HEADERS});
  return {status:res.status,html:res.ok?await res.text():''};
}

function around(html,needle,before=200,after=1200){
  const out=[];
  let idx=html.indexOf(needle);
  let count=0;
  while(idx!==-1&&count<5){
    out.push(html.slice(Math.max(0,idx-before),idx+after));
    idx=html.indexOf(needle,idx+needle.length);
    count++;
  }
  return out;
}

async function main(){
  const lines=[];

  // 1) Página normal de busca por autor (mesma usada em scrape-estante.mjs)
  const searchUrl='https://www.estantevirtual.com.br/busca?q=Machado+de+Assis&searchField=autor&tipo-de-livro=usado&_preco=3000-10000000&pagina=1&sort=new-releases';
  lines.push(`===== BUSCA AUTOR =====\nurl=${searchUrl}`);
  try{
    const {status,html}=await fetchHtml(searchUrl);
    lines.push(`status=${status} tamanho=${html.length}`);
    // primeiro card completo, do primeiro <a product-item__link até o segundo
    const firstLinkIdx=html.search(/<a\b[^>]*class="[^"]*product-item__link/);
    if(firstLinkIdx!==-1){
      const secondLinkIdx=html.indexOf('product-item__link',firstLinkIdx+50);
      const end=secondLinkIdx!==-1?html.lastIndexOf('<a',secondLinkIdx):firstLinkIdx+6000;
      lines.push('--- primeiro card completo ---');
      lines.push(html.slice(firstLinkIdx-300,Math.min(end,firstLinkIdx+6000)));
    }else{
      lines.push('(nenhum product-item__link encontrado)');
    }
    for(const kw of ['vendedor','seller','vendido por','sellers=','loja','sebo']){
      const hits=around(html,kw,150,400);
      if(hits.length){
        lines.push(`--- ocorrências de "${kw}" (${hits.length}) ---`);
        hits.forEach((h,i)=>lines.push(`[${kw} #${i}]\n${h}`));
      }
    }
  }catch(e){lines.push('ERRO: '+e.message)}

  // 2) Página filtrada por vendedor (link enviado pelo usuário)
  const sellerUrl='https://www.estantevirtual.com.br/sebos-e-livreiros/books-denise-damasceno?sellers=1002344';
  lines.push(`\n\n===== PAGINA DO VENDEDOR =====\nurl=${sellerUrl}`);
  try{
    const {status,html}=await fetchHtml(sellerUrl);
    lines.push(`status=${status} tamanho=${html.length}`);
    for(const kw of ['cidade','estado','endereco','endereço','uf','sebo','livreiro','seller-info','seller-name','profile']){
      const hits=around(html,kw,150,400);
      if(hits.length){
        lines.push(`--- ocorrências de "${kw}" (${hits.length}) ---`);
        hits.forEach((h,i)=>lines.push(`[${kw} #${i}]\n${h}`));
      }
    }
    // título da página e primeiros 3000 chars do body como fallback geral
    const titleMatch=html.match(/<title>([\s\S]*?)<\/title>/);
    lines.push('title: '+(titleMatch?titleMatch[1]:'(nao encontrado)'));
    const bodyIdx=html.indexOf('<body');
    if(bodyIdx!==-1)lines.push('--- inicio do body ---\n'+html.slice(bodyIdx,bodyIdx+3000));
  }catch(e){lines.push('ERRO: '+e.message)}

  await fs.mkdir('debug',{recursive:true});
  await fs.writeFile('debug/estante-seller.txt',lines.join('\n\n'));
  console.log('Gravado em debug/estante-seller.txt ('+lines.join('\n\n').length+' chars)');
}

await main();
