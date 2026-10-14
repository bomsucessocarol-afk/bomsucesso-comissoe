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

// Ordem de tentativa: se um estiver sobrecarregado, passa para o próximo
const MODELOS = [
  Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
];
const ERROS_TEMPORARIOS = [404, 429, 500, 503, 504];

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
        mes_referencia: { type: "string", description: "AAAA-MM do mês de referência, só se ela disser em qual mês lançar ou se o documento trouxer Período de Pagamento/Referência" },
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
  {
    name: "atualizar_comissao",
    description:
      "Localiza um contrato/comissão JÁ LANÇADO e propõe uma atualização (ex: marcar como PAGO, informar data de recebimento, corrigir valor, banco, CPF). O sistema procura o contrato e mostra para a Carol confirmar.",
    parameters: {
      type: "object",
      properties: {
        busca: {
          type: "object",
          description: "Como encontrar o contrato. Informe tudo o que a Carol disser.",
          properties: {
            nome_cliente: { type: "string", description: "Nome ou parte do nome do cliente" },
            banco: { type: "string" },
            modalidade: { type: "string" },
            valor_contrato: { type: "number" },
            num_contrato: { type: "string" },
            cpf: { type: "string" },
            mes: { type: "string", description: "Mês do contrato AAAA-MM, se ela disser" },
          },
        },
        alteracoes: {
          type: "object",
          description: "Somente os campos que devem mudar.",
          properties: {
            status: { type: "string", enum: ["ABERTO", "PAGO"], description: "PAGO quando a comissão foi recebida" },
            data_comissao_recebida: { type: "string", description: "AAAA-MM-DD — data em que a comissão caiu" },
            data_pagamento_cliente: { type: "string", description: "AAAA-MM-DD — data em que o banco pagou o cliente" },
            data_digitacao: { type: "string" },
            valor_contrato: { type: "number" },
            perc_comissao: { type: "number" },
            comissao_valor: { type: "number" },
            banco: { type: "string" },
            promotora: { type: "string" },
            cpf: { type: "string" },
            telefone: { type: "string" },
            num_contrato: { type: "string" },
            prazo: { type: "number" },
            valor_parcela: { type: "number" },
            obs: { type: "string" },
          },
        },
      },
      required: ["busca", "alteracoes"],
    },
  },
  {
    name: "atualizar_despesa",
    description:
      "Localiza uma despesa ou gasto JÁ LANÇADO no Finance Control e propõe uma atualização (ex: marcar conta como PAGA em tal dia, mudar valor ou vencimento).",
    parameters: {
      type: "object",
      properties: {
        busca: {
          type: "object",
          properties: {
            nome: { type: "string", description: "Nome ou parte do nome da conta (ex: energia, Nubank, aluguel)" },
            valor: { type: "number" },
            mes: { type: "string", description: "AAAA-MM se ela disser o mês" },
            card: { type: "string", enum: ["CASA", "EMPRESA", "GASTOS"] },
          },
        },
        alteracoes: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ABERTO", "PAGO", "REPARCELADO", "PROXIMO"] },
            data_pagamento: { type: "string", description: "AAAA-MM-DD" },
            valor: { type: "number" },
            vencimento: { type: "string", description: "AAAA-MM-DD" },
            nome: { type: "string" },
            obs: { type: "string" },
          },
        },
      },
      required: ["busca", "alteracoes"],
    },
  },
  {
    name: "consultar_comissoes",
    description:
      "Consulta os contratos/comissões do sistema para RESPONDER perguntas (totais, quem está em aberto, ranking por banco, etc). Use sempre que a pergunta depender dos dados. Depois da consulta, responda em texto.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ABERTO", "PAGO", "TODOS"] },
        banco: { type: "string" },
        modalidade: { type: "string" },
        tipo_op: { type: "string" },
        promotora: { type: "string" },
        nome_cliente: { type: "string" },
        data_inicio: { type: "string", description: "AAAA-MM-DD (data de digitação)" },
        data_fim: { type: "string", description: "AAAA-MM-DD (data de digitação)" },
        mes_ref: { type: "string", description: "AAAA-MM do mês de referência" },
        aberto_ha_mais_de_dias: { type: "number", description: "Só contratos sem retorno há mais de X dias" },
        sem_cpf: { type: "boolean" },
        agrupar_por: { type: "string", enum: ["banco", "modalidade", "tipo_op", "promotora", "mes", "nenhum"] },
        limite: { type: "number", description: "Máximo de contratos listados (padrão 20)" },
      },
    },
  },
  {
    name: "consultar_despesas",
    description:
      "Consulta despesas e gastos do Finance Control para RESPONDER perguntas (quanto gastou, o que vence, o que está em aberto, comparação entre meses).",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        card: { type: "string", enum: ["CASA", "EMPRESA", "GASTOS", "TODOS"] },
        categoria: { type: "string" },
        tipo: { type: "string", enum: ["Fixa", "Variável"] },
        status: { type: "string", enum: ["ABERTO", "PAGO", "TODOS"] },
        mes_inicio: { type: "string", description: "AAAA-MM" },
        mes_fim: { type: "string", description: "AAAA-MM" },
        vence_nos_proximos_dias: { type: "number" },
        atrasadas: { type: "boolean", description: "Só as vencidas e não pagas" },
        agrupar_por: { type: "string", enum: ["categoria", "card", "mes", "nome", "nenhum"] },
        limite: { type: "number" },
      },
    },
  },
  {
    name: "atualizar_comissoes_lote",
    description:
      "Atualiza VÁRIOS contratos de uma vez. Use para pedidos em lote (\"marca como pagas todas do BMG de setembro\") ou quando ela enviar o EXTRATO/RELATÓRIO de comissões de um banco (liste cada contrato do extrato em itens).",
    parameters: {
      type: "object",
      properties: {
        filtro: {
          type: "object",
          description: "Para lote por critério",
          properties: {
            banco: { type: "string" },
            modalidade: { type: "string" },
            tipo_op: { type: "string" },
            status: { type: "string", enum: ["ABERTO", "PAGO"] },
            mes_ref: { type: "string", description: "AAAA-MM" },
            data_inicio: { type: "string" },
            data_fim: { type: "string" },
          },
        },
        itens: {
          type: "array",
          description: "Para extrato: um item por contrato que aparece no documento",
          items: {
            type: "object",
            properties: {
              nome_cliente: { type: "string" },
              cpf: { type: "string" },
              num_contrato: { type: "string" },
              valor_contrato: { type: "number" },
              comissao_valor: { type: "number", description: "Comissão que o banco pagou por este contrato" },
            },
          },
        },
        banco: { type: "string", description: "Banco do extrato, se houver" },
        alteracoes: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ABERTO", "PAGO"] },
            data_comissao_recebida: { type: "string" },
            data_pagamento_cliente: { type: "string" },
          },
        },
      },
      required: ["alteracoes"],
    },
  },
  {
    name: "atualizar_despesas_lote",
    description: "Atualiza VÁRIAS despesas de uma vez (ex: \"paguei todas as contas fixas da empresa hoje\").",
    parameters: {
      type: "object",
      properties: {
        filtro: {
          type: "object",
          properties: {
            card: { type: "string", enum: ["CASA", "EMPRESA", "GASTOS"] },
            tipo: { type: "string", enum: ["Fixa", "Variável"] },
            categoria: { type: "string" },
            status: { type: "string", enum: ["ABERTO", "PAGO", "REPARCELADO", "PROXIMO"] },
            mes: { type: "string", description: "AAAA-MM (padrão: mês aberto no sistema)" },
            vence_ate: { type: "string", description: "AAAA-MM-DD" },
          },
        },
        itens: {
          type: "array",
          items: { type: "object", properties: { nome: { type: "string" }, valor: { type: "number" } } },
        },
        alteracoes: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ABERTO", "PAGO", "REPARCELADO", "PROXIMO"] },
            data_pagamento: { type: "string" },
          },
        },
      },
      required: ["alteracoes"],
    },
  },
  {
    name: "lancar_comissoes_lote",
    description:
      "Lança VÁRIOS contratos NOVOS de uma vez a partir de um relatório/planilha/PDF de contratos pagos, produção ou propostas. Um item por contrato, com todos os dados que aparecerem.",
    parameters: {
      type: "object",
      properties: {
        mes_referencia: {
          type: "string",
          description: "AAAA-MM em que TODOS os contratos devem ser lançados. Use o mês que a Carol disser (\"lança no mês 02/2026\") ou, se ela não disser, o mês/ano do campo \"Período de Pagamento\" (ou Referência/Competência) do documento.",
        },
        banco: { type: "string", description: "Banco do relatório, se for um só" },
        modalidade: { type: "string", description: "Modalidade do relatório, se for uma só (use a lista)" },
        tipo_op: { type: "string" },
        promotora: { type: "string" },
        status: { type: "string", enum: ["ABERTO", "PAGO"], description: "Status da COMISSÃO. ABERTO, a menos que o relatório mostre comissão já paga" },
        perc_comissao: { type: "number", description: "% de comissão geral, se o relatório trouxer um só" },
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nome_cliente: { type: "string" },
              cpf: { type: "string" },
              telefone: { type: "string" },
              num_contrato: { type: "string", description: "Número do contrato, proposta ou ADE" },
              banco: { type: "string" },
              modalidade: { type: "string" },
              tipo_op: { type: "string", description: "NOVO, PORTABILIDADE, REFINANCIAMENTO, etc. — use a lista" },
              promotora: { type: "string" },
              valor_contrato: { type: "number", description: "Valor liberado/valor do contrato" },
              prazo: { type: "number", description: "Quantidade de parcelas" },
              valor_parcela: { type: "number" },
              perc_comissao: { type: "number" },
              comissao_valor: { type: "number", description: "Comissão em R$ do contrato, se aparecer" },
              data_digitacao: { type: "string", description: "AAAA-MM-DD — data de digitação/cadastro da proposta" },
              data_pagamento_cliente: { type: "string", description: "AAAA-MM-DD — data em que o contrato foi pago/averbado" },
              status: { type: "string", enum: ["ABERTO", "PAGO"] },
              data_comissao_recebida: { type: "string" },
              obs: { type: "string" },
            },
            required: ["nome_cliente"],
          },
        },
      },
      required: ["itens"],
    },
  },
  {
    name: "abrir_painel",
    description:
      "Mostra um painel pronto do sistema: resumo do dia, lembretes de refinanciamento/nova oferta, faxina, fechamento do mês, raio-x do mês, ranking de onde está o dinheiro (bancos/produtos que mais pagam) ou a lista de lembretes pessoais.",
    parameters: {
      type: "object",
      properties: {
        painel: { type: "string", enum: ["resumo_do_dia", "lembretes_refinanciamento", "faxina", "fechamento_mes", "raio_x", "ranking", "meus_lembretes"] },
        mes: { type: "string", description: "AAAA-MM para fechamento_mes e raio_x (se ela disser o mês)" },
      },
      required: ["painel"],
    },
  },
  {
    name: "repetir_lancamento",
    description:
      "Lança um contrato NOVO copiando os dados de um contrato já lançado (banco, modalidade, tipo, promotora, %), trocando só o que ela disser. Ex: \"lança igual o da Maria, só muda o nome pra João e o valor pra 6 mil\". Sem nome de referência = o último lançado.",
    parameters: {
      type: "object",
      properties: {
        referencia_cliente: { type: "string", description: "Nome do cliente usado como modelo; vazio = último lançamento" },
        alteracoes: {
          type: "object",
          properties: {
            nome_cliente: { type: "string" }, cpf: { type: "string" }, telefone: { type: "string" },
            valor_contrato: { type: "number" }, perc_comissao: { type: "number" }, comissao_valor: { type: "number" },
            banco: { type: "string" }, modalidade: { type: "string" }, tipo_op: { type: "string" }, promotora: { type: "string" },
            data_digitacao: { type: "string" }, num_contrato: { type: "string" }, prazo: { type: "number" }, valor_parcela: { type: "number" },
          },
        },
      },
      required: ["alteracoes"],
    },
  },
  {
    name: "lancar_parcelado",
    description:
      "Cria uma compra/conta PARCELADA (ex: \"comprei uma impressora em 10x de 180 no cartão, começa em novembro\"). O sistema gera uma despesa por mês com (1/10), (2/10)...",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        card: { type: "string", enum: ["CASA", "EMPRESA"] },
        categoria: { type: "string", description: "Use uma da lista de categorias de despesas" },
        valor_parcela: { type: "number" },
        valor_total: { type: "number", description: "Se ela disser só o total" },
        parcelas: { type: "number" },
        primeiro_vencimento: { type: "string", description: "AAAA-MM-DD da 1ª parcela (se disser só o mês, use dia 10)" },
        obs: { type: "string" },
      },
      required: ["nome", "parcelas"],
    },
  },
  {
    name: "excluir_comissao",
    description: "Localiza um contrato/cadastro de cliente JÁ LANÇADO para EXCLUIR. Só use quando a Carol pedir claramente para excluir/apagar/remover. O sistema mostra o cadastro e ela confirma.",
    parameters: {
      type: "object",
      properties: {
        busca: {
          type: "object",
          properties: {
            nome_cliente: { type: "string" }, banco: { type: "string" }, valor_contrato: { type: "number" },
            num_contrato: { type: "string" }, cpf: { type: "string" }, mes: { type: "string", description: "AAAA-MM" },
          },
        },
      },
      required: ["busca"],
    },
  },
  {
    name: "excluir_despesa",
    description: "Localiza uma despesa ou gasto do mês JÁ LANÇADO para EXCLUIR. Só use quando a Carol pedir claramente para excluir/apagar/remover.",
    parameters: {
      type: "object",
      properties: {
        busca: {
          type: "object",
          properties: {
            nome: { type: "string" }, valor: { type: "number" }, mes: { type: "string", description: "AAAA-MM" },
            card: { type: "string", enum: ["CASA", "EMPRESA", "GASTOS"] },
          },
        },
      },
      required: ["busca"],
    },
  },
  {
    name: "ficha_cliente",
    description: "Mostra a ficha completa de um cliente: todos os contratos, bancos, valores, datas, contato e se já cabe nova oferta. Ex: \"me mostra tudo da Maria Souza\".",
    parameters: {
      type: "object",
      properties: { nome_cliente: { type: "string" }, cpf: { type: "string" } },
    },
  },
  {
    name: "criar_lembrete",
    description: "Cria um lembrete pessoal para a Carol (ex: \"me lembra de ligar pro João dia 20\", \"daqui 3 meses ver portabilidade da Ana\").",
    parameters: {
      type: "object",
      properties: {
        texto: { type: "string", description: "O que lembrar, curto" },
        data: { type: "string", description: "AAAA-MM-DD — calcule a partir de hoje" },
        cliente: { type: "string", description: "Nome do cliente, se houver" },
      },
      required: ["texto", "data"],
    },
  },
];

