// ═══════════════════════════════════════════════════════════════
// Assistente IA — Bom Sucesso (Edge Function do Supabase)
// Recebe a mensagem da Carol, pergunta ao Gemini e devolve
// AÇÕES PROPOSTAS (nunca salva nada sozinha). Quem salva é o site,
// depois que a Carol confirma no card.
// A chave fica no secret GEMINI_API_KEY (Edge Functions → Secrets).
// ═══════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELOS = [
  Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest",
  "gemini-2.5-flash",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Ações que o Gemini pode propor ──────────────────────────────
const FERRAMENTAS = [
  {
    name: "lancar_comissao",
    description:
      "Propõe um novo lançamento de COMISSÃO de contrato consignado (aba Lançar do módulo Bom Sucesso).",
    parameters: {
      type: "object",
      properties: {
        nome_cliente: { type: "string", description: "Nome completo do cliente, em MAIÚSCULAS" },
        modalidade: { type: "string", description: "Modalidade/produto. Use exatamente um nome da lista de modalidades quando houver correspondência" },
        banco: { type: "string", description: "Banco/financeira. Use exatamente um nome da lista de bancos quando houver correspondência" },
        tipo_op: { type: "string", description: "Tipo de operação. Use um da lista de tipos (padrão NOVO)" },
        promotora: { type: "string", description: "Promotora, se mencionada. Use um da lista de promotoras" },
        valor_contrato: { type: "number", description: "Valor do contrato em reais (ex: 8500.00)" },
        perc_comissao: { type: "number", description: "Percentual de comissão (ex: 3.5 para 3,5%)" },
        comissao_valor: { type: "number", description: "Valor da comissão em reais SOMENTE se a Carol disser o valor exato em R$" },
        pacote_fixo: { type: "number", description: "Pacote fixo em reais, se mencionado" },
        data_digitacao: { type: "string", description: "Data de digitação no formato AAAA-MM-DD" },
        data_pagamento_cliente: { type: "string", description: "Data de pagamento ao cliente AAAA-MM-DD, se mencionada" },
        data_comissao_recebida: { type: "string", description: "Data em que a comissão foi recebida AAAA-MM-DD, se mencionada" },
        status: { type: "string", enum: ["ABERTO", "PAGO"], description: "ABERTO por padrão; PAGO só se ela disser que já recebeu" },
        cpf: { type: "string" },
        telefone: { type: "string" },
        num_contrato: { type: "string" },
        prazo: { type: "number", description: "Prazo em meses" },
        valor_parcela: { type: "number" },
        obs: { type: "string" },
      },
      required: ["nome_cliente", "modalidade", "banco", "valor_contrato", "data_digitacao"],
    },
  },
  {
    name: "lancar_despesa",
    description:
      "Propõe uma DESPESA no Finance Control (cards Casa ou Empresa). Para gastos do dia a dia (mercado, gasolina, ifood, almoço, lazer) use lancar_gasto.",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome da despesa (ex: Fatura Nubank, Aluguel sala)" },
        card: { type: "string", enum: ["CASA", "EMPRESA"] },
        categoria: { type: "string", description: "Use exatamente uma categoria da lista de categorias de despesas" },
        tipo: { type: "string", enum: ["Fixa", "Variável"] },
        valor: { type: "number", description: "Valor em reais" },
        vencimento: { type: "string", description: "Data de vencimento AAAA-MM-DD" },
        data_pagamento: { type: "string", description: "Data de pagamento AAAA-MM-DD, se já pagou" },
        status: { type: "string", enum: ["ABERTO", "PAGO"] },
        obs: { type: "string" },
      },
      required: ["nome", "card", "valor"],
    },
  },
  {
    name: "lancar_gasto",
    description:
      "Propõe um GASTO DO MÊS (mercado, combustível, ifood/delivery, almoço, lazer e outros gastos do dia a dia).",
    parameters: {
      type: "object",
      properties: {
        descricao: { type: "string" },
        categoria: { type: "string", description: "Use exatamente uma categoria da lista de categorias de gastos do mês" },
        valor: { type: "number" },
        data: { type: "string", description: "AAAA-MM-DD (padrão: hoje)" },
        status: { type: "string", enum: ["PAGO", "ABERTO"], description: "PAGO por padrão" },
        obs: { type: "string" },
      },
      required: ["descricao", "valor"],
    },
  },
];

