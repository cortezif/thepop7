import { getPrisma, withTenant, encryptPII, decryptPII, hashPII, type Prisma } from "@hubadvisor/db";
import type { FastifyBaseLogger } from "fastify";

type Tx = Prisma.TransactionClient;

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/**
 * Funde dois contatos do mesmo cliente (ADR-015): reatribui conversas, pedidos
 * e reservas pro primário, completa identificadores/perfil que faltam e une as
 * listas (estilos, ocasiões, opt-outs...). Apaga o secundário. Opera dentro de tx.
 * O primário é o mais antigo (preserva histórico/ID mais estável).
 */
export async function mergeContacts(tx: Tx, tenantId: string, idA: string, idB: string) {
  if (idA === idB) return { merged: false, primaryId: idA, reason: "mesmo contato" };

  const a = await tx.contact.findUnique({ where: { id: idA } });
  const b = await tx.contact.findUnique({ where: { id: idB } });
  if (!a || !b) throw new Error("contato(s) não encontrado(s) para merge");

  // Primário = mais antigo. Secundário é absorvido.
  const [primary, secondary] = a.createdAt <= b.createdAt ? [a, b] : [b, a];

  // Reatribui relações do secundário pro primário.
  await tx.conversation.updateMany({ where: { contactId: secondary.id }, data: { contactId: primary.id } });
  await tx.order.updateMany({ where: { contactId: secondary.id }, data: { contactId: primary.id } });
  await tx.stockReservation.updateMany({ where: { contactId: secondary.id }, data: { contactId: primary.id } });

  // Funde campos: primário manda; preenche nulos com o secundário; une arrays.
  await tx.contact.update({
    where: { id: primary.id },
    data: {
      name:           primary.name ?? secondary.name,
      // phone/email/cpf são ciphertext — copia junto com o respectivo hash.
      phone:          primary.phone ?? secondary.phone,
      phoneHash:      primary.phoneHash ?? secondary.phoneHash,
      igHandle:       primary.igHandle ?? secondary.igHandle,
      email:          primary.email ?? secondary.email,
      emailHash:      primary.emailHash ?? secondary.emailHash,
      cpf:            primary.cpf ?? secondary.cpf,
      cpfHash:        primary.cpfHash ?? secondary.cpfHash,
      height:         primary.height ?? secondary.height,
      bust:           primary.bust ?? secondary.bust,
      waist:          primary.waist ?? secondary.waist,
      hips:           primary.hips ?? secondary.hips,
      usualSize:      primary.usualSize ?? secondary.usualSize,
      preferredChannel:  primary.preferredChannel ?? secondary.preferredChannel,
      preferredShipping: primary.preferredShipping ?? secondary.preferredShipping,
      styles:         uniq([...primary.styles, ...secondary.styles]),
      occasions:      uniq([...primary.occasions, ...secondary.occasions]),
      avoid:          uniq([...primary.avoid, ...secondary.avoid]),
      favoriteColors: uniq([...primary.favoriteColors, ...secondary.favoriteColors]),
      optOuts:        uniq([...primary.optOuts, ...secondary.optOuts]),
      consentLGPD:    primary.consentLGPD || secondary.consentLGPD,
    },
  });

  await tx.contact.delete({ where: { id: secondary.id } });

  await tx.domainEvent.create({
    data: {
      tenantId, type: "contact.merged", aggregateType: "contact", aggregateId: primary.id,
      payload: { primaryId: primary.id, mergedId: secondary.id } as any, actor: "system",
    },
  });

  return { merged: true, primaryId: primary.id, mergedId: secondary.id };
}

/**
 * Resolve o contato de uma mensagem que chega, fundindo on-the-fly quando os
 * canais convergem (ADR-015): se os identificadores informados batem com mais
 * de um contato existente, eles são fundidos. Caso 1 → backfill de identificador.
 * Caso 0 → cria. Sempre devolve o contato canônico.
 */