function montarInstrucoes(ctx: Record<string, unknown>) {
  const lista = (k: string) => (Array.isArray(ctx[k]) ? (ctx[k] as string[]).join(" | ") : "");
  return `Você é o assistente de lançamentos da Bom Sucesso, correspondente de crédito consignado em Ji-Paraná (RO).
Quem fala com você é a Carol, dona da empresa. Responda sempre em português, curto e simpático.

Hoje é ${ctx.hoje || "(data não informada)"}. Mês aberto no sistema: ${ctx.mes_sistema || "-"}.

SEU TRABALHO: transformar o pedido da Carol em lançamentos ou atualizações usando as funções.
- Comissão de contrato → lancar_comissao
- Conta/boleto da casa ou da empresa → lancar_despesa
- Gasto do dia a dia (mercado, gasolina, ifood, almoço, lazer) → lancar_gasto
- ATUALIZAR algo que já existe → atualizar_comissao (contratos/comissões) ou atualizar_despesa (contas, despesas, gastos).
  Exemplos: "paguei a conta de energia dia 10" → atualizar_despesa {busca:{nome:"energia"}, alteracoes:{status:"PAGO", data_pagamento:"AAAA-MM-10"}}
            "recebi a comissão da Maria Souza do BMG hoje" / "pago contrato Maria Souza" → atualizar_comissao {busca:{nome_cliente:"Maria Souza", banco:"BMG"}, alteracoes:{status:"PAGO", data_comissao_recebida: hoje}}
            "o banco pagou o cliente João dia 12" → atualizar_comissao alteracoes:{data_pagamento_cliente:"AAAA-MM-12"}
  Você NÃO precisa saber se o registro existe: o sistema procura e mostra o cadastro para a Carol confirmar.
  Na busca, coloque só o que ela disse (nome, banco, valor...). Em "alteracoes", só o que deve mudar.
  Se ela disser "pago"/"paguei" sem data, use hoje.
- Se ela pedir vários lançamentos ou atualizações na mesma mensagem, chame a função uma vez para cada.
- PERGUNTAS sobre os números ("quanto falta pra meta", "quais comissões estão em aberto", "quanto gastei de gasolina") →
  use o PANORAMA abaixo quando bastar; se precisar de detalhe, chame consultar_comissoes ou consultar_despesas e depois responda.
  Responda curto, com valores em R$ no formato brasileiro (R$ 1.234,56) e listas curtas. Nunca invente números.
- LOTE: "marca como pagas todas do BMG de setembro" → atualizar_comissoes_lote com filtro. "paguei todas as fixas da empresa" → atualizar_despesas_lote.
- IMAGENS/PDF anexados:
  • boleto, conta ou comprovante de pagamento → lancar_despesa (ou atualizar_despesa se for comprovante de uma conta que provavelmente já existe; na dúvida use lancar_despesa e explique)
  • relatório de CONTRATOS PAGOS / produção / propostas digitadas (lista de clientes com valores) → lancar_comissoes_lote com UM item por contrato,
    preenchendo nome, CPF, nº contrato/ADE, banco, modalidade, tipo de operação, valor, prazo, parcela, datas e % ou comissão quando houver.
    Leia TODAS as páginas e TODAS as linhas; não pule nenhum contrato. Datas sempre AAAA-MM-DD. "Data de pagamento"/"averbação" → data_pagamento_cliente.
    Se a data de digitação não aparecer, deixe vazia. Status da comissão ABERTO, a menos que o relatório diga que a comissão foi paga.
    O sistema confere sozinho quais contratos já existem, então mande todos.
    MÊS DE REFERÊNCIA: procure no documento "Período de Pagamento" (às vezes escrito com acento quebrado, como "PerÃ­odo de Pagamento"),
    "Referência", "Competência" ou "Mês de pagamento" e coloque o mês/ano em mes_referencia (AAAA-MM). Ex: "Período de Pagamento: 01/02/2026 a 28/02/2026" → "2026-02".
    Se a Carol disser o mês ("lança no mês 02/2026", "joga em fevereiro"), isso vale mais que o documento.
  • extrato/relatório de COMISSÕES RECEBIDAS do banco (o banco pagando a você) → atualizar_comissoes_lote com UM item por contrato (nome, CPF, nº contrato, valor, comissão) e alteracoes {status:"PAGO", data_comissao_recebida: data do extrato ou hoje}
  • tela de digitação/proposta/contrato de banco → lancar_comissao com o máximo de campos (CPF, nº contrato, prazo, parcela)
  • leia com cuidado; se algo estiver ilegível, deixe vazio em vez de chutar.
- "resumo do dia", "como está meu dia", "quem posso refinanciar", "faxina", "cadastros incompletos" → abrir_painel.
  "fecha outubro"/"fechamento do mês" → abrir_painel fechamento_mes; "raio-x", "como foi o mês" → raio_x;
  "onde está o dinheiro", "qual banco/produto paga melhor" → ranking (ou consultar_comissoes se for algo bem específico);
  "meus lembretes" → meus_lembretes; "quem posso refinanciar" → lembretes_refinanciamento.
- "lança igual o da X" / "repete o último" → repetir_lancamento.  Compra ou conta em parcelas → lancar_parcelado.
- "me mostra tudo da X", "ficha da X" → ficha_cliente.
- "exclui/apaga/remove o contrato/cadastro da X" → excluir_comissao. "exclui a despesa/gasto X" → excluir_despesa.
  Nunca proponha exclusão se ela não pediu. Um pedido por item (vários itens = chame várias vezes).  "me lembra de..." → criar_lembrete (calcule a data).

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
Categorias de gastos do mês: ${lista("categorias_gasto")}

PANORAMA ATUAL DO SISTEMA (calculado agora):
${JSON.stringify(ctx.panorama || {})}`;
}

