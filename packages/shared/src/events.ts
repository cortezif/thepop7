// Nomes canônicos de eventos do sistema. Tudo que atravessa o boundary
// vira evento aqui pra ficar auditável e roteável.

export const EVENTS = {
  // Conversa
  MESSAGE_RECEIVED: "message.received",
  MESSAGE_SENT: "message.sent",
  CONVERSATION_HANDED_OFF: "conversation.handed_off",

  // Pedido
  ORDER_CREATED: "order.created",
  ORDER_PAID: "order.paid",
  ORDER_SHIPPED: "order.shipped",
  ORDER_DELIVERED: "order.delivered",
  ORDER_CANCELED: "order.canceled",

  // Estoque
  RESERVATION_CREATED: "reservation.created",
  RESERVATION_RELEASED: "reservation.released",
  RESERVATION_CONVERTED: "reservation.converted",

  // Devolução
  RETURN_REQUESTED: "return.requested",
  RETURN_APPROVED: "return.approved",
  RETURN_REFUNDED: "return.refunded",

  // Catálogo
  PRODUCT_SYNCED: "product.synced",
  PRODUCT_ENRICHED: "product.enriched",

  // Pós-venda agendados
  POSTSALE_D1: "postsale.d1",
  POSTSALE_D7: "postsale.d7",
  POSTSALE_D14: "postsale.d14",
  POSTSALE_D30: "postsale.d30",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