export async function resolveContact(
  tx: Tx, tenantId: string,
  ids: { phone?: string; igHandle?: string; email?: string; name?: string }
) {
  // Busca por HASH (phone/email cifrados não são pesquisáveis por texto). igHandle é texto puro.
  const ors: Prisma.ContactWhereInput[] = [];
  if (ids.phone)    ors.push({ phoneHash: hashPII(ids.phone) });
  if (ids.igHandle) ors.push({ igHandle: ids.igHandle });
  if (ids.email)    ors.push({ emailHash: hashPII(ids.email) });

  let matches = ors.length
    ? await tx.contact.findMany({ where: { tenantId, OR: ors }, orderBy: { createdAt: "asc" } })
    : [];

  if (matches.length === 0) {
    return tx.contact.create({
      data: {
        tenantId, igHandle: ids.igHandle, name: ids.name,
        phone: encryptPII(ids.phone), phoneHash: hashPII(ids.phone),
        email: encryptPII(ids.email), emailHash: hashPII(ids.email),
      },
    });
  }

  // Convergência: vários contatos batem → funde todos no mais antigo.
  let primaryId = matches[0]!.id;
  for (let i = 1; i < matches.length; i++) {
    const r = await mergeContacts(tx, tenantId, primaryId, matches[i]!.id);
    primaryId = r.primaryId;
  }

  // Backfill: completa identificador novo que o contato canônico ainda não tinha
  // (usa a presença do *Hash pra saber se o campo já está preenchido).
  const canonical = await tx.contact.findUnique({ where: { id: primaryId } });
  const patch: Prisma.ContactUpdateInput = {};
  if (ids.phone && !canonical!.phoneHash) { patch.phone = encryptPII(ids.phone); patch.phoneHash = hashPII(ids.phone); }
  if (ids.igHandle && !canonical!.igHandle) patch.igHandle = ids.igHandle;
  if (ids.email && !canonical!.emailHash) { patch.email = encryptPII(ids.email); patch.emailHash = hashPII(ids.email); }
  if (ids.name && !canonical!.name) patch.name = ids.name;
  if (Object.keys(patch).length) {
    return tx.contact.update({ where: { id: primaryId }, data: patch });
  }
  return canonical!;
}

/**
 * Lista grupos de contatos que parecem ser a mesma pessoa (compartilham um
 * identificador forte: phone, igHandle, email ou cpf). Pro painel sugerir merge.
 */
export async function findDuplicateContacts(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.contact.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, phone: true, igHandle: true, email: true, cpf: true, phoneHash: true, emailHash: true, cpfHash: true, createdAt: true },
    });

    // Grupos por identificador forte usam os HASHES (ciphertext não dá pra comparar:
    // mesmo valor → ciphertext diferente por IV aleatório).
    const groups = new Map<string, typeof rows>();
    for (const c of rows) {
      for (const key of [
        c.phoneHash && `phone:${c.phoneHash}`,
        c.igHandle && `ig:${c.igHandle}`,
        c.emailHash && `email:${c.emailHash}`,
        c.cpfHash && `cpf:${c.cpfHash}`,
      ].filter(Boolean) as string[]) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(c);
      }
    }

    // View decifrada pra exibição no painel (nunca devolve ciphertext nem hashes).
    type View = { id: string; name: string | null; phone: string | null; igHandle: string | null; email: string | null; cpf: string | null; createdAt: Date };
    const view = (c: (typeof rows)[number]): View => ({
      id: c.id, name: c.name, igHandle: c.igHandle, createdAt: c.createdAt,
      phone: decryptPII(c.phone), email: decryptPII(c.email), cpf: decryptPII(c.cpf),
    });

    const seen = new Set<string>();
    const candidates: Array<{ sharedBy: string; confidence: "alta" | "baixa"; contacts: View[] }> = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const sig = members.map((m) => m.id).sort().join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      candidates.push({ sharedBy: key.split(":")[0]!, confidence: "alta", contacts: members.map(view) });
    }

    // Tier fuzzy por NOME (baixa confiança, ADR-015): nomes equivalentes após
    // normalizar (sem acento/caixa/pontuação). Só sugestão — merge continua manual.
    const byName = new Map<string, typeof rows>();
    for (const c of rows) {
      const norm = normalizeName(c.name);
      if (norm.length < 4) continue;
      if (!byName.has(norm)) byName.set(norm, []);
      byName.get(norm)!.push(c);
    }
    for (const members of byName.values()) {
      if (members.length < 2) continue;
      const sig = members.map((m) => m.id).sort().join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      candidates.push({ sharedBy: "nome", confidence: "baixa", contacts: members.map(view) });
    }

    return candidates;
  });
}

/** Normaliza nome pra comparação fuzzy: minúsculas, sem acento, sem pontuação, espaços colapsados. */
function normalizeName(name: string | null): string {
  if (!name) return "";
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wrapper transacional pro merge manual disparado pelo painel. */
export async function mergeContactsByIds(tenantSlug: string, idA: string, idB: string, log: FastifyBaseLogger) {
  const tenant = await getPrisma().tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new Error(`Tenant não encontrado: ${tenantSlug}`);
  const result = await withTenant(tenant.id, (tx) => mergeContacts(tx, tenant.id, idA, idB));
  log.info({ ...result }, "merge de contatos (ADR-015)");
  return result;
}
