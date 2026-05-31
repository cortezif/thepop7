import { useEffect, useState } from "react";
import { Bike, UserPlus, Link2, Power, Package, Truck, Check, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, Tabs, inputClass } from "../components/ui";
import { api, type Courier, type CourierVehicle, type DeliveryJob, type Order } from "../lib/api";
import { formatBRL } from "../lib/utils";

type Tab = "corridas" | "entregadores";

const VEHICLES: { key: CourierVehicle; label: string }[] = [
  { key: "moto", label: "Moto" }, { key: "carro", label: "Carro" }, { key: "bike", label: "Bike" }, { key: "a_pe", label: "A pé" },
];
const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", atribuido: "Atribuído", aceito: "Aceito", coletado: "Coletado", entregue: "Entregue", cancelado: "Cancelado",
};
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
  pendente: "warning", atribuido: "info", aceito: "info", coletado: "info", entregue: "success", cancelado: "danger",
};

export function Entregadores() {
  const [tab, setTab] = useState<Tab>("corridas");
  return (
    <Page>
      <PageHeader
        eyebrow="ENTREGAS · EQUIPE PRÓPRIA"
        title="Entregadores"
        subtitle="Cadastre entregadores da sua cidade e despache pedidos para eles. Cada entregador acompanha as próprias corridas por um link, sem instalar nada."
      />
      <div className="mb-6">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: "corridas", label: "Corridas" },
          { key: "entregadores", label: "Entregadores" },
        ]} />
      </div>
      {tab === "corridas" ? <Corridas /> : <Roster />}
    </Page>
  );
}

