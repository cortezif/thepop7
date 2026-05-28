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
        servicoFrete: { type: "string", description: "Serviço escolhido (ex: 'Correios Sedex'). Opcional." },
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
