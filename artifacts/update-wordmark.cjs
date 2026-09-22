const fs=require('fs');
let s=fs.readFileSync('public/dashboard.html','utf8');
s=s.replace('<a href="#inicio" class="brand" aria-label="CIM — início"><img id="logo-cim" class="logo-cim oculto" alt="CIM" /></a>','<a href="#inicio" class="brand cim-wordmark" aria-label="CIM — início"><span aria-hidden="true">C<span class="cim-wordmark-accent">I</span>M</span></a>');
s=s.replace('Dados meteorológicos para<br>operações mais seguras','CENTRO INTEGRADO DE MONITORAMENTO').replace('METEOROLÓGICO <em>CIM</em>','METEOROLÓGICO').replace('dashboard.css?v=hero-ediselonge-7','dashboard.css?v=cim-wordmark-8').replace('src="dashboard.js"','src="dashboard.js?v=cim-wordmark-8"');fs.writeFileSync('public/dashboard.html',s);
s=fs.readFileSync('public/dashboard.js','utf8');const a=s.indexOf('    const logoCim =');const b=s.indexOf('    const logoPetrobrasCard',a);if(a<0||b<0)throw new Error('Logo block missing');s=s.slice(0,a)+s.slice(b);fs.writeFileSync('public/dashboard.js',s);
s=fs.readFileSync('public/dashboard.css','utf8').replace(/\.logo-cim\s*\{[^}]*\}/g,'').replace('@media(max-width:700px) {  }','');
s+=`
/* Header identity: text-only wordmark; photo and operational layout unchanged. */
.cim-wordmark { display:inline-flex; align-items:center; font-family:inherit; font-size:34px; font-weight:800; letter-spacing:-.035em; line-height:1; color:var(--text-primary); }
.cim-wordmark-accent { color:var(--yellow-petro); }
.hero-copy > .eyebrow { padding-left:42px; font-size:12px; font-weight:650; letter-spacing:.1em; color:var(--text-primary); }
.hero-copy > .eyebrow::before { width:30px; top:.65em; }
.hero-copy > h1 { font-size:clamp(44px,4vw,68px); font-weight:800; line-height:.98; letter-spacing:-.03em; color:var(--text-primary); }
@media(max-width:1099px) { .hero-copy > h1 { font-size:42px; } }
@media(max-width:700px) {
  .cim-wordmark { font-size:28px; }
  .hero-copy > h1 { font-size:clamp(30px,6.5vw,42px); }
  .hero-copy > .eyebrow { font-size:11px; line-height:1.5; }
}
`;fs.writeFileSync('public/dashboard.css',s);
