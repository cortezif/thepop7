import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { App } from "./App";
import { Dashboard } from "./pages/Dashboard";
import { Inbox } from "./pages/Inbox";
import { Catalog } from "./pages/Catalog";
import { Compras } from "./pages/Compras";
import { Pedidos } from "./pages/Pedidos";
import { Estoque } from "./pages/Estoque";
import { Insumos } from "./pages/Insumos";
import { Receitas } from "./pages/Receitas";
import { Producao } from "./pages/Producao";
import { Entrega } from "./pages/Entrega";
import { Settings } from "./pages/Settings";
import { Equipe } from "./pages/Equipe";
import { MinhaConta } from "./pages/MinhaConta";
import { Plataforma } from "./pages/Plataforma";
import { Recursos } from "./pages/Recursos";
import { Mercadologica } from "./pages/Mercadologica";
import { MidiaPaga } from "./pages/MidiaPaga";
import { CotacaoPublica } from "./pages/CotacaoPublica";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/recursos" element={<Recursos />} />
          <Route path="/inbox"    element={<Inbox />} />
          <Route path="/catalog"  element={<Catalog />} />
          <Route path="/compras"  element={<Compras />} />
          <Route path="/mercadologica" element={<Mercadologica />} />
          <Route path="/midia-paga" element={<MidiaPaga />} />
          <Route path="/pedidos"  element={<Pedidos />} />
          <Route path="/estoque"  element={<Estoque />} />
          <Route path="/insumos"  element={<Insumos />} />
          <Route path="/receitas" element={<Receitas />} />
          <Route path="/producao" element={<Producao />} />
          <Route path="/entrega"  element={<Entrega />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/equipe"   element={<Equipe />} />
          <Route path="/conta"    element={<MinhaConta />} />
        </Route>
        <Route path="/plataforma" element={<Plataforma />} />
        <Route path="/cotacao/:token" element={<CotacaoPublica />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
