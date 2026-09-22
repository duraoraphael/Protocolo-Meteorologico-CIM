const puppeteer = require('puppeteer');
(async () => {
  console.log('Launching browser');
  const browser = await puppeteer.launch({headless:true,pipe:true,timeout:20000,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  console.log('Browser ready');
  const page = await browser.newPage();
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => failed.push(r.url()));
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
  await page.goto('http://localhost:3212', {waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(() => document.querySelector('#conteudo').getAttribute('aria-busy') === 'false', {timeout:150000});
  const state = await page.evaluate(() => ({cards:document.querySelectorAll('.card').length, text:document.querySelector('#conteudo').innerText, images:[...document.images].map(i => ({src:i.getAttribute('src'),loaded:i.complete && i.naturalWidth>0})), overflow:document.documentElement.scrollWidth>innerWidth}));
  console.log(JSON.stringify({errors,failed,state}));
  await page.screenshot({path:'artifacts/dashboard-1440.png',fullPage:true});
  for (const width of [1920,1600,1100,768,390,320]) {
    await page.setViewport({width,height:width===1920?1080:900});
    console.log(JSON.stringify(await page.evaluate(() => ({width:innerWidth,bodyWidth:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.grid-cards') || document.body).gridTemplateColumns, height:document.documentElement.scrollHeight}))));
    if (width===390) await page.screenshot({path:'artifacts/dashboard-mobile.png',fullPage:true});
  }
  await page.setViewport({width:1440,height:900});
  await page.click('[data-detail="monitoramento"]');
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('Escape');
  await page.click('#botao-config');
  console.log('report dialog visible: '+await page.$eval('#overlay-senha', el => !el.classList.contains('oculto')));
  await page.keyboard.press('Escape');
  console.log('final errors: '+JSON.stringify(errors));
  await browser.close();
})().catch(e => {console.error(e);process.exit(1)});

