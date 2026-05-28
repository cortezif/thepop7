// Render leve de markdown pra mensagens do chat — porte simplificado do
// ChatMarkdown.tsx do adviser. Suporta **negrito**, quebras de linha,
// tabelas simples e listas. Sem dependência externa pra manter o bundle leve.

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push(<strong key={key++}>{m[1]}</strong>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let key = 0;

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const [header, ...rows] = tableRows.filter((r) => !r.every((c) => /^[-:\s]*$/.test(c)));
    blocks.push(
      <table key={key++} className="my-2 w-full border-collapse text-sm">
        {header && (
          <thead>
            <tr>{header.map((c, i) => <th key={i} className="border border-border bg-muted px-2 py-1 text-left">{renderInline(c.trim())}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-border px-2 py-1">{renderInline(c.trim())}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
    tableRows = [];
  };

  for (const line of lines) {
    if (line.includes("|") && line.trim().startsWith("|")) {
      tableRows.push(line.split("|").slice(1, -1));
      continue;
    }
    flushTable();
    if (line.trim() === "") { blocks.push(<div key={key++} className="h-2" />); continue; }
    if (/^[-*]\s+/.test(line.trim())) {
      blocks.push(<li key={key++} className="ml-4 list-disc">{renderInline(line.trim().replace(/^[-*]\s+/, ""))}</li>);
      continue;
    }
    blocks.push(<p key={key++} className="leading-relaxed">{renderInline(line)}</p>);
  }
  flushTable();

  return <div className="space-y-0.5">{blocks}</div>;
}
