// Schema das tools que o agente pode chamar. Formato Anthropic Tool Use.
//
// Importante: este arquivo define apenas o SCHEMA visto pela LLM.
// A execução real é feita pelo `AgentToolImpl` injetado, em agent.ts.

import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_DEFS: Anthropic.Messages.Tool[] = [
  {
    name: "buscar_produto",
    description:
      "Busca produtos no catálogo por estilo, ocasião, tamanho, cores, restrições. Retorna até 5 produtos ranqueados pelo perfil da cliente e pelos pesos comerciais.",
    input_schema: {
      type: "object",
      properties: {
        estilo:    { type: "array", items: { type: "string" }, description: "Ex: moderno, evangelico, festa, fitness, romantico" },
        ocasiao:   { type: "array", items: { type: "string" }, description: "Ex: casamento, trabalho, igreja, balada" },
        tamanho:   { type: "string", description: "PP, P, M, G, GG" },
        cores:     { type: "array", items: { type: "string" } },
        semDecote: { type: "boolean" },
        semTransparencia: { type: "boolean" },
        precoMax:  { type: "number", description: "Preço máximo em BRL" },
      },
    },
  },
  {
    name: "buscar_por_foto",
    description:
      "Analisa a(s) FOTO(S) que a cliente acabou de enviar nesta mensagem e " +
      "encontra produtos PARECIDOS no catálogo (busca visual). Use sempre que a " +
      "cliente mandar uma imagem de uma peça e quiser algo igual/parecido. " +
      "A tool extrai estilo, ocasião, decote, comprimento e manga da foto e " +
      "retorna os produtos mais semelhantes da loja. Não exige argumentos: ela " +
      "já recebe as fotos da mensagem atual. Se não houver foto, retorna erro.",
    input_schema: {
      type: "object",
      properties: {
        precoMax: { type: "number", description: "Opcional: limita o preço máximo em BRL." },
        tamanho: { type: "string", description: "Opcional: PP, P, M, G, GG (se a cliente disse o tamanho)." },
      },
    },
  },
  {
    name: "mostrar_midia",
    description: "Envia uma foto ou vídeo do produto direto na conversa.",
    input_schema: {
      type: "object",
      required: ["produtoId"],
      properties: {
        produtoId: { type: "string" },
        tipo:      { type: "string", enum: ["foto", "video"], default: "foto" },
      },
    },
  },
  {
    name: "verificar_estoque",
    description: "Consulta estoque disponível de um SKU específico (após descontar reservas ativas).",
    input_schema: {
      type: "object",
      required: ["sku"],
      properties: {
        sku: { type: "string" },
      },
    },
  },
  {
    name: "consultar_frete",
    description: "Calcula opções de frete para um SKU até um CEP. Retorna serviços com preço e prazo.",
    input_schema: {
      type: "object",
      required: ["cep", "sku"],
      properties: {
        cep: { type: "string", description: "CEP de destino, somente dígitos" },
        sku: { type: "string" },
      },
    },
  },
  {
    name: "atualizar_perfil",
    description:
      "Atualiza o perfil persistente da cliente. Chame sempre que descobrir uma medida, estilo, ocasião ou preferência durante a conversa.",
    input_schema: {
      type: "object",
      properties: {
        name:            { type: "string" },
        height:          { type: "number", description: "cm" },
        bust:            { type: "number", description: "cm" },
        waist:           { type: "number", description: "cm" },
        hips:            { type: "number", description: "cm" },
        usualSize:       { type: "string" },
        styles:          { type: "array", items: { type: "string" } },
        occasions:       { type: "array", items: { type: "string" } },
        avoid:           { type: "array", items: { type: "string" } },
        favoriteColors:  { type: "array", items: { type: "string" } },
        preferredChannel:  { type: "string", enum: ["whatsapp", "instagram"] },
        preferredShipping: { type: "string", enum: ["fast", "cheap"] },
      },
    },
  },
  {
    name: "reservar_item",
    description:
      "Reserva uma unidade do SKU durante a conversa, com TTL. Trava o estoque pra que outra cliente não compre simultaneamente. Use quando a cliente demonstrar intenção clara de compra.",
    input_schema: {
      type: "object",
      required: ["sku"],
      properties: {
        sku:        { type: "string" },
        ttlMinutos: { type: "number", default: 15 },
      },
    },
  },
  {
    name: "criar_pedido",
    description:
      "Cria o pedido com os itens escolhidos e gera o PIX pra pagamento. " +
      "Use SÓ quando a cliente confirmou claramente que quer fechar a compra, " +
      "informou o CEP e escolheu o frete. Retorna o código PIX copia-e-cola.",
    input_schema: {
      type: "object",
      required: ["itens", "cep"],
      properties: {
        itens: {
          type: "array",
          items: {
            type: "object",
            required: ["sku", "quantidade"],
            properties: {
              sku:        { type: "string" },
              quantidade: { type: "number", default: 1 },
            },
          },
        },
        cep:          { type: "string", description: "CEP de entrega, só dígitos" },
        servicoFrete: { type: "string", description: "Serviço de transportadora escolhido (ex: 'Correios Sedex'). Opcional." },
        entregaPropria: { type: "boolean", description: "true se a entrega for própria (motoboy/carro da loja) em vez de transportadora. Use o que a cliente escolheu." },
        distanciaKm:    { type: "number", description: "Distância até a cliente em km. Obrigatório quando entregaPropria=true (calcula moto/carro e o valor)." },
      },
    },
  },
  {
    name: "status_pedido",
    description: "Consulta o status atual de um pedido: fase, rastreio, se pode cancelar ou devolver, prazo de devolução.",
    input_schema: {
      type: "object",
      required: ["pedidoId"],
      properties: { pedidoId: { type: "string" } },
    },
  },
  {
    name: "cancelar_pedido",
    description:
      "Cancela um pedido. Só funciona ANTES da postagem (regra CDC). Se já postou, " +
      "o sistema recusa e você deve orientar a cliente a usar devolução.",
    input_schema: {
      type: "object",
      required: ["pedidoId", "motivo"],
      properties: {
        pedidoId: { type: "string" },
        motivo:   { type: "string" },
      },
    },
  },
  {
    name: "iniciar_devolucao",
    description:
      "Inicia uma devolução de pedido já entregue, dentro do prazo legal (7 dias úteis). " +
      "O sistema valida o prazo — não prometa devolução sem chamar esta tool.",
    input_schema: {
      type: "object",
      required: ["pedidoId", "motivo"],
      properties: {
        pedidoId: { type: "string" },
        motivo:   { type: "string" },
      },
    },
  },
  {
    name: "escalar_para_humano",
    description:
      "Encaminha a conversa para um atendente humano. Use SEM HESITAR quando: cliente pede atendente, cliente está frustrada, situação delicada (reclamação séria, problema fiscal, caso especial), você falhou 3+ vezes em entender.",
    input_schema: {
      type: "object",
      required: ["motivo"],
      properties: {
        motivo: { type: "string", description: "Resumo curto para o atendente" },
      },
    },
  },
];

