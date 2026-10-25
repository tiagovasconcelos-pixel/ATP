// POST /api/marcar
//   { mes:"2026-10", id:"pedro" }  -> alterna o deposito do integrante
//   { config:{...} }               -> salva a conta e os valores
// Fala o protocolo Redis em TCP (REDIS_URL).

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

async function abrir() {
  const url = endereco();
  if (!url) return null;
  const c = createClient({ url, socket: { connectTimeout: 6000, reconnectStrategy: false } });
  c.on("error", () => {});
  await c.connect();
  return c;
}

function comoJson(bruto) {
  if (bruto == null) return null;
  try { return typeof bruto === "string" ? JSON.parse(bruto) : bruto; }
  catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });

  if (!endereco()) return res.status(503).json({
    erro: "banco nao conectado",
    comoResolver: "Na Vercel: Storage > conectar o Redis ao projeto, e redeploy.",
    versao: VERSAO
  });

  let corpo = req.body;
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { corpo = {}; } }
  corpo = corpo || {};

  res.setHeader("Cache-Control", "no-store");

  let c = null;
  try {
    c = await abrir();

    // 1) salvar a configuracao
    if (corpo.config) {
      const cfg = corpo.config;
      if (!Array.isArray(cfg.membros)) return res.status(400).json({ erro: "config invalida" });
      const limpo = {
        membros: cfg.membros.slice(0, 20).map(m => ({
          id: String(m.id).slice(0, 40),
          nome: String(m.nome).slice(0, 80),
          valor: (typeof m.valor === "number" && isFinite(m.valor) && m.valor > 0) ? m.valor : null
        })),
        pix: String(cfg.pix || "").slice(0, 120),
        banco: String(cfg.banco || "").slice(0, 120),
        dia: (Number.isInteger(cfg.dia) && cfg.dia >= 1 && cfg.dia <= 28) ? cfg.dia : 10
      };
      await c.set("atp:config", JSON.stringify(limpo));
      return res.status(200).json({ config: limpo, versao: VERSAO });
    }

    // 2) alternar o deposito de um integrante
    const mes = String(corpo.mes || "");
    const id  = String(corpo.id  || "");
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: "mes invalido" });

    const cfg = comoJson(await c.get("atp:config")) || PADRAO;
    const membro = (cfg.membros || []).find(m => m.id === id);
    if (!membro) return res.status(400).json({ erro: "integrante desconhecido" });

    const chave = "atp:dep:" + mes;
    const dep = comoJson(await c.get(chave)) || {};
    if (dep[id]) delete dep[id];
    else dep[id] = {
      at: new Date().toISOString(),
      valor: (typeof membro.valor === "number") ? membro.valor : null
    };

    await c.set(chave, JSON.stringify(dep));
    return res.status(200).json({ deposito: dep, versao: VERSAO });

  } catch (e) {
    return res.status(500).json({
      erro: "nao consegui gravar",
      detalhe: String((e && e.message) || e).slice(0, 200),
      tipoDoErro: String((e && (e.name || e.code)) || "?").slice(0, 60),
      versao: VERSAO
    });
  } finally {
    if (c) { try { await c.quit(); } catch (_) {} }
  }
}
