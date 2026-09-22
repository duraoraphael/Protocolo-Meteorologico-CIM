const puppeteer=require('puppeteer'),assert=require('node:assert/strict'),fs=require('fs');
(async()=>{const browser=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage(),errors=[],bad=[];page.on('pageerror',()=>errors.push('JavaScript error'));page.on('response',r=>{if(r.status()>=400)bad.push({path:new URL(r.url()).pathname,status:r.status()});});
 await page.setViewport({width:1440,height:1000});await page.goto('http://localhost:3218/?cidade=macae',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#conteudo').getAttribute('aria-busy')==='false',{timeout:180000});
 assert.equal(await page.$$eval('footer',x=>x.length),0);assert.equal(await page.$$eval('#windy',x=>x.length),0);assert.equal(await page.$$eval('.card',x=>x.length),7);
 const reports=await page.evaluate(async()=>{const x=await(await fetch('/api/preview?cidade=macae')).json();return {ok:x.ok,warnings:x.report?.avisosColeta,sources:x.report?.fontesPorCampo};});
 await page.screenshot({path:'artifacts/windy-dashboard-desktop.png',fullPage:true});
 for(const width of [1920,1440,1366,1280,1024,768,390]){await page.setViewport({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.setViewport({width:1440,height:1000});await page.select('#seletor-base','rio_de_janeiro');await page.select('#seletor-base','macae');await page.waitForFunction(()=>document.querySelector('#conteudo').getAttribute('aria-busy')==='false',{timeout:180000});assert.match(await page.$eval('#tempo-atual',x=>x.textContent),/Maca/);
 await page.click('#link-mapas');await page.waitForFunction(()=>document.querySelector('#cim-map-base')?.options.length===12);assert.equal(await page.$eval('#cim-map-base',x=>x.value),'macae');assert.match(await page.$eval('#cim-map-status',x=>x.textContent),/não configurada/);
 await page.select('#cim-map-base','rio_de_janeiro');assert.match(page.url(),/cidade=rio_de_janeiro/);assert.match(await page.$eval('#cim-map-home',x=>x.href),/cidade=rio_de_janeiro/);
 for(const width of [1440,768,390]){await page.setViewport({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`artifacts/windy-maps-${width}.png`,fullPage:true});}
 // Real library availability, without any credential or fabricated provider data.
 await page.addScriptTag({url:'https://unpkg.com/leaflet@1.4.0/dist/leaflet.js'});await page.addScriptTag({url:'https://api.windy.com/assets/map-forecast/libBoot.js'});assert.equal(await page.evaluate(()=>typeof windyInit),'function');
 const keys=require('dotenv').parse(fs.readFileSync('.env'));const config=await page.evaluate(async()=>await(await fetch('/api/windy/map-config')).text());for(const key of [keys.WINDY_POINT_FORECAST_API_KEY,keys.WINDY_API_KEY].filter(Boolean))assert.equal(config.includes(key),false);
 assert.equal(errors.length,0);console.log(JSON.stringify({result:'PASS',report:reports,map:'Missing-key state verified; real libraries loaded; authenticated map NOT tested',errors,bad},null,2));
}finally{await browser.close();}})().catch(e=>{console.error({name:e.name,message:e.message});process.exit(1)});