function montarInstrucoes(ctx: Record<string, unknown>) {
  const lista = (k: string) => (Array.isArray(ctx[k]) ? (ctx[k] as string[]).join(" | ") : "");
  return `Você é o assistente de lançamentos da Bom Sucesso, correspondente de crédito consignado em Ji-Paraná (RO).
Quem fala com você é a Carol, dona da empresa. Responda sempre em português, curto e simpático.

Hoje é ${ctx.hoje || "(data não informada)"}. Mês aberto no sistema: ${ctx.mes_sistema || "-"}.

SEU TRABALHO: transformar o pedido da Carol em lançamentos usando as funções.
- Comissão de contrato → lancar_comissao
- Conta/boleto da casa ou da empresa → lancar_despesa
- Gasto do dia a dia (mercado, gasolina, ifood, almoço, lazer) → lancar_gasto
- Se ela pedir vários lançamentos na mesma mensagem, chame a função uma vez para cada.

REGRAS:
- Nunca invente dados. Se faltar algo obrigatório (nome do cliente, banco, modalidade, valor), pergunte em vez de chamar a função.
- O % de comissão pode ficar vazio — o sistema sugere com base no último contrato do mesmo banco.
- "hoje", "ontem", "dia 10" → converta para AAAA-MM-DD usando a data de hoje.
- Valores em reais: "8,5 mil" = 8500; "1.234,56" = 1234.56.
- Status da comissão é ABERTO, a menos que ela diga que já recebeu.
- Use os nomes EXATOS das listas abaixo quando houver correspondência (ex: "bmg" → nome da lista que contém BMG; "inss" → modalidade da lista com INSS).
- Se a pergunta não for um lançamento, responda normalmente em texto.

LISTAS DO SISTEMA:
Modalidades: ${lista("modalidades")}
Bancos: ${lista("bancos")}
Tipos de operação: ${lista("tipos_op")}
Promotoras: ${lista("promotoras")}
Categorias de despesas: ${lista("categorias_despesa")}
Categorias de gastos do mês: ${lista("categorias_gasto")}`;
}

async function chamarGemini(chave: string, corpo: unknown) {
  let ultimoErro = "";
  for (const modelo of MODELOS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(corpo),
    });
    const txt = await r.text();
    if (r.ok) return JSON.parse(txt);
    ultimoErro = `Gemini (${modelo}) respondeu ${r.status}: ${txt.slice(0, 400)}`;
    if (r.status !== 404) break; // só tenta o próximo modelo se este não existir
  }
  throw new Error(ultimoErro);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave) return json({ erro: "Secret GEMINI_API_KEY não configurado no Supabase." }, 500);

  let entrada: { mensagem?: string; historico?: { papel: string; texto: string }[]; contexto?: Record<string, unknown> };
  try {
    entrada = await req.json();
  } catch {
    return json({ erro: "Corpo inválido" }, 400);
  }
  const mensagem = (entrada.mensagem || "").toString().slice(0, 4000);
  if (!mensagem.trim()) return json({ erro: "Mensagem vazia" }, 400);

  const historico = (entrada.historico || []).slice(-10).map((h) => ({
    role: h.papel === "ia" ? "model" : "user",
    parts: [{ text: String(h.texto || "").slice(0, 2000) }],
  }));

  const corpo = {
    systemInstruction: { parts: [{ text: montarInstrucoes(entrada.contexto || {}) }] },
    contents: [...historico, { role: "user", parts: [{ text: mensagem }] }],
    tools: [{ functionDeclarations: FERRAMENTAS }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.1 },
  };

  try {
    const resp = await chamarGemini(chave, corpo);
    const partes = resp?.candidates?.[0]?.content?.parts || [];
    const acoes = partes
      .filter((p: { functionCall?: unknown }) => p.functionCall)
      .map((p: { functionCall: { name: string; args: Record<string, unknown> } }) => ({
        acao: p.functionCall.name,
        dados: p.functionCall.args || {},
      }));
    const texto = partes
      .filter((p: { text?: string }) => p.text)
      .map((p: { text: string }) => p.text)
      .join("\n")
      .trim();
    return json({ texto, acoes });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 502);
  }
});
