import { useEffect, useState } from "react";
import { Truck, Plus, Trash2, Bike, Car, Calculator, Save } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, Skeleton, inputClass } from "../components/ui";
import { api, type DeliveryBand, type DeliveryQuote } from "../lib/api";
import { formatBRL } from "../lib/utils";

type BandDraft = { modal: "moto" | "carro"; maxKm: string; priceBRL: string };

export function Entrega() {
  const [loaded, setLoaded] = useState(false);
  const [volumeLimit, setVolumeLimit] = useState("6");
  const [bands, setBands] = useState<BandDraft[]>([]);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api.getDeliveryTariff().then((t) => {
      setVolumeLimit(String(t.motoVolumeLimit));
      setBands(t.bands.map((b) => ({ modal: b.modal, maxKm: String(b.maxKm), priceBRL: String(b.priceBRL) })));
      setConfigured(t.configured);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  if (!loaded) return <Page><Skeleton className="h-96 w-full" /></Page>;

  return (
    <Page>
      <PageHeader
        eyebrow="FABRICAÇÃO"
        title="Entrega própria"
        subtitle="Custo de entrega com motoboy/carro próprio: o modal é escolhido pelo volume do pedido e o preço pela faixa de distância. Substitui a cotação de transportadora."
      />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <TariffEditor
          volumeLimit={volumeLimit} setVolumeLimit={setVolumeLimit}
          bands={bands} setBands={setBands}
          configured={configured} onSaved={() => setConfigured(true)}
        />
        <Estimator />
      </div>
    </Page>
  );
}

function TariffEditor({
  volumeLimit, setVolumeLimit, bands, setBands, configured, onSaved,
}: {
  volumeLimit: string; setVolumeLimit: (v: string) => void;
  bands: BandDraft[]; setBands: (b: BandDraft[]) => void;
  configured: boolean; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function addBand(modal: "moto" | "carro") {
    setBands([...bands, { modal, maxKm: "", priceBRL: "" }]);
  }
  function update(idx: number, p: Partial<BandDraft>) {
    setBands(bands.map((b, i) => (i === idx ? { ...b, ...p } : b)));
  }
  function remove(idx: number) { setBands(bands.filter((_, i) => i !== idx)); }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const payload: DeliveryBand[] = bands
        .filter((b) => Number(b.maxKm) > 0)
        .map((b) => ({ modal: b.modal, maxKm: Number(b.maxKm), priceBRL: Number(b.priceBRL) || 0 }));
      await api.saveDeliveryTariff({ motoVolumeLimit: Number(volumeLimit) || 0, bands: payload });
      onSaved();
      setMsg("Tarifa salva.");
    } catch (e: any) { setMsg(e?.message ?? "Erro ao salvar"); } finally { setBusy(false); }
  }

  const rows = (modal: "moto" | "carro") =>
    bands.map((b, i) => ({ b, i })).filter((x) => x.b.modal === modal);

  const section = (modal: "moto" | "carro") => (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {modal === "moto" ? <Bike size={15} /> : <Car size={15} />}
          {modal === "moto" ? "Moto" : "Carro"}
        </span>
        <Button size="sm" variant="soft" Icon={Plus} onClick={() => addBand(modal)}>Faixa</Button>
      </div>
      {rows(modal).length === 0 && <p className="mb-2 text-xs text-muted-foreground">Nenhuma faixa.</p>}
      <div className="space-y-2">
        {rows(modal).map(({ b, i }) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">até</span>
            <input className={`${inputClass} w-20`} value={b.maxKm} onChange={(e) => update(i, { maxKm: e.target.value })} inputMode="decimal" placeholder="km" />
            <span className="text-xs text-muted-foreground">km =</span>
            <span className="text-xs text-muted-foreground">R$</span>
            <input className={`${inputClass} w-24`} value={b.priceBRL} onChange={(e) => update(i, { priceBRL: e.target.value })} inputMode="decimal" />
            <Button size="sm" variant="ghost" Icon={Trash2} onClick={() => remove(i)} aria-label="Remover" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader
        icon={Truck}
        title="Tabela de tarifas"
        subtitle="Defina o limite de volume para moto e as faixas de preço por distância."
        action={!configured ? <Badge tone="warning">usando padrão</Badge> : <Badge tone="success">configurada</Badge>}
      />
      <label className="mt-5 block max-w-xs">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Volume máximo na moto (acima vai de carro)</span>
        <input className={inputClass} value={volumeLimit} onChange={(e) => setVolumeLimit(e.target.value)} inputMode="decimal" />
        <span className="mt-1 block text-xs text-muted-foreground/70">Volume = soma de (qtd × volume do produto). Default 1/produto → conta por unidade.</span>
      </label>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {section("moto")}
        {section("carro")}
      </div>

      {msg && <p className="mt-4 text-sm text-muted-foreground">{msg}</p>}
      <div className="mt-5">
        <Button Icon={Save} onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar tarifa"}</Button>
      </div>
    </Card>
  );
}

function Estimator() {
  const [distance, setDistance] = useState("5");
  const [volume, setVolume] = useState("1");
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try { setQuote(await api.quoteDelivery(Number(distance) || 0, Number(volume) || 0)); }
    catch { setQuote(null); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader icon={Calculator} title="Simular entrega" subtitle="Veja o modal e o preço para uma distância e volume." />
      <div className="mt-5 grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Distância (km)</span>
          <input className={inputClass} value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Volume (ex.: nº de bolos)</span>
          <input className={inputClass} value={volume} onChange={(e) => setVolume(e.target.value)} inputMode="decimal" />
        </label>
      </div>
      <Button className="mt-4" onClick={run} disabled={busy}>{busy ? "Calculando…" : "Calcular"}</Button>

      {quote && (
        <div className="mt-5 rounded-lg bg-accent-soft p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-primary-strong">
            {quote.modal === "moto" ? <Bike size={18} /> : <Car size={18} />}
            <span className="text-sm font-medium capitalize">{quote.modal}</span>
          </div>
          <p className="mt-2 font-serif text-3xl font-semibold text-primary-strong">{formatBRL(quote.priceBRL)}</p>
          {quote.noTariff && <p className="mt-2 text-xs text-amber-700">Sem faixa configurada para esse modal.</p>}
          {quote.outOfRange && !quote.noTariff && (
            <p className="mt-2 text-xs text-amber-700">Distância além da maior faixa ({quote.maxKm} km) — usando o preço dela.</p>
          )}
        </div>
      )}
    </Card>
  );
}
