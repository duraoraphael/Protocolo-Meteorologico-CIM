const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
(async () => {
 const browser=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage(); const errors=[],statuses=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  page.on('response',r=>{if(r.url().includes('/api/'))statuses.push({route:new URL(r.url()).pathname,status:r.status()})});
  await page.setViewport({width:1440,height:900});
  await page.goto('http://localhost:3212',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.grid-cards');
  assert.equal(await page.$$eval('.card',e=>e.length),7);
  assert.equal(await page.$$eval('.current-date select',e=>e.length),0);
  const original=await page.$eval('#seletor-base',e=>e.value);
  const next=await page.$eval('#seletor-base',e=>[...e.options].find(o=>o.value!==e.value).value);
  await page.select('#seletor-base',next);
  await page.waitForFunction(key=>typeof reportAtual!=='undefined' && reportAtual?.cidade.chave===key,{timeout:150000},next);
  assert.equal(new URL(page.url()).searchParams.get('cidade'),next);
  assert.equal(await page.$$eval('.card',e=>e.length),7);
  await page.click('[data-detail="monitoramento"]');
  await page.waitForFunction(()=>document.querySelector('#lista-destinatarios-painel')?.textContent!=='Carregando…');
  await page.keyboard.press('Escape');
  await page.click('#botao-responsaveis');
  assert.equal(await page.$eval('#overlay-responsaveis',e=>!e.classList.contains('oculto')),true);
  await page.keyboard.press('Escape');
  await page.click('#botao-config');
  await page.click('#botao-confirmar');
  assert.equal(await page.$eval('#modal-mensagem',e=>e.textContent),'Digite a senha.');
  await page.keyboard.press('Escape');
  await page.setViewport({width:390,height:844});
  await page.click('#menu-toggle');
  assert.equal(await page.$eval('#menu-toggle',e=>e.getAttribute('aria-expanded')),'true');
  await page.click('#menu-principal [data-detail="sobre"]');
  assert.equal(await page.$eval('#menu-toggle',e=>e.getAttribute('aria-expanded')),'false');
  await page.keyboard.press('Escape');
  // Test missing-field presentation using the actual report with unavailable fields;
  // this never replaces API responses or production data.
  const unavailable=await page.evaluate(()=>{
   const r={...reportAtual,qualidadeAr:null,mar:null};
   const el=document.createElement('div');el.innerHTML=Dashboard.home(r);
   return {cards:el.querySelectorAll('.card').length, missing:el.textContent.includes('Dado indisponível'), unsafe:el.textContent.includes('undefined')};
  });
  assert.deepEqual(unavailable,{cards:7,missing:true,unsafe:false});
  await page.select('#seletor-base',original);
  await page.waitForFunction(key=>reportAtual?.cidade.chave===key,{timeout:150000},original);
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({result:'PASS',checks:['7 cards','date is not a select','base selection and URL','monitoring dialog','recipients dialog','required password','mobile menu','missing-field presentation','no console errors'],network:statuses}));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