type Parte = Record<string, unknown>;
function semAssinatura(conteudos: { role: string; parts: Parte[] }[]) {
  // ao trocar de modelo no meio de uma consulta, a assinatura do modelo anterior não vale
  return conteudos.map((c) => ({
    ...c,
    parts: c.parts.map((p) => (p.thoughtSignature ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p)),
  }));
}

async function chamarGemini(chave: string, corpo: Record<string, unknown>, preferido?: string) {
  let ultimoErro = "";
  const ordem = preferido ? [preferido, ...MODELOS.filter((m) => m !== preferido)] : MODELOS;
  for (const modelo of ordem) {
    const corpoModelo = preferido && modelo !== preferido
      ? { ...corpo, contents: semAssinatura(corpo.contents as { role: string; parts: Parte[] }[]) }
      : corpo;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(corpoModelo),
    });
    const txt = await r.text();
    if (r.ok) return { ...JSON.parse(txt), _modelo: modelo };
    ultimoErro = `Gemini (${modelo}) respondeu ${r.status}: ${txt.slice(0, 300)}`;
    console.warn(ultimoErro);
    if (!ERROS_TEMPORARIOS.includes(r.status)) break; // erro de chave/pedido: não adianta trocar
    await new Promise((ok) => setTimeout(ok, 600));
  }
  if (/\b(429|503|504|500)\b/.test(ultimoErro)) {
    throw new Error("O Gemini está sobrecarregado agora 😕 Tente de novo em 1 minuto.");
  }
  throw new Error(ultimoErro);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave) return json({ erro: "Secret GEMINI_API_KEY não configurado no Supabase." }, 500);

  // deno-lint-ignore no-explicit-any
  let entrada: any;
  try {
    entrada = await req.json();
  } catch {
    return json({ erro: "Corpo inválido" }, 400);
  }
  const mensagem = (entrada.mensagem || "").toString().slice(0, 4000);
  const anexos: { mime: string; base64: string }[] = Array.isArray(entrada.anexos) ? entrada.anexos.slice(0, 4) : [];
  if (!mensagem.trim() && !anexos.length) return json({ erro: "Mensagem vazia" }, 400);

  const historico = (entrada.historico || []).slice(-10).map((h: { papel: string; texto: string }) => ({
    role: h.papel === "ia" ? "model" : "user",
    parts: [{ text: String(h.texto || "").slice(0, 2000) }],
  }));

  const partesUsuario: Parte[] = [];
  for (const a of anexos) {
    if (a && a.base64 && /^(image\/|application\/pdf)/.test(a.mime || "")) {
      partesUsuario.push({ inlineData: { mimeType: a.mime, data: a.base64 } });
    }
  }
  partesUsuario.push({ text: mensagem || "Analise o arquivo anexado e faça o que for adequado." });

  const contents: { role: string; parts: Parte[] }[] = [...historico, { role: "user", parts: partesUsuario }];

  // 2ª rodada: o site executou as consultas e devolve os resultados
  const rodadas = Array.isArray(entrada.rodadas) ? entrada.rodadas.slice(0, 3) : [];
  for (const rd of rodadas) {
    contents.push({ role: "model", parts: rd.partes_modelo || [] });
    contents.push({
      role: "user",
      parts: (rd.respostas || []).map((x: { name: string; response: unknown }) => ({
        functionResponse: { name: x.name, response: { resultado: x.response } },
      })),
    });
  }

  const corpo = {
    systemInstruction: { parts: [{ text: montarInstrucoes(entrada.contexto || {}) }] },
    contents,
    tools: [{ functionDeclarations: FERRAMENTAS }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.1, maxOutputTokens: 32768 },
  };

  try {
    const resp = await chamarGemini(chave, corpo, rodadas.length ? entrada.modelo : undefined);
    const partes: Parte[] = resp?.candidates?.[0]?.content?.parts || [];
    const acoes = partes
      .filter((p) => p.functionCall)
      .map((p) => {
        const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
        return { acao: fc.name, dados: fc.args || {} };
      });
    const texto = partes
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text as string)
      .join("\n")
      .trim();
    return json({ texto, acoes, partes_modelo: partes, modelo: resp._modelo });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 502);
  }
});
