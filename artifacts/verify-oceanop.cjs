const puppeteer=require('puppeteer');const assert=require('node:assert/strict');
(async()=>{const b=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1440,height:900});
await p.goto('http://localhost:3216/areas.html',{waitUntil:'networkidle2'});
const count=await p.$$eval('#base option',e=>e.length);assert.equal(count,Object.keys(require('../src/config/cities').CIDADES).length);
await p.type('#local','sururu');await p.click('#consultar');await p.waitForFunction(()=>document.getElementById('status').dataset.error==='true',{timeout:25000});
const message=await p.$eval('#status',e=>e.textContent);assert.match(message,/não resolvido/);assert.equal(await p.$eval('#consultar',e=>e.disabled),false);
await p.screenshot({path:'artifacts/oceanop-desktop.png',fullPage:true});
await p.setViewport({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'artifacts/oceanop-mobile.png',fullPage:true});
await p.goto('http://localhost:3216',{waitUntil:'domcontentloaded'});await p.setViewport({width:1100,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.$$eval('a[href="areas.html"]',e=>e.length),1);
assert.equal(errors.length,0);console.log(JSON.stringify({baseCount:count,errorShown:message,scriptErrors:errors,result:'PASS'}));
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});

