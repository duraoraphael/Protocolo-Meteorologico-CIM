// Simulação offline dos gatilhos (valores FICTÍCIOS, não são medições reais).
// Uso: node scripts/simularGatilhos.js
const motor = require("../src/logic/motorGatilhos");

const REF = new Date().toISOString();
const obs = (valor, unidade) => ({ valor, unidade, fonte: "SIMULAÇÃO (INMET estação automática)", referenciaEm: REF, natureza: "observada" });
const prev = (valor, unidade) => ({ valor, unidade, fonte: "SIMULAÇÃO (Open-Meteo)", referenciaEm: REF, natureza: "prevista" });
const calor = (protocolo) => ({ status: "operacional", protocolo, fonte: "SIMULAÇÃO (Clima e Saúde)", referenciaEm: REF });

function imprimir(titulo, r) {
  console.log(`\n=== ${titulo} ===`);
  console.log(`FENÔMENO: ${r.rotulo}  SEVERIDADE: ${r.grau ?? "NÃO CLASSIFICADA"}${r.preventivo ? " (PREVENTIVO)" : ""}`);
  if (r.gatilho) console.log(`GATILHO: ${r.gatilho.rotulo} = ${r.gatilho.valor} ${r.gatilho.unidade} [${r.gatilho.natureza}]`);
  console.log(`MOTIVO: ${r.motivo}`);
  for (const g of r.recomendacoesPorNivel) {
    console.log(`  ${g.nivel}:`);
    g.itens.forEach((i) => console.log(`    - ${i}`));
  }
}

imprimir("Chuva: 25 mm/h + 85 mm/dia", motor.avaliarChuva({ horaria: obs(25, "mm/h"), diaria: obs(85, "mm") }));
imprimir("Vento: rajada 48 km/h observada", motor.avaliarVento({ observada: obs(48, "km/h") }));
imprimir("Vento: previsão 65 km/h, sem medição", motor.avaliarVento({ prevista: prev(65, "km/h") }));
imprimir("Calor: P2", motor.avaliarCalor(calor("P2")));
imprimir("Calor: fonte indisponível", motor.avaliarCalor({ status: "indisponivel" }));

const loc = motor.avaliarLocalidade({
  localidade: "Rio de Janeiro/RJ",
  chuva: { horaria: obs(25, "mm/h"), diaria: obs(85, "mm") },
  vento: { observada: obs(65, "km/h") },
  calor: calor("P1"),
});
console.log(`\n=== Múltiplos fenômenos (${loc.localidade}) ===`);
console.log(`SEVERIDADE GERAL: ${loc.severidadeGeral} (${loc.cor})`);
for (const f of Object.values(loc.fenomenos)) {
  console.log(`  ${f.rotulo}: ${f.grau} -> ${f.recomendacoes.length} recomendações (${f.recomendacoesPorNivel.map((g) => g.nivel).join(" + ")})`);
}

console.log("\n=== Transições ===");
for (const [de, para] of [["NORMAL", "ATENÇÃO"], ["ATENÇÃO", "ALERTA"], ["ALERTA", "EMERGÊNCIA"], ["NORMAL", "EMERGÊNCIA"],
  ["EMERGÊNCIA", "ALERTA"], ["ALERTA", "ATENÇÃO"], ["ATENÇÃO", "NORMAL"], ["EMERGÊNCIA", "NORMAL"]]) {
  console.log(`  ${de.padEnd(10)} -> ${para.padEnd(10)} ${motor.ROTULO_TRANSICAO[motor.tipoTransicao(de, para)]}`);
}
