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
  const e = process.env;
  const diretos = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
  ];
  for (const [u, t] of diretos) {
    if (e[u] && e[t]) return { url: String(e[u]).replace(/\/$/, ""), token: e[t], via: u };
  }
  // Varredura: o Upstash pode prefixar com o nome do banco.
  // Procura qualquer chave que termine em REST_URL e o token do mesmo prefixo.
  const chaves = Object.keys(e);
  for (const k of chaves) {
    const m = k.match(/^(.*?)(REST_API_URL|REDIS_REST_URL|REST_URL)$/i);
    if (!m || !e[k] || !/^https?:\/\//i.test(String(e[k]))) continue;
    const prefixo = m[1];
    const kt = chaves.find(x =>
      x !== k &&
      x.toLowerCase().startsWith(prefixo.toLowerCase()) &&
      /TOKEN$/i.test(x) && e[x]);
    if (kt) return { url: String(e[k]).replace(/\/$/, ""), token: e[kt], via: k };
  }
  return null;
}

// Apenas NOMES, nunca valores. Serve para diagnostico enquanto nao conecta.
function nomesDeVariaveis() {
  return Object.keys(process.env)
    .filter(k => /REDIS|UPSTASH|^KV_|REST_API/i.test(k))
    .sort();
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
    const cred = credenciais();
    const corpo = {
      config: cfg || PADRAO,
      deposito: dep || {},
      gravando: cred !== null
    };
    if (cred) corpo.via = cred.via;
    else corpo.variaveisEncontradas = nomesDeVariaveis();  // so os nomes
    return res.status(200).json(corpo);
  } catch (e) {
    return res.status(200).json({ config: PADRAO, deposito: {}, gravando: false });
  }
}
