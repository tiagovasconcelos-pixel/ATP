// GET /api/estado?mes=2026-10  ->  { config, deposito, gravando }
// Le do Upstash Redis. Se o banco ainda nao estiver conectado, devolve o padrao
// para a pagina abrir bonita; gravar e que vai falhar, e falha avisando.

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

function credenciais() {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return (url && token) ? { url: url.replace(/\/$/, ""), token } : null;
}

async function ler(chave) {
  const c = credenciais();
  if (!c) return null;
  const r = await fetch(`${c.url}/get/${encodeURIComponent(chave)}`, {
    headers: { Authorization: `Bearer ${c.token}` }, cache: "no-store"
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d.result == null) return null;
  try { return typeof d.result === "string" ? JSON.parse(d.result) : d.result; }
  catch { return null; }
}

export default async function handler(req, res) {
  const mes = String(req.query.mes || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ erro: "mes invalido, use AAAA-MM" });
  }
  try {
    const [cfg, dep] = await Promise.all([ ler("atp:config"), ler("atp:dep:" + mes) ]);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      config: cfg || PADRAO,
      deposito: dep || {},
      gravando: credenciais() !== null
    });
  } catch (e) {
    return res.status(200).json({ config: PADRAO, deposito: {}, gravando: false });
  }
}