function Roster() {
  const [list, setList] = useState<Courier[] | null>(null);
  const [adding, setAdding] = useState(false);
  function load() { api.couriers().then(setList).catch(() => setList([])); }
  useEffect(load, []);

  function copyLink(c: Courier) {
    const url = `${window.location.origin}/entregador/${c.accessToken}`;
    navigator.clipboard?.writeText(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding((v) => !v)}><UserPlus className="h-4 w-4" /> Novo entregador</Button>
      </div>
      {adding && <NovoEntregador onDone={() => { setAdding(false); load(); }} />}
      {!list ? <Skeleton className="h-40" />
        : list.length === 0 ? <EmptyState icon={Bike} title="Nenhum entregador" description="Cadastre quem vai fazer as entregas na sua cidade." />
        : (
          <Card>
            <div className="divide-y divide-border/60">
              {list.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-4">
                  <Bike className="h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{c.name} {!c.active && <Badge tone="danger">inativo</Badge>}</p>
                    <p className="text-xs text-muted-foreground">{VEHICLES.find((v) => v.key === c.vehicle)?.label}{c.phone ? ` · ${c.phone}` : ""}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <Button variant="outline" onClick={() => copyLink(c)}><Link2 className="h-4 w-4" /> Link do app</Button>
                    <Button variant="ghost" onClick={() => api.updateCourier(c.id, { active: !c.active }).then(load)}><Power className="h-4 w-4" /> {c.active ? "Desativar" : "Ativar"}</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
    </div>
  );
}

function NovoEntregador({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState<CourierVehicle>("moto");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!name.trim()) { setErr("Informe o nome."); return; }
    setSaving(true); setErr("");
    try { await api.createCourier({ name, phone: phone || undefined, vehicle }); onDone(); }
    catch (e: any) { setErr(e?.message ?? "falha"); } finally { setSaving(false); }
  }
  return (
    <Card>
      <CardHeader title="Novo entregador" />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {err && <div className="md:col-span-2 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        <input className={inputClass} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputClass} placeholder="Telefone (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select className={inputClass} value={vehicle} onChange={(e) => setVehicle(e.target.value as CourierVehicle)}>
          {VEHICLES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <div className="md:col-span-2"><Button onClick={save} disabled={saving}><UserPlus className="h-4 w-4" /> {saving ? "Salvando…" : "Cadastrar"}</Button></div>
      </div>
    </Card>
  );
}

function Corridas() {
  const [jobs, setJobs] = useState<DeliveryJob[] | null>(null);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [creating, setCreating] = useState(false);
  function load() {
    api.deliveryJobs().then(setJobs).catch(() => setJobs([]));
    api.couriers().then((c) => setCouriers(c.filter((x) => x.active))).catch(() => setCouriers([]));
  }
  useEffect(load, []);

  const active = (jobs ?? []).filter((j) => !["entregue", "cancelado"].includes(j.status));
  const done = (jobs ?? []).filter((j) => ["entregue", "cancelado"].includes(j.status));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating((v) => !v)}><Package className="h-4 w-4" /> Nova corrida</Button>
      </div>
      {creating && <NovaCorrida couriers={couriers} onDone={() => { setCreating(false); load(); }} />}

      {!jobs ? <Skeleton className="h-40" />
        : active.length === 0 && done.length === 0 ? <EmptyState icon={Truck} title="Nenhuma corrida" description="Crie uma corrida a partir de um pedido." />
        : (
          <>
            {active.map((j) => <JobRow key={j.id} job={j} couriers={couriers} onChange={load} />)}
            {done.length > 0 && <p className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">Finalizadas</p>}
            {done.map((j) => <JobRow key={j.id} job={j} couriers={couriers} onChange={load} />)}
          </>
        )}
    </div>
  );
}

function JobRow({ job, couriers, onChange }: { job: DeliveryJob; couriers: Courier[]; onChange: () => void }) {
  const next: Record<string, string> = { pendente: "", atribuido: "aceito", aceito: "coletado", coletado: "entregue" };
  const adv = next[job.status];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{job.address ?? "sem endereço"}{job.feeBRL != null ? ` · ${formatBRL(job.feeBRL)}` : ""}</p>
          <p className="text-xs text-muted-foreground">
            {job.courier ? `${job.courier.name}` : "sem entregador"}{job.notes ? ` · ${job.notes}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {job.status === "pendente" && (
            <select className={`${inputClass} w-auto`} defaultValue="" onChange={(e) => e.target.value && api.assignDeliveryJob(job.id, e.target.value).then(onChange)}>
              <option value="" disabled>Atribuir a…</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {adv && <Button variant="outline" onClick={() => api.setDeliveryJobStatus(job.id, adv).then(onChange)}><Check className="h-4 w-4" /> {STATUS_LABEL[adv]}</Button>}
          {!["entregue", "cancelado"].includes(job.status) && (
            <Button variant="ghost" onClick={() => api.setDeliveryJobStatus(job.id, "cancelado").then(onChange)}><X className="h-4 w-4" /></Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function NovaCorrida({ couriers, onDone }: { couriers: Courier[]; onDone: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState("");
  const [courierId, setCourierId] = useState("");
  const [fee, setFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.listOrders().then((o) => setOrders(o.filter((x) => !["canceled"].includes(x.status)))).catch(() => setOrders([])); }, []);

  async function save() {
    if (!orderId) { setErr("Escolha o pedido."); return; }
    setSaving(true); setErr("");
    try {
      await api.createDeliveryJob({ orderId, courierId: courierId || undefined, feeBRL: fee ? Number(fee.replace(",", ".")) : undefined });
      onDone();
    } catch (e: any) { setErr(e?.message ?? "falha"); } finally { setSaving(false); }
  }
  return (
    <Card>
      <CardHeader title="Nova corrida" subtitle="Despache um pedido para um entregador." />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {err && <div className="md:col-span-2 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        <select className={`${inputClass} md:col-span-2`} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">Escolha o pedido…</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.contactName} · {formatBRL(o.totalBRL)} · {new Date(o.createdAt).toLocaleDateString("pt-BR")}</option>)}
        </select>
        <select className={inputClass} value={courierId} onChange={(e) => setCourierId(e.target.value)}>
          <option value="">Atribuir depois</option>
          {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className={inputClass} placeholder="Pagamento do entregador (R$)" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
        <div className="md:col-span-2"><Button onClick={save} disabled={saving}><Package className="h-4 w-4" /> {saving ? "Criando…" : "Criar corrida"}</Button></div>
      </div>
    </Card>
  );
}
