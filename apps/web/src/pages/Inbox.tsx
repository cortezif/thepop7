import { useEffect, useRef, useState } from "react";
import { Bot, User, Send, Wrench, Sparkles, Brain, AlertTriangle } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { api, type Conversation, type Message, type ConversationNote } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

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

  return (
    <div className="flex h-screen flex-col p-8">
      <PageHeader eyebrow="ATENDIMENTO" title="Inbox unificado" />
      {error && <p className="mt-2 text-sm text-primary">Erro: {error}</p>}

      <div className="mt-6 grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-px overflow-hidden rounded-lg border border-border bg-border">
        {/* Lista de conversas */}
        <div className="flex flex-col overflow-y-auto bg-background">
          <div className="border-b border-border p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Conversas ({conversations.length})
          </div>
          {conversations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhuma conversa. Use a aba simulador abaixo pra criar uma.
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={cn(
                  "border-b border-border p-3 text-left transition-colors",
                  selected === c.id ? "bg-muted" : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{c.contactName}</span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{c.lastMessage}</p>
              </button>
            ))
          )}
        </div>

        {/* Thread */}
        <div className="flex min-h-0 flex-col bg-background">
          {current ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{current.contactName}</p>
                    <p className="text-xs text-muted-foreground">{current.channel} · {current.status}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {current.handoffReason && (
                      <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">
                        handoff: {current.handoffReason}
                      </span>
                    )}
                    <button
                      onClick={toggleAssign}
                      title="Atribuir esta conversa a mim"
                      className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", current.assignedToId ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted")}
                    >
                      {current.assignedToId ? `Atribuída: ${current.assignedToName}` : "Assumir"}
                    </button>
                    {current.status !== "closed" && (
                      <button
                        onClick={handleClose}
                        title="Encerra a conversa e gera um resumo (memória da cliente)"
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        Encerrar + resumir
                      </button>
                    )}
                  </div>
                </div>

                {/* Tags (ADR-016) */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(current.tags ?? []).map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px]">
                      #{t}
                      <button onClick={() => removeTag(t)} className="text-muted-foreground hover:text-primary">×</button>
                    </span>
                  ))}
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTag()}
                    placeholder="+ tag"
                    className="w-20 rounded border border-dashed border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                  />
                </div>
                {current.summary && (
                  <p className="mt-2 flex items-start gap-1.5 rounded bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Brain size={12} className="mt-0.5 shrink-0 text-primary" />
                    <span><span className="font-medium text-foreground">Memória:</span> {current.summary}</span>
                  </p>
                )}
              </div>

              <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>

              {/* Notas internas (ADR-016) — nunca enviadas ao cliente */}
              <div className="border-t border-border bg-amber-50/40 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Notas internas ({notes.length})</p>
                {notes.length > 0 && (
                  <div className="mt-1 max-h-24 space-y-1 overflow-y-auto">
                    {notes.map((n) => (
                      <p key={n.id} className="text-xs text-muted-foreground">
                        <span className="text-foreground">{n.text}</span>
                        <span className="ml-1 opacity-60">— {n.authorName ?? "operador"}</span>
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex gap-2">
                  <input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addNote()}
                    placeholder="Anotação interna (não vai pro cliente)…"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                  />
                  <button onClick={addNote} disabled={!newNote.trim()} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    Anotar
                  </button>
                </div>
              </div>

              <div className="border-t border-border p-3">
                {suggested && (
                  <p className="mb-1.5 flex items-center gap-1 text-xs text-primary">
                    <Sparkles size={12} /> Sugestão da Maya — revise e edite antes de enviar.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleSuggest}
                    disabled={suggesting || sending}
                    title="Maya sugere uma resposta (não envia nada)"
                    className="flex items-center gap-1 rounded-md border border-primary/40 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
                  >
                    <Sparkles size={14} /> {suggesting ? "Pensando…" : "Sugerir (IA)"}
                  </button>
                  <input
                    value={reply}
                    onChange={(e) => { setReply(e.target.value); if (suggested) setSuggested(false); }}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleReply()}
                    placeholder="Responder como atendente humano…"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleReply}
                    disabled={sending || !reply.trim()}
                    className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Send size={14} /> Enviar
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Responder aqui assume a conversa (status → handoff). A Maya para de responder.
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Selecione uma conversa
            </div>
          )}
        </div>
      </div>

      <Simulator onSent={loadConversations} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    handed_off: "bg-amber-100 text-amber-700",
    closed: "bg-gray-100 text-gray-500",
  };
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", map[status] ?? "")}>{status}</span>;
}

function MessageBubble({ message }: { message: Message }) {
  const isIn = message.direction === "in";
  const isAI = !isIn && !!message.llmModel;
  return (
    <div className={cn("flex gap-2", isIn ? "justify-start" : "justify-end")}>
      {isIn && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"><User size={14} /></div>}
      <div className={cn("max-w-[75%] rounded-lg px-3 py-2 text-sm", isIn ? "bg-muted" : "bg-primary text-primary-foreground")}>
        <ChatMarkdown text={message.content ?? ""} />
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={cn("mt-2 flex flex-wrap gap-1 border-t pt-1 text-[10px]", isIn ? "border-border" : "border-primary-foreground/20")}>
            {message.toolCalls.map((t, i) => (
              <span key={i} className="flex items-center gap-1 opacity-80"><Wrench size={9} />{t.name}</span>
            ))}
          </div>
        )}
        {isAI && (
          <div className="mt-1 text-[10px] opacity-70">
            {message.llmModel} · {message.llmCostBRL ? formatBRL(Number(message.llmCostBRL)) : ""}
          </div>
        )}
        {message.reviewFlagged && (
          <div className="mt-1 flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title={message.reviewReasons?.join("; ")}>
            <AlertTriangle size={10} /> revisar: {message.reviewReasons?.join("; ")}
          </div>
        )}
      </div>
      {isAI && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary"><Bot size={14} className="text-primary-foreground" /></div>}
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
    <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Simulador de cliente (até WhatsApp/IG reais)
      </p>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-28 rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Nome" />
        <input value={text} onChange={(e) => setText(e.target.value)} className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Mensagem do cliente" />
        <button onClick={send} disabled={busy} className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50">
          {busy ? "Maya pensando…" : "Enviar como cliente"}
        </button>
      </div>
      {result && <p className="mt-2 text-xs text-muted-foreground">{result}</p>}
    </div>
  );
}
