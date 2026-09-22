const puppeteer=require('puppeteer');const assert=require('node:assert/strict');
(async()=>{const b=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1440,height:900});await p.goto('http://localhost:3217',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>document.querySelector('#logo-petrobras').naturalWidth>0);
 await p.waitForFunction(()=>document.querySelector('#conteudo').getAttribute('aria-busy')==='false',{timeout:150000});
 assert.equal(await p.$$eval('#logo-cim',e=>e.length),0);assert.equal(await p.$eval('.cim-wordmark',e=>e.textContent),'CIM');assert.equal(await p.$eval('.hero-copy .eyebrow',e=>e.textContent),'CENTRO INTEGRADO DE MONITORAMENTO');assert.equal(await p.$eval('h1',e=>e.textContent),'PROTOCOLOMETEOROLÓGICO');
 for(const width of [1920,1600,1440,1366,1280,1024,768,430,390]){
 await p.setViewport({width,height:width===1920?1080:900});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if([1920,1440,390].includes(width))await p.screenshot({path:`artifacts/wordmark-${width}.png`,fullPage:true});
 }
 await p.click('#menu-toggle');await p.click('#botao-config');assert.equal(await p.$eval('#overlay-senha',e=>!e.classList.contains('oculto')),true);await p.keyboard.press('Escape');
 console.log(JSON.stringify({result:'PASS',widths:9,cards:await p.$$eval('.card',e=>e.length),errors}));assert.equal(errors.length,0);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
