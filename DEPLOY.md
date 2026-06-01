# Deploy em produção — VPS com Docker (ex.: Hostinger VPS)

Sobe tudo com Docker: **Postgres + Redis + API + painel (Caddy com HTTPS automático)**.
Você consegue subir **já com os conectores simulados** e trocar pelos reais depois.

---

## 0. Pré-requisitos
- Um **VPS Linux** (Ubuntu 22.04+ recomendado) com acesso **SSH** e IP público.
- (Opcional, mas recomendado) um **domínio** (ex.: `painel.sualoja.com.br`) com um registro **A** apontando pro IP do VPS — habilita HTTPS automático.
- Sua **ANTHROPIC_API_KEY** (com créditos).

---

## 1. Conectar no VPS e instalar o Docker
```bash
ssh root@SEU_IP_DO_VPS

# Docker + Compose (script oficial)
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

## 2. Colocar o código no VPS
**Opção A — Git (recomendado):** suba o projeto pra um repositório privado (GitHub/GitLab) e clone:
```bash
git clone https://github.com/SUA_CONTA/thepop7.git
cd thepop7
```
**Opção B — Copiar do seu PC** (sem Git remoto), rodando no SEU computador:
```bash
# exclui node_modules; envia o resto pro VPS
rsync -av --exclude node_modules --exclude .git --exclude '.env*' ./ root@SEU_IP:/root/thepop7/
```

## 3. Criar o arquivo de segredos
```bash
cp .env.production.example .env.production

# Gere as chaves de segurança e cole no arquivo:
openssl rand -hex 32   # use no PII_KEY
openssl rand -hex 32   # use no JWT_SECRET
openssl rand -hex 32   # use no PLATFORM_ADMIN_KEY (libera o painel /plataforma)

nano .env.production    # preencha DOMAIN, senhas, DATABASE_URL, ANTHROPIC_API_KEY, ADMIN_*, PLATFORM_ADMIN_KEY
```
> Importante: a senha em `POSTGRES_PASSWORD` precisa ser a **mesma** dentro da `DATABASE_URL`.
> Comece com `USE_MOCK_CONNECTORS=true` (sobe funcionando sem as contas externas).

## 4. Subir os serviços
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml ps    # tudo "running"/"healthy"
```

## 5. Preparar o banco (só na 1ª vez)
```bash
# cria as tabelas
docker compose -f docker-compose.prod.yml exec api npx prisma db push --schema packages/db/prisma/schema.prisma
# aplica as políticas de isolamento (RLS) e o pgvector
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d thepop < packages/db/prisma/migrations/manual/rls.sql
# dados-exemplo (loja + produtos) — opcional, bom pra validar
docker compose -f docker-compose.prod.yml exec api npm --workspace @hubadvisor/db run seed
# cria o usuário admin do painel (usa ADMIN_EMAIL/ADMIN_PASSWORD do .env)
docker compose -f docker-compose.prod.yml exec api node --import tsx apps/api/src/seed-admin.ts
```

## 6. Apontar o domínio e acessar
- No seu provedor de DNS, crie um registro **A**: `painel` → IP do VPS.
- Em ~1–5 min o Caddy emite o **HTTPS** sozinho.
- Acesse **https://SEU_DOMINIO** → faça login com `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- (Sem domínio? Use `DOMAIN=:80` no .env e acesse `http://SEU_IP`.)

## 7. Atualizar (quando houver mudança no código)
```bash
git pull            # ou rsync de novo
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

---

## 8. Trocar os conectores simulados pelos reais (conforme as contas saem)
1. Preencha os tokens no `.env.production` (WhatsApp/Bling/Mercado Pago/PlugNotas).
2. Mude `USE_MOCK_CONNECTORS=false`.
3. `docker compose ... up -d` de novo.
4. Teste cada fluxo com um pedido real de baixo valor.

---

## Notas de produção
- **Backups do banco:** agende `pg_dump` do volume `pgdata` (ex.: cron diário).
- **Segredos:** nunca comite `.env.production`. Guarde as chaves em local seguro — trocar `PII_KEY` exige re-migrar os dados de contato (`apps/api/src/seed-admin.ts` não, mas `packages/db/src/migrate-pii.ts` sim).
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api`.
- **RLS (hardening, ADR-002):** defina `APP_DB_ROLE=hubadvisor_app` no `.env.production`. O `rls.sql` (passo 5) cria esse papel sem BYPASSRLS e o `withTenant()` baixa pra ele em cada transação por loja — então o isolamento por tenant passa a ser garantido pelo banco, não só pelo código. Vazio = desligado (roda como o usuário da conexão, que bypassa o RLS). *Obs.: protege contra filtro de tenant esquecido no ORM; não substitui cuidado com SQL cru arbitrário.*
- **Redis/agendamentos:** já sobe no compose; os jobs proativos (Lia D+1/D+7…) podem ser ligados depois.
