const puppeteer = require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
 const page=await browser.newPage();const errors=[],images=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.request().resourceType()==='image')images.push({url:r.url(),status:r.status()})});
 await page.setViewport({width:1440,height:900});await page.goto('http://localhost:3213',{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.querySelector('#conteudo').getAttribute('aria-busy')==='false',{timeout:150000});
 await page.screenshot({path:'artifacts/hero-after.png',fullPage:true});
 await page.setViewport({width:390,height:844});
 await page.screenshot({path:'artifacts/hero-mobile.png',fullPage:true});
 console.log(JSON.stringify({images,errors,background:await page.$eval('.hero',e=>getComputedStyle(e).backgroundImage)}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
