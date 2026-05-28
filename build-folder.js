const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const FA = require("react-icons/fa");

async function iconPng(IconComponent, color = "#FFFFFF", size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// ===== Palette =====
const C = {
  ink:     "0F0E17",
  text:    "1F1F2E",
  cream:   "FAF5F0",
  paper:   "FFFFFF",
  muted:   "707080",
  rule:    "D6CFC4",
  accent:  "E94560",
  berry:   "6D2E46",
  gold:    "F59E0B",
  green:   "10B981",
  blue:    "3A85B0",
  purple:  "5B4080",
  pink:    "EC4899",
  whatsapp:"25D366",
};
const FONT_H = "Georgia";
const FONT_B = "Calibri";
const W = 13.333, H = 7.5;

async function main() {
  const I = {
    whatsapp:  await iconPng(FA.FaWhatsapp,         "#FFFFFF"),
    instagram: await iconPng(FA.FaInstagram,        "#FFFFFF"),
    robot:     await iconPng(FA.FaRobot,            "#FFFFFF"),
    user:      await iconPng(FA.FaUser,             "#FFFFFF"),
    cart:      await iconPng(FA.FaShoppingCart,     "#FFFFFF"),
    box:       await iconPng(FA.FaBoxOpen,          "#FFFFFF"),
    qrcode:    await iconPng(FA.FaQrcode,           "#FFFFFF"),
    truck:     await iconPng(FA.FaTruck,            "#FFFFFF"),
    pin:       await iconPng(FA.FaMapMarkerAlt,     "#FFFFFF"),
    home:      await iconPng(FA.FaHome,             "#FFFFFF"),
    heart:     await iconPng(FA.FaHeart,            "#FFFFFF"),
    undo:      await iconPng(FA.FaUndo,             "#FFFFFF"),
    industry:  await iconPng(FA.FaIndustry,         "#FFFFFF"),
    bullhorn:  await iconPng(FA.FaBullhorn,         "#FFFFFF"),
    chart:     await iconPng(FA.FaChartLine,        "#FFFFFF"),
    invoice:   await iconPng(FA.FaFileInvoiceDollar,"#FFFFFF"),
    bank:      await iconPng(FA.FaUniversity,       "#FFFFFF"),
    network:   await iconPng(FA.FaNetworkWired,     "#FFFFFF"),
    store:     await iconPng(FA.FaStore,            "#FFFFFF"),
    tag:       await iconPng(FA.FaTag,              "#FFFFFF"),
    ruler:     await iconPng(FA.FaRulerHorizontal,  "#FFFFFF"),
    palette:   await iconPng(FA.FaPalette,          "#FFFFFF"),
    search:    await iconPng(FA.FaSearch,           "#FFFFFF"),
    clock:     await iconPng(FA.FaClock,            "#FFFFFF"),
    star:      await iconPng(FA.FaStar,             "#FFFFFF"),
    handshake: await iconPng(FA.FaHandshake,        "#FFFFFF"),
    arrowR:    await iconPng(FA.FaArrowRight,       "#9CA3AF", 256),
    bell:      await iconPng(FA.FaBell,             "#FFFFFF"),
    cal:       await iconPng(FA.FaCalendarCheck,    "#FFFFFF"),
    smile:     await iconPng(FA.FaRegSmile,         "#FFFFFF"),
    boltDark:  await iconPng(FA.FaBolt,             "#E94560"),
    bolt:      await iconPng(FA.FaBolt,             "#FFFFFF"),
  };

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";

  // ============ helpers ============
  function moduleHeader(s, num, label) {
    s.addText(label, {
      x: 0.7, y: 0.5, w: 10, h: 0.4,
      fontFace: FONT_B, fontSize: 12, charSpacing: 5, color: C.accent, bold: true, margin: 0,
    });
    s.addText(`MÓD. ${String(num).padStart(2,"0")} / 09`, {
      x: W - 3.0, y: 0.5, w: 2.3, h: 0.4,
      fontFace: FONT_B, fontSize: 11, charSpacing: 4, color: C.muted, align: "right", margin: 0,
    });
  }

  function bigTitle(s, txt, y = 1.0, h = 1.4, size = 56) {
    s.addText(txt, {
      x: 0.7, y, w: W - 1.4, h,
      fontFace: FONT_H, fontSize: size, bold: true, color: C.ink, margin: 0, lineSpacingMultiple: 1.0,
    });
  }

  function tagLine(s, txt, y) {
    s.addText(txt, {
      x: 0.7, y, w: W - 1.4, h: 0.5,
      fontFace: FONT_H, fontSize: 18, italic: true, color: C.muted, margin: 0,
    });
  }

  function iconCircle(s, cx, cy, d, color, iconData) {
    s.addShape(pres.shapes.OVAL, {
      x: cx - d/2, y: cy - d/2, w: d, h: d, fill: { color }, line: { type: "none" },
      shadow: { type: "outer", color: "000000", blur: 12, offset: 3, angle: 90, opacity: 0.15 },
    });
    const pad = d * 0.25;
    s.addImage({ data: iconData, x: cx - d/2 + pad, y: cy - d/2 + pad, w: d - pad*2, h: d - pad*2 });
  }

  function arrow(s, x1, y, x2, color = C.rule) {
    const w = x2 - x1;
    // line
    s.addShape(pres.shapes.LINE, {
      x: x1, y, w, h: 0,
      line: { color, width: 2 },
    });
    // arrowhead (triangle)
    s.addShape(pres.shapes.RIGHT_TRIANGLE, {
      x: x2 - 0.18, y: y - 0.09, w: 0.18, h: 0.18,
      fill: { color }, line: { type: "none" }, rotate: 30,
    });
  }

  function tile(s, x, y, w, h, color, iconData, title, body) {
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w, h, fill: { color: C.paper }, line: { color: C.rule, width: 0.5 },
      shadow: { type: "outer", color: "000000", blur: 10, offset: 2, angle: 90, opacity: 0.06 },
    });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.08, h, fill: { color }, line: { type: "none" } });
    iconCircle(s, x + 0.7, y + 0.65, 0.7, color, iconData);
    s.addText(title, {
      x: x + 1.2, y: y + 0.3, w: w - 1.4, h: 0.5,
      fontFace: FONT_H, fontSize: 22, bold: true, color: C.ink, margin: 0,
    });
    s.addText(body, {
      x: x + 0.3, y: y + 1.4, w: w - 0.6, h: h - 1.6,
      fontFace: FONT_B, fontSize: 14, color: C.text, margin: 0, lineSpacingMultiple: 1.3,
    });
  }

  const TOTAL = 12;

  // ==========================================================
  // SLIDE 1 — COVER (split: dark left / cream right)
  // ==========================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.cream };
    // Dark block left
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 5.6, h: H, fill: { color: C.ink }, line: { type: "none" },
    });
    // Hero icon cluster on the dark side
    iconCircle(s, 2.8, 2.4, 1.7, C.accent,   I.robot);
    iconCircle(s, 1.55, 3.85, 1.2, C.whatsapp, I.whatsapp);
    iconCircle(s, 4.1,  3.85, 1.2, C.pink,    I.instagram);
    iconCircle(s, 2.0,  5.45, 1.0, C.gold,    I.bullhorn);
    iconCircle(s, 3.6,  5.45, 1.0, C.green,   I.chart);
    // Connecting lines
    [[2.8,2.4,1.55,3.85],[2.8,2.4,4.1,3.85],[1.55,3.85,2.0,5.45],[4.1,3.85,3.6,5.45]].forEach(([x1,y1,x2,y2]) => {
      s.addShape(pres.shapes.LINE, {
        x: x1, y: y1, w: x2-x1, h: y2-y1, line: { color: "FFFFFF", width: 1, transparency: 60 },
      });
    });
    // Cream side text
    s.addText("THE POP 7", {
      x: 6.2, y: 0.8, w: 6.5, h: 0.4,
      fontFace: FONT_B, fontSize: 12, bold: true, charSpacing: 6, color: C.accent, margin: 0,
    });
    s.addText("Plataforma\nde Comércio\nAutônomo", {
      x: 6.2, y: 1.6, w: 7, h: 4,
      fontFace: FONT_H, fontSize: 64, bold: true, color: C.ink, margin: 0, lineSpacingMultiple: 1.0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 6.2, y: 5.55, w: 1.5, h: 0.04, fill: { color: C.accent }, line: { type: "none" },
    });
    s.addText("Nove módulos. Operação 24 / 7.\nVisão geral em onze páginas.", {
      x: 6.2, y: 5.8, w: 6.5, h: 1.0,
      fontFace: FONT_H, fontSize: 20, italic: true, color: C.muted, margin: 0, lineSpacingMultiple: 1.3,
    });
  }

  // ==========================================================
  // SLIDE 2 — ARQUITETURA (hub with 9 module icons around)
  // ==========================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.cream };
    moduleHeader(s, 0, "ARQUITETURA");
    bigTitle(s, "Nove módulos. Um cérebro.", 0.95, 0.95, 44);

    const cx = W/2, cy = 4.6;
    const ringR = 3.8, ringRY = 1.5;

    // Subtle dashed ring
    s.addShape(pres.shapes.OVAL, {
      x: cx - ringR - 0.1, y: cy - ringRY - 0.1, w: (ringR + 0.1) * 2, h: (ringRY + 0.1) * 2,
      fill: { type: "none" }, line: { color: C.rule, width: 1, dashType: "dash" },
    });

    // Core
    iconCircle(s, cx, cy, 1.6, C.ink, I.robot);
    s.addText("NÚCLEO", {
      x: cx - 1.0, y: cy + 0.95, w: 2.0, h: 0.3,
      fontFace: FONT_B, fontSize: 11, bold: true, charSpacing: 4, color: C.accent, align: "center", margin: 0,
    });

    const mods = [
      { ang: 270, n:"01", t:"Atendimento",   col: C.whatsapp, ic: I.whatsapp },
      { ang: 310, n:"02", t:"Catálogo",      col: C.pink,     ic: I.tag },
      { ang: 350, n:"03", t:"Pedido",        col: C.berry,    ic: I.cart },
      { ang: 30,  n:"04", t:"Logística",     col: C.purple,   ic: I.truck },
      { ang: 70,  n:"05", t:"Pós-venda",     col: C.accent,   ic: I.heart },
      { ang: 110, n:"06", t:"Compras",       col: "B85042",   ic: I.industry },
      { ang: 150, n:"07", t:"Mídia paga",    col: C.gold,     ic: I.bullhorn },
      { ang: 190, n:"08", t:"Financeiro",    col: C.green,    ic: I.chart },
      { ang: 230, n:"09", t:"Rede B2B",      col: C.blue,     ic: I.network },
    ];
    mods.forEach(m => {
      const rad = (m.ang * Math.PI) / 180;
      const x = cx + Math.cos(rad) * ringR;
      const y = cy + Math.sin(rad) * ringRY;
      // line
      s.addShape(pres.shapes.LINE, {
        x: cx, y: cy, w: x-cx, h: y-cy,
        line: { color: C.rule, width: 1 },
      });
      iconCircle(s, x, y, 0.95, m.col, m.ic);
      // Push label radially outward, away from the center, so labels never collide with other icons
      const radOff = 1.15;
      const lxC = cx + Math.cos(rad) * (ringR + radOff);
      const lyC = cy + Math.sin(rad) * (ringRY + radOff);
      const labelW = 2.0;
      s.addText(m.n, {
        x: lxC - labelW/2, y: lyC - 0.22, w: labelW, h: 0.25,
        fontFace: FONT_B, fontSize: 9, bold: true, charSpacing: 3, color: C.muted, align: "center", margin: 0,
      });
      s.addText(m.t, {
        x: lxC - labelW/2, y: lyC, w: labelW, h: 0.35,
        fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink, align: "center", margin: 0,
      });
    });

    s.addText(`02 / ${TOTAL}`, {
      x: W - 1.5, y: H - 0.5, w: 0.8, h: 0.3,
      fontFace: FONT_B, fontSize: 9, color: C.muted, align: "right", margin: 0,
    });
  }

  // ==========================================================
  // MODULE TEMPLATE: hero number + flow + 3 tiles
  // ==========================================================
  function moduleSlide(num, label, title, oneLiner, color, flow, tiles) {
    const s = pres.addSlide();
    s.background = { color: C.cream };
    moduleHeader(s, num, label);

    // Big module number (left), title (right of number)
    s.addText(String(num).padStart(2,"0"), {
      x: 0.6, y: 0.95, w: 2.0, h: 1.6,
      fontFace: FONT_H, fontSize: 96, bold: true, color: color, margin: 0,
    });
    s.addText(title, {
      x: 2.5, y: 1.05, w: 9, h: 1.0,
      fontFace: FONT_H, fontSize: 40, bold: true, color: C.ink, margin: 0,
    });
    s.addText(oneLiner, {
      x: 2.5, y: 1.95, w: 10.3, h: 0.5,
      fontFace: FONT_H, fontSize: 18, italic: true, color: C.muted, margin: 0,
    });

    // FLOW — horizontal row of icon circles with labels and arrows
    const flowY = 3.4;
    const slots = flow.length;
    const spanX = W - 2.0;
    const startX = 1.0;
    const step = spanX / (slots - 1);

    flow.forEach((node, i) => {
      const x = startX + step * i;
      iconCircle(s, x, flowY, 1.05, node.color || color, node.icon);
      s.addText(node.label, {
        x: x - 1.3, y: flowY + 0.75, w: 2.6, h: 0.4,
        fontFace: FONT_B, fontSize: 13, bold: true, color: C.ink, align: "center", margin: 0,
      });
      if (i < slots - 1) {
        // arrow chevron between circles
        const ax1 = x + 0.6, ax2 = startX + step * (i+1) - 0.6;
        s.addShape(pres.shapes.LINE, {
          x: ax1, y: flowY, w: ax2 - ax1, h: 0,
          line: { color: C.rule, width: 1.5, endArrowType: "triangle" },
        });
      }
    });

    // 3 tiles
    const tileY = 5.0, tileH = 2.0;
    const gap = 0.25;
    const tileW = (W - 1.4 - gap * 2) / 3;
    tiles.forEach((t, i) => {
      const x = 0.7 + i * (tileW + gap);
      tile(s, x, tileY, tileW, tileH, t.color || color, t.icon, t.title, t.body);
    });

    s.addText(`${num + 2} / ${TOTAL}`, {
      x: W - 1.5, y: H - 0.45, w: 0.8, h: 0.3,
      fontFace: FONT_B, fontSize: 9, color: C.muted, align: "right", margin: 0,
    });
    return s;
  }

  // === MÓDULO 1: Atendimento ===
  moduleSlide(1, "ATENDIMENTO", "Vendedora 24 / 7.", "WhatsApp e Instagram, com IA que lembra cada cliente.", C.whatsapp,
    [
      { icon: I.whatsapp,  label: "Cliente fala",   color: C.whatsapp },
      { icon: I.robot,     label: "IA entende",     color: C.ink },
      { icon: I.search,    label: "Consulta tudo",  color: C.blue },
      { icon: I.heart,     label: "Resposta humana",color: C.accent },
    ],
    [
      { icon: I.user,     title: "Perfil persistente", body: "Medidas, estilo, ocasião, cores, restrições. A próxima conversa começa personalizada." },
      { icon: I.instagram,title: "Cross-canal",        body: "WhatsApp e Instagram com mesmo histórico, mesma cliente." },
      { icon: I.box,      title: "Decide com dado",    body: "Catálogo, estoque, frete e perfil consultados em tempo real." },
    ]
  );

  // === MÓDULO 2: Catálogo ===
  moduleSlide(2, "CATÁLOGO E PRODUTO", "Produto que se vende.", "Atributos enriquecidos viram recomendação certeira.", C.pink,
    [
      { icon: I.tag,     label: "Importa do ERP",  color: C.berry },
      { icon: I.palette, label: "IA enriquece",    color: C.pink },
      { icon: I.search,  label: "Busca semântica", color: C.blue },
      { icon: I.smile,   label: "Sugestão certa",  color: C.green },
    ],
    [
      { icon: I.ruler,   title: "Medidas reais",      body: "Busto, cintura, quadril por tamanho. Cliente compra o que serve." },
      { icon: I.palette, title: "Estilo e ocasião",   body: "Moderno, festa, evangélico, fitness, igreja. Decote, transparência, comprimento." },
      { icon: I.chart,   title: "Margem e giro",      body: "Score de adequação considera o que vende, o que dá lucro e o que está parado." },
    ]
  );

  // === MÓDULO 3: Pedido & Pagamento ===
  moduleSlide(3, "PEDIDO & PAGAMENTO", "Do interesse ao pago.", "Reserva, PIX e NFe — sem sair da conversa.", C.berry,
    [
      { icon: I.cart,    label: "Intenção",        color: C.accent },
      { icon: I.box,     label: "Reserva 15min",   color: C.berry },
      { icon: I.qrcode,  label: "PIX no chat",     color: C.ink },
      { icon: I.invoice, label: "NFe emitida",     color: C.green },
    ],
    [
      { icon: I.box,     title: "Estoque transacional", body: "Reserva por conversa. Nunca vende duas vezes a mesma peça." },
      { icon: I.qrcode,  title: "Pagamento no canal",   body: "QR Code PIX, link de cartão e boleto entregues direto no chat." },
      { icon: I.invoice, title: "Fiscal automático",    body: "NFe emitida no momento da venda. Sem você lançar nada." },
    ]
  );

  // === MÓDULO 4: Logística ===
  moduleSlide(4, "LOGÍSTICA & ENTREGA", "Da etiqueta à porta.", "Cliente sabe onde está o pedido. Sempre.", C.purple,
    [
      { icon: I.tag,   label: "Etiqueta",        color: C.purple },
      { icon: I.truck, label: "Em trânsito",     color: C.blue },
      { icon: I.pin,   label: "Saiu para entrega", color: C.gold },
      { icon: I.home,  label: "Entregue",        color: C.green },
    ],
    [
      { icon: I.bolt,  title: "Transportadora ideal", body: "Sistema escolhe por preço, prazo e histórico. Falhou? Vai pra próxima.", color: C.gold },
      { icon: I.bell,  title: "Notificação proativa", body: "Cliente recebe atualização a cada fase. Sem perguntar." },
      { icon: I.smile, title: "Confirmação completa", body: "Data, hora e quem recebeu. Prazo legal de devolução comunicado." },
    ]
  );

  // === MÓDULO 5: Pós-venda ===
  moduleSlide(5, "PÓS-VENDA & DEVOLUÇÃO", "Cliente vira fã.", "Acompanhamento, NPS e devolução sem dor.", C.accent,
    [
      { icon: I.cal,   label: "D + 1",   color: C.green },
      { icon: I.cal,   label: "D + 7",   color: C.gold },
      { icon: I.cal,   label: "D + 14",  color: C.purple },
      { icon: I.cal,   label: "D + 30",  color: C.accent },
    ],
    [
      { icon: I.heart, title: "Toques proativos", body: "Boas-vindas, prazo, NPS, recompra. Tudo agendado por evento de entrega." },
      { icon: I.undo,  title: "Devolução guiada", body: "Fluxo completo de RMA: solicitação, etiqueta reversa, análise, reembolso." },
      { icon: I.star,  title: "Reativação",       body: "Cliente parada recebe oferta personalizada com base no perfil." },
    ]
  );

  // === MÓDULO 6: Compras ===
  moduleSlide(6, "COMPRAS & FORNECEDORES", "A IA compra por você.", "Reposição preditiva, cotação automática, PIX pago.", "B85042",
    [
      { icon: I.chart,    label: "Detecta",      color: C.green },
      { icon: I.handshake,label: "Cota com N",   color: "B85042" },
      { icon: I.star,     label: "Ranqueia",     color: C.gold },
      { icon: I.qrcode,   label: "Paga PIX",     color: C.ink },
    ],
    [
      { icon: I.bolt,      title: "Antecipa o pedido",   body: "Velocidade × lead time = ponto ótimo. Dispara antes de faltar.", color: C.gold },
      { icon: I.handshake, title: "Cotação multi-canal", body: "Email e WhatsApp. Lê resposta em texto, foto de tabela ou áudio.", color: "B85042" },
      { icon: I.invoice,   title: "Fechamento e PIX",    body: "Aprova até o limite, paga, envia comprovante, acompanha envio." },
    ]
  );

  // === MÓDULO 7: Mídia paga ===
  moduleSlide(7, "MÍDIA PAGA (META ADS)", "Anúncio que se otimiza.", "Cria, segmenta e mede com seus próprios dados.", C.gold,
    [
      { icon: I.palette,  label: "Cria criativo",      color: C.pink },
      { icon: I.user,     label: "Define público",     color: C.purple },
      { icon: I.bullhorn, label: "Anuncia FB + IG",    color: C.gold },
      { icon: I.whatsapp, label: "Click pra Maya",     color: C.whatsapp },
    ],
    [
      { icon: I.palette,  title: "Criativo por IA",        body: "Texto, imagem e vídeo curto. Variações testadas, vencedoras escaladas." },
      { icon: I.user,     title: "Públicos do seu CRM",    body: "Clientes fiéis, ticket alto, lookalike das melhores. Não terceirizado." },
      { icon: I.chart,    title: "Atribuição real",        body: "Conversions API liga anúncio → conversa → venda. Sem dependência de pixel." },
    ]
  );

  // === MÓDULO 8: Fiscal & Financeiro ===
  moduleSlide(8, "FISCAL & FINANCEIRO", "Fecha o mês no painel.", "Custo, margem e conciliação em tempo real.", C.green,
    [
      { icon: I.invoice, label: "NFe emitida",       color: C.green },
      { icon: I.chart,   label: "Margem real",       color: C.ink },
      { icon: I.bank,    label: "Banco concilia",    color: C.blue },
      { icon: I.bell,    label: "Alerta opera",      color: C.accent },
    ],
    [
      { icon: I.invoice, title: "Fiscal automático",   body: "NFe e NFCe a cada venda, via emissor terceiro com cadeia de substitutos." },
      { icon: I.chart,   title: "Margem por venda",    body: "Custo do produto, frete, gateway, IA — descontados por pedido." },
      { icon: I.bank,    title: "Conciliação banco",   body: "Open Finance lê extrato. Pix automático paga fornecedor com seu limite." },
    ]
  );

  // === MÓDULO 9: Rede B2B ===
  moduleSlide(9, "REDE DE ATACADO B2B", "Seu catálogo vende sozinho.", "Outras lojas e agentes IA compram em grosso via MCP.", C.blue,
    [
      { icon: I.store,   label: "Você expõe",     color: C.blue },
      { icon: I.network, label: "Rede MCP",       color: C.purple },
      { icon: I.cart,    label: "Outras compram", color: C.berry },
      { icon: I.invoice, label: "Nota emitida",   color: C.green },
    ],
    [
      { icon: I.store,   title: "Você controla",    body: "Define preço atacado, mínimo de quantidade e região atendida." },
      { icon: I.network, title: "MCP padrão aberto", body: "Outros sistemas se conectam, buscam, cotam e compram do seu estoque." },
      { icon: I.handshake,title: "Compra cruzada",  body: "Você também compra de outros tenants da rede. Mais rápido que importar." },
    ]
  );

  // ==========================================================
  // SLIDE 11 — INTEGRAÇÕES (visual grid)
  // ==========================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.cream };
    s.addText("INTEGRAÇÕES EXTERNAS", {
      x: 0.7, y: 0.5, w: 10, h: 0.4,
      fontFace: FONT_B, fontSize: 12, charSpacing: 5, color: C.accent, bold: true, margin: 0,
    });
    s.addText("ANEXO", {
      x: W - 2.5, y: 0.5, w: 1.8, h: 0.4,
      fontFace: FONT_B, fontSize: 11, charSpacing: 4, color: C.muted, align: "right", margin: 0,
    });
    bigTitle(s, "Conectado ao essencial.", 0.95, 1.0, 40);
    tagLine(s, "Cada categoria com cadeia de substitutos automática.", 2.05);

    const cats = [
      { col: C.whatsapp, ic: I.whatsapp, t: "Canais Meta",    p: ["WhatsApp Cloud API","Instagram Graph API"] },
      { col: C.gold,     ic: I.bullhorn, t: "Mídia Meta",     p: ["Marketing API","Conversions API","Commerce Catalog"] },
      { col: C.berry,    ic: I.store,    t: "ERP",            p: ["Bling","Tray","Nuvemshop","Tiny"] },
      { col: C.purple,   ic: I.truck,    t: "Logística",      p: ["Melhor Envio","Frete Rápido","Kangu","Loggi"] },
      { col: C.green,    ic: I.bank,     t: "Pagamento",      p: ["Mercado Pago","PagBank","Asaas"] },
      { col: C.blue,     ic: I.invoice,  t: "Fiscal",         p: ["PlugNotas","Focus NFe","eNotas"] },
      { col: C.ink,      ic: I.chart,    t: "Financeiro",     p: ["Open Finance","APIs bancárias","Pix Automático"] },
      { col: C.accent,   ic: I.robot,    t: "Inteligência",   p: ["Anthropic Claude","Modelos de imagem","Embeddings"] },
    ];
    const cols = 4, gap = 0.22;
    const cardW = (W - 1.4 - gap * (cols - 1)) / cols;
    const cardH = 1.95;
    const startX = 0.7, startY = 2.85;

    cats.forEach((c, i) => {
      const r = Math.floor(i / cols), col = i % cols;
      const x = startX + col * (cardW + gap);
      const y = startY + r * (cardH + gap);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y, w: cardW, h: cardH, fill: { color: C.paper },
        line: { color: C.rule, width: 0.5 },
        shadow: { type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.06 },
      });
      iconCircle(s, x + cardW/2, y + 0.55, 0.7, c.col, c.ic);
      s.addText(c.t, {
        x: x + 0.1, y: y + 1.0, w: cardW - 0.2, h: 0.35,
        fontFace: FONT_H, fontSize: 16, bold: true, color: C.ink, align: "center", margin: 0,
      });
      s.addText(c.p.join("  ·  "), {
        x: x + 0.15, y: y + 1.36, w: cardW - 0.3, h: 0.55,
        fontFace: FONT_B, fontSize: 10, color: C.muted, italic: true, align: "center", margin: 0, lineSpacingMultiple: 1.3,
      });
    });

    s.addText(`${TOTAL} / ${TOTAL}`, {
      x: W - 1.5, y: H - 0.45, w: 0.8, h: 0.3,
      fontFace: FONT_B, fontSize: 9, color: C.muted, align: "right", margin: 0,
    });
  }

  await pres.writeFile({ fileName: "C:/tp7/Folder-Comercial.pptx" });
  console.log("Saved");
}

main().catch(e => { console.error(e); process.exit(1); });