// Tools EXCLUSIVAS de lojas que fabricam (ADR-030 — Fase 4). Só são oferecidas
// ao agente quando o tenant tem `productionEnabled` (a app passa estes defs à
// parte). Mantê-las fora de TOOL_DEFS evita poluir o contexto de lojas de revenda.
export const PRODUCTION_TOOL_DEFS: Anthropic.Messages.Tool[] = [
  {
    name: "consultar_ficha",
    description:
      "Consulta a ficha técnica de um produto FABRICADO: do que é feito (ingredientes/insumos), " +
      "se é feito sob encomenda e o prazo de encomenda em dias. Use quando a cliente perguntar " +
      "ingredientes, composição, do que é feito, se tem tal item, ou em quanto tempo fica pronto. " +
      "Não invente ingredientes — responda só com o que a tool retornar.",
    input_schema: {
      type: "object",
      required: ["sku"],
      properties: {
        sku: { type: "string", description: "SKU/variante do produto" },
      },
    },
  },
  {
    name: "calcular_entrega_propria",
    description:
      "Calcula o custo da entrega própria (motoboy/carro da loja) — usada NO LUGAR da transportadora " +
      "quando a loja entrega por conta própria. O modal (moto ou carro) é escolhido pelo volume do pedido. " +
      "Se você ainda não sabe a distância, chame sem `distanceKm` para ver as faixas de preço e então " +
      "pergunte o bairro/distância à cliente. Se a entrega própria não estiver configurada, retorna " +
      "indisponível — aí use consultar_frete (transportadora).",
    input_schema: {
      type: "object",
      properties: {
        distanceKm: { type: "number", description: "Distância aproximada até a cliente, em km (se souber)." },
        itens: {
          type: "array",
          description: "Itens do pedido (para medir o volume e decidir moto/carro).",
          items: {
            type: "object",
            required: ["sku"],
            properties: {
              sku: { type: "string" },
              quantidade: { type: "number", default: 1 },
            },
          },
        },
      },
    },
  },
];
