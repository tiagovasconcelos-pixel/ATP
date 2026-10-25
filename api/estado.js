// GET /api/estado?mes=2026-10  ->  { config, deposito, gravando, versao }
// Fala o protocolo Redis em TCP (REDIS_URL). A tentativa anterior usava a API
// REST da Upstash: o host da REDIS_URL nao atende HTTP, dava "fetch failed".

import { createClient } from "redis";

const VERSAO = "2026-10-25-d";

const PADRAO = {
  membros: [
    { id: "tiago",     nome: "Tiago",            valor: 300 },
    { id: "pedro",     nome: "Pedro Miranda",    valor: 300 },
    { id: "alexandre", nome: "Alexandre Soares", valor: 300 }
  ],
  pix: "42.134.811/0001-25",
  banco: "Banco BS2",
  dia: 10
};

function endereco() {
  const e = process.env;
  return e.REDIS_URL || e.KV_URL || e.UPSTASH_REDIS_URL || e.REDIS_TLS_URL || null;
}

// Apenas NOMES de variaveis, nunca valores.
function nomesDeVariaveis() {
  return Object.keys(process.env)
    .filter(k => /REDIS|UPSTASH|^KV_|REST_API/i.test(k))
    .sort();
}

async function abrir() {
  const url = endereco();
  if (!url) return null;
  const c = createClient({ url, socket: { connectTimeout: 6000, reconnectStrategy: false } });
  c.on("error", () => {});           // nao deixa o processo cair
  await c.connect();
  return c;
}

function comoJson(bruto) {
  if (bruto == null) return null;
  try { return typeof bruto === "string" ? JSON.parse(bruto) : bruto; }
  catch { return null; }
}

export default async function handler(req, res) {
  const mes = String(req.query.mes || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ erro: "mes invalido, use AAAA-MM" });
  }

  res.setHeader("Cache-Control", "no-store");

  let c = null;
  try {
    c = await abrir();
    if (!c) {
      return res.status(200).json({
        config: PADRAO, deposito: {}, gravando: false, versao: VERSAO,
        erro: "nenhuma variavel de conexao com o banco",
        variaveisEncontradas: nomesDeVariaveis()
      });
    }

    const [cfg, dep] = await Promise.all([
      c.get("atp:config"),
      c.get("atp:dep:" + mes)
    ]);

    return res.status(200).json({
      config: comoJson(cfg) || PADRAO,
      deposito: comoJson(dep) || {},
      gravando: true,
      versao: VERSAO,
      via: "REDIS_URL (protocolo Redis)"
    });

  } catch (e) {
    // Diagnostico sem segredo: nome e codigo do erro, nunca host nem senha.
    return res.status(200).json({
      config: PADRAO, deposito: {}, gravando: false, versao: VERSAO,
      erro: "o banco respondeu com falha",
      detalhe: String((e && e.message) || e).slice(0, 200),
      tipoDoErro: String((e && (e.name || e.code)) || "?").slice(0, 60),
      variaveisEncontradas: nomesDeVariaveis()
    });
  } finally {
    if (c) { try { await c.quit(); } catch (_) {} }
  }
}
