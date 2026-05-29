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
import { Settings } from "./pages/Settings";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/inbox"    element={<Inbox />} />
          <Route path="/catalog"  element={<Catalog />} />
          <Route path="/compras"  element={<Compras />} />
          <Route path="/pedidos"  element={<Pedidos />} />
          <Route path="/estoque"  element={<Estoque />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
