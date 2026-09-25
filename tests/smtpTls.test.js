// V-11: o relay SMTP valida o certificado, salvo SMTP_TLS_INSEGURO=true.
const test = require("node:test");
const assert = require("node:assert/strict");

function transportadorCom(env) {
  const salvo = { ...process.env };
  for (const k of ["SMTP_HOST", "SMTP_PORTA", "SMTP_TLS_INSEGURO", "SMTP_IGNORAR_TLS", "ENVIO_EMAIL_ATIVO"]) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve("../src/email/transport")];
  const avisos = [];
  const aviso = console.warn;
  console.warn = (...a) => avisos.push(a.join(" "));
  try {
    const { criarTransportador } = require("../src/email/transport");
    return { t: criarTransportador(), avisos };
  } finally {
    console.warn = aviso;
    for (const k of Object.keys(process.env)) if (!(k in salvo)) delete process.env[k];
    Object.assign(process.env, salvo);
  }
}

test("relay corporativo: rejectUnauthorized true por padrão, sem aviso", () => {
  const { t, avisos } = transportadorCom({ SMTP_HOST: "smtp.exemplo.local" });
  assert.equal(t.options.tls.rejectUnauthorized, true);
  assert.equal(avisos.length, 0);
});

test("SMTP_TLS_INSEGURO=true desliga a validação e avisa no log", () => {
  const { t, avisos } = transportadorCom({ SMTP_HOST: "smtp.exemplo.local", SMTP_TLS_INSEGURO: "true" });
  assert.equal(t.options.tls.rejectUnauthorized, false);
  assert.match(avisos.join("\n"), /SMTP_TLS_INSEGURO/);
});

test("qualquer outro valor mantém a validação", () => {
  for (const v of ["1", "TRUE", "yes", ""]) {
    const { t } = transportadorCom({ SMTP_HOST: "smtp.exemplo.local", SMTP_TLS_INSEGURO: v });
    assert.equal(t.options.tls.rejectUnauthorized, true, v);
  }
});

test("Gmail usa STARTTLS 587, valida TLS e remove espaços visuais da senha de app", () => {
  const { t } = transportadorCom({
    GMAIL_USER: "cim@example.com",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
  });
  assert.equal(t.options.host, "smtp.gmail.com");
  assert.equal(t.options.port, 587);
  assert.equal(t.options.secure, false);
  assert.equal(t.options.requireTLS, true);
  assert.equal(t.options.tls.rejectUnauthorized, true);
  assert.equal(t.options.auth.pass, "abcdefghijklmnop");
});

test("ENVIO_EMAIL_ATIVO=false bloqueia qualquer criação de transportador", () => {
  assert.throws(
    () => transportadorCom({ ENVIO_EMAIL_ATIVO: "false", SMTP_HOST: "smtp.exemplo.local" }),
    (erro) => erro.code === "EMAIL_SEND_DISABLED"
  );
});
