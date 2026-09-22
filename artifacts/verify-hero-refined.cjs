const puppeteer=require('puppeteer');const assert=require('node:assert/strict');
(async()=>{
const browser=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage();const errors=[],images=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('response',r=>{if(r.request().resourceType()==='image')images.push({url:r.url(),status:r.status()})});
 await page.setViewport({width:1440,height:900});await page.goto('http://localhost:3214',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('.hero-image').naturalWidth>0);
 await page.waitForFunction(()=>document.querySelector('#conteudo').getAttribute('aria-busy')==='false',{timeout:150000});
 const sizes=[[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[430,932],[390,844]];
 for(const [width,height] of sizes){
  await page.setViewport({width,height});
  await page.screenshot({path:`artifacts/hero-refined-${width}.png`,fullPage:true});
  const state=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,position:getComputedStyle(document.querySelector('.hero-image')).objectPosition,scale:getComputedStyle(document.querySelector('.hero-image')).transform,cards:document.querySelectorAll('.card').length}));
  assert.equal(state.overflow,false);assert.equal(state.cards,7);console.log(JSON.stringify(state));
 }
 const time=await page.$eval('#relogio',e=>e.textContent);await page.waitForFunction(old=>document.querySelector('#relogio').textContent!==old,{},time);
 assert.equal(await page.$$eval('.current-date select',e=>e.length),0);
 await page.click('#menu-toggle');await page.click('[data-detail="sobre"]');await page.waitForSelector('dialog[open]');await page.keyboard.press('Escape');
 console.log(JSON.stringify({images,errors}));assert.equal(errors.length,0);
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
