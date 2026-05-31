import { Fragment, useEffect, useRef, useState } from "react";
import { Bot, User, Send, Wrench, Sparkles, Brain, AlertTriangle, MessageCircle, Tag, StickyNote, UserCheck, CheckCircle2, FlaskConical, Pin } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { Card, Button, Badge, EmptyState, Tabs, inputClass } from "../components/ui";
import { api, type Conversation, type Message, type ConversationNote } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

type StatusFilter = "all" | "active" | "handed_off" | "closed";

export function Inbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [newTag, setNewTag] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const threadRef = useRef<HTMLDivElement>(null);

  async function loadNotes(id: string) {
    try { setNotes(await api.listNotes(id)); } catch { /* ignora */ }
  }
  async function addTag() {
    if (!selected || !newTag.trim() || !current) return;
    const tags = [...new Set([...(current.tags ?? []), newTag.trim().toLowerCase()])];
    setNewTag("");
    try { await api.setTags(selected, tags); await loadConversations(); } catch (e) { setError(String(e)); }
  }
  async function removeTag(tag: string) {
    if (!selected || !current) return;
    const tags = (current.tags ?? []).filter((t) => t !== tag);
    try { await api.setTags(selected, tags); await loadConversations(); } catch (e) { setError(String(e)); }
  }
  async function addNote() {
    if (!selected || !newNote.trim()) return;
    setNewNote("");
    try { await api.addNote(selected, newNote.trim()); await loadNotes(selected); } catch (e) { setError(String(e)); }
  }
  async function removeNote(noteId: string) {
    if (!selected) return;
    setNotes((ns) => ns.filter((n) => n.id !== noteId)); // otimista
    try { await api.deleteNote(selected, noteId); } catch (e) { setError(String(e)); loadNotes(selected); }
  }
  async function togglePin(noteId: string, pinned: boolean) {
    if (!selected) return;
    try { await api.pinNote(selected, noteId, pinned); await loadNotes(selected); } catch (e) { setError(String(e)); }
  }
  async function toggleAssign() {
    if (!selected || !current) return;
    try { await api.assignToMe(selected, !!current.assignedToId); await loadConversations(); } catch (e) { setError(String(e)); }
  }

  async function loadConversations() {
    try {
      const list = await api.listConversations();
      setConversations(list);
      if (!selected && list.length > 0) setSelected(list[0]!.id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadMessages(id: string) {
    try {
      setMessages(await api.listMessages(id));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { if (selected) { loadMessages(selected); loadNotes(selected); setReply(""); setSuggested(false); } }, [selected]);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  async function handleReply() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await api.reply(selected, reply.trim());
      setReply("");
      setSuggested(false);
      await loadMessages(selected);
      await loadConversations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function handleSuggest() {
    if (!selected) return;
    setSuggesting(true);
    setError(null);
    try {
      const r = await api.suggestReply(selected);
      if (r.suggestion) {
        setReply(r.suggestion);
        setSuggested(true);
      } else {
        setError(r.note ?? "Sem sugestão disponível.");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleClose() {
    if (!selected) return;
    try {
      await api.setStatus(selected, "closed");
      await loadConversations();
    } catch (e) {
      setError(String(e));
    }
  }

  const current = conversations.find((c) => c.id === selected);
  const counts = {
    all: conversations.length,
    active: conversations.filter((c) => c.status === "active").length,
    handed_off: conversations.filter((c) => c.status === "handed_off").length,
    closed: conversations.filter((c) => c.status === "closed").length,
  };
  const visible = filter === "all" ? conversations : conversations.filter((c) => c.status === filter);

  return (
    <div className="flex h-screen flex-col bg-background px-8 pb-6 pt-10 lg:px-10">
      <PageHeader eyebrow="ATENDIMENTO" title="Inbox unificado" subtitle="Conversas de WhatsApp e Instagram em um só lugar — a Maya atende, você assume quando quiser." />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle size={15} className="shrink-0" /> {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-5 overflow-hidden xl:grid-cols-[340px_1fr_300px]">
        {/* ── Lista de conversas ──────────────────────────────────────────── */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <div className="border-b border-border px-4 pb-3 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif text-base font-semibold text-foreground">Conversas</h3>
              <Badge tone="accent">{conversations.length}</Badge>
            </div>
            <Tabs
              tabs={[
                { key: "all", label: "Todas", count: counts.all },
                { key: "active", label: "Ativas", count: counts.active },
                { key: "handed_off", label: "Humano", count: counts.handed_off },
                { key: "closed", label: "Fechadas", count: counts.closed },
              ]}
              active={filter}
              onChange={setFilter}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visible.length === 0 ? (
              <div className="px-3 py-10">
                <EmptyState
                  icon={MessageCircle}
                  title="Nenhuma conversa"
                  description="Use o simulador de cliente abaixo para criar uma conversa de teste."
                />
              </div>
            ) : (
              <ul className="space-y-1">
                {visible.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelected(c.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        selected === c.id ? "bg-accent-soft" : "hover:bg-muted/60",
                      )}
                    >
                      <Avatar name={c.contactName} active={selected === c.id} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{c.contactName}</span>
                          <StatusBadge status={c.status} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.lastMessage}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Thread ──────────────────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {current ? (
            <>
              <header className="border-b border-border px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={current.contactName} active size="lg" />
                    <div>
                      <p className="font-serif text-lg font-semibold leading-tight text-foreground">{current.contactName}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="capitalize">{current.channel}</span> · <span className="capitalize">{current.status.replace("_", " ")}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {current.handoffReason && (
                      <Badge tone="warning">handoff: {current.handoffReason}</Badge>
                    )}
                    <Button
                      size="sm"
                      variant={current.assignedToId ? "soft" : "outline"}
                      Icon={UserCheck}
                      onClick={toggleAssign}
                      title="Atribuir esta conversa a mim"
                    >
                      {current.assignedToId ? `Atribuída: ${current.assignedToName}` : "Assumir"}
                    </Button>
                    {current.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        Icon={CheckCircle2}
                        onClick={handleClose}
                        title="Encerra a conversa e gera um resumo (memória da cliente)"
                      >
                        Encerrar + resumir
                      </Button>
                    )}
                  </div>
                </div>

                {current.summary && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft/60 px-3 py-2 text-xs text-muted-foreground">
                    <Brain size={13} className="mt-0.5 shrink-0 text-primary" />
                    <span><span className="font-semibold text-foreground">Memória:</span> {current.summary}</span>
                  </p>
                )}
              </header>

              <div ref={threadRef} className="flex-1 space-y-4 overflow-y-auto bg-muted/20 px-5 py-5">
                {messages.map((m, i) => (
                  <Fragment key={m.id}>
                    {dayChanged(messages[i - 1]?.createdAt, m.createdAt) && <DayDivider iso={m.createdAt} />}
                    <MessageBubble message={m} />
                  </Fragment>
                ))}
              </div>

              {/* Notas internas (ADR-016) — nunca enviadas ao cliente */}
              <div className="border-t border-border bg-amber-50/50 px-5 py-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                  <StickyNote size={12} /> Notas internas ({notes.length})
                </p>
                {notes.length > 0 && (
                  <div className="mt-1.5 max-h-24 space-y-1 overflow-y-auto">
                    {notes.map((n) => (
                      <div key={n.id} className={cn("group flex items-start gap-1.5 rounded px-1 text-xs text-muted-foreground", n.pinned && "bg-amber-50")}>
                        {n.pinned && <Pin size={11} className="mt-0.5 shrink-0 -rotate-45 text-amber-600" />}
                        <span className="flex-1">
                          <span className="text-foreground">{n.text}</span>
                          <span className="ml-1 opacity-60">— {n.authorName ?? "operador"}{n.createdAt ? `, ${fmtMsgTime(n.createdAt)}` : ""}</span>
                        </span>
                        <button onClick={() => togglePin(n.id, !n.pinned)} title={n.pinned ? "Desafixar" : "Fixar no topo"}
                          className={cn("shrink-0 transition-opacity hover:text-amber-600", n.pinned ? "text-amber-600" : "opacity-0 group-hover:opacity-100")}>
                          <Pin size={12} className="-rotate-45" />
                        </button>
                        <button onClick={() => removeNote(n.id)} title="Apagar nota"
                          className="shrink-0 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addNote()}
                    placeholder="Anotação interna (não vai pro cliente)…"
                    className={cn(inputClass, "flex-1 py-2")}
                  />
                  <Button size="sm" variant="outline" onClick={addNote} disabled={!newNote.trim()}>
                    Anotar
                  </Button>
                </div>
              </div>

              {/* Composição */}
              <div className="border-t border-border px-5 py-4">
                {suggested && (
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Sparkles size={13} /> Sugestão da Maya — revise e edite antes de enviar.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    Icon={Sparkles}
                    onClick={handleSuggest}
                    disabled={suggesting || sending}
                    title="Maya sugere uma resposta (não envia nada)"
                    className="shrink-0 border-primary/40 text-primary hover:bg-primary/5"
                  >
                    {suggesting ? "Pensando…" : "Sugerir (IA)"}
                  </Button>
                  <input
                    value={reply}
                    onChange={(e) => { setReply(e.target.value); if (suggested) setSuggested(false); }}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleReply()}
                    placeholder="Responder como atendente humano…"
                    className={inputClass}
                  />
                  <Button Icon={Send} onClick={handleReply} disabled={sending || !reply.trim()} className="shrink-0">
                    Enviar
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Responder aqui assume a conversa (status → handoff). A Maya para de responder.
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                icon={MessageCircle}
                title="Selecione uma conversa"
                description="Escolha um contato na lista ao lado para ver o histórico e responder."
              />
            </div>
          )}
        </section>

        {/* ── Painel de contexto (perfil / tags) ──────────────────────────── */}
        <aside className="hidden min-h-0 flex-col gap-5 overflow-y-auto xl:flex">
          {current ? (
            <>
              <Card className="p-5">
                <div className="flex flex-col items-center text-center">
                  <Avatar name={current.contactName} active size="xl" />
                  <p className="mt-3 font-serif text-lg font-semibold text-foreground">{current.contactName}</p>
                  <p className="text-xs capitalize text-muted-foreground">{current.channel}</p>
                  <div className="mt-2"><StatusBadge status={current.status} /></div>
                </div>
              </Card>

              <Card className="p-5">
                <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Tag size={12} /> Tags
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(current.tags ?? []).map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      #{t}
                      <button onClick={() => removeTag(t)} className="text-muted-foreground/60 transition-colors hover:text-primary" aria-label={`Remover tag ${t}`}>×</button>
                    </span>
                  ))}
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTag()}
                    placeholder="+ tag"
                    className="w-20 rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-[11px] outline-none transition-colors focus:border-primary"
                  />
                </div>
              </Card>

              {current.summary && (
                <Card className="p-5">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Brain size={12} /> Memória da cliente
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{current.summary}</p>
                </Card>
              )}
            </>
          ) : (
            <Card className="p-5 text-center text-sm text-muted-foreground">
              Selecione uma conversa para ver o contexto.
            </Card>
          )}
        </aside>
      </div>

      <Simulator onSent={loadConversations} />
    </div>
  );
}

function Avatar({ name, active, size = "md" }: { name: string; active?: boolean; size?: "md" | "lg" | "xl" }) {
  const initials = (name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const dims = { md: "h-9 w-9 text-xs", lg: "h-11 w-11 text-sm", xl: "h-16 w-16 text-lg" };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-serif font-semibold",
        active ? "bg-primary text-primary-foreground" : "bg-accent-soft text-primary-strong",
        dims[size],
      )}
    >
      {initials}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "success" | "warning" | "neutral"; label: string }> = {
    active: { tone: "success", label: "ativa" },
    handed_off: { tone: "warning", label: "humano" },
    closed: { tone: "neutral", label: "fechada" },
  };
  const cfg = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

/** true quando a mensagem cai num dia diferente da anterior (ou é a primeira). */
function dayChanged(prevIso: string | undefined, iso: string): boolean {
  if (!iso) return false;
  if (!prevIso) return true;
  return new Date(prevIso).toDateString() !== new Date(iso).toDateString();
}

/** Divisor de data ("Hoje", "Ontem" ou "31 de maio de 2026"). */
function DayDivider({ iso }: { iso: string }) {
  const d = new Date(iso);
  const today = new Date(); const y = new Date(today); y.setDate(y.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const label = same(d, today) ? "Hoje" : same(d, y) ? "Ontem"
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <div className="flex items-center justify-center">
      <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-soft">{label}</span>
    </div>
  );
}

/** Quem enviou: cliente, IA ou atendente (humano). */
function senderLabel(m: Message): string {
  if (m.direction === "in") return "Cliente";
  return m.llmModel ? "IA" : "Atendente";
}

/** Data/hora curta da mensagem: "hoje 15:42", "ontem 09:10" ou "31/05 15:42". */
function fmtMsgTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date(); const y = new Date(today); y.setDate(y.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `hoje ${time}`;
  if (sameDay(d, y)) return `ontem ${time}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function MessageBubble({ message }: { message: Message }) {
  const isIn = message.direction === "in";
  const isAI = !isIn && !!message.llmModel;
  return (
    <div className={cn("flex items-end gap-2", isIn ? "justify-start" : "justify-end")}>
      {isIn && (
        <span className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground shadow-soft">
          <User size={15} />
        </span>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-soft",
          isIn
            ? "rounded-bl-md bg-muted text-foreground"
            : "rounded-br-md bg-primary text-primary-foreground",
        )}
      >
        <ChatMarkdown text={message.content ?? ""} />
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={cn("mt-2 flex flex-wrap gap-1.5 border-t pt-2 text-[10px]", isIn ? "border-border" : "border-primary-foreground/20")}>
            {message.toolCalls.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 opacity-80"><Wrench size={9} />{t.name}</span>
            ))}
          </div>
        )}
        {isAI && (
          <div className="mt-1.5 text-[10px] opacity-70">
            {message.llmModel} · {message.llmCostBRL ? formatBRL(Number(message.llmCostBRL)) : ""}
          </div>
        )}
        {message.reviewFlagged && (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title={message.reviewReasons?.join("; ")}>
            <AlertTriangle size={10} /> revisar: {message.reviewReasons?.join("; ")}
          </div>
        )}
        <div className={cn("mt-1 text-[10px]", isIn ? "text-muted-foreground" : "text-primary-foreground/70")} title={message.createdAt ? new Date(message.createdAt).toLocaleString("pt-BR") : undefined}>
          {senderLabel(message)}{message.createdAt ? ` · ${fmtMsgTime(message.createdAt)}` : ""}
        </div>
      </div>
      {isAI && (
        <span className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary shadow-soft">
          <Bot size={15} className="text-primary-foreground" />
        </span>
      )}
    </div>
  );
}

// Simulador — injeta mensagem de cliente até WhatsApp/IG reais existirem.
function Simulator({ onSent }: { onSent: () => void }) {
  const [text, setText] = useState("Oi! Tem vestido floral no M? Queria pra um casamento.");
  const [name, setName] = useState("Carol");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.simulateIncoming(text, name, "+5511999990001");
      if (!r.reply) {
        setResult("IA pausada (kill-switch) — mensagem parqueada pra atendimento humano.");
      } else {
        setResult(`Maya (${r.cost?.model}, ${formatBRL(r.cost?.estimatedCostBRL ?? 0)}): ${r.reply.slice(0, 120)}…`);
      }
      onSent();
    } catch (e) {
      setResult("Erro: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-dashed border-border bg-accent-soft/30 px-5 py-4">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FlaskConical size={13} /> Simulador de cliente (até WhatsApp/IG reais)
      </p>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={cn(inputClass, "w-32 py-2")} placeholder="Nome" />
        <input value={text} onChange={(e) => setText(e.target.value)} className={cn(inputClass, "flex-1 py-2")} placeholder="Mensagem do cliente" />
        <Button variant="primary" Icon={Send} onClick={send} disabled={busy} className="shrink-0">
          {busy ? "Maya pensando…" : "Enviar como cliente"}
        </Button>
      </div>
      {result && <p className="mt-2.5 text-xs text-muted-foreground">{result}</p>}
    </div>
  );
}
