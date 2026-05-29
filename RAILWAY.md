# Deploy no Railway (passo a passo)

Um **serviço único** (API + painel juntos) + um **Postgres gerenciado**. HTTPS e
domínio são automáticos. Sobe já com conectores simulados; troca pelos reais depois.

---

## 1. Pôr o código no GitHub (uma vez)
No seu PC, dentro da pasta do projeto:
```bash
# crie um repositório PRIVADO em github.com/new (ex.: thepop7), depois:
git remote add origin https://github.com/SUA_CONTA/thepop7.git
git branch -M main
git push -u origin main
```
> Segredos não vão pro Git (o `.gitignore` bloqueia `.env*`). Só o `.env.production.example` (modelo) vai.

## 2. Criar o projeto no Railway
1. Acesse **railway.app** → **New Project** → **Deploy from GitHub repo** → escolha `thepop7`.
2. O Railway detecta o `railway.json` e usa o `deploy/Dockerfile.railway` automaticamente.
3. A 1ª build vai falhar/ficar pendente por falta do banco e das variáveis — normal, configure abaixo.

## 3. Adicionar o banco (Postgres)
- No projeto: **New** → **Database** → **Add PostgreSQL**. (O Railway provê a `DATABASE_URL`.)

## 4. Configurar as variáveis no serviço (aba **Variables**)
Cole estas (gere os segredos com `openssl rand -hex 32`):
```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
PII_KEY = <64 hex>
JWT_SECRET = <segredo forte>
ANTHROPIC_API_KEY = sk-ant-...
NODE_ENV = production
USE_MOCK_CONNECTORS = true
ADMIN_EMAIL = voce@sualoja.com.br
ADMIN_PASSWORD = <senha do admin>
```
> Não defina `PORT` — o Railway injeta sozinho.
> `${{Postgres.DATABASE_URL}}` é uma referência: clique em "Add Reference" → Postgres → DATABASE_URL.

## 5. Publicar
- O Railway faz o build (Dockerfile), e no start o `railway-start.sh` **prepara o banco** (cria tabelas, dados-exemplo e o usuário admin) e sobe o app.
- Acompanhe em **Deployments → Logs** (procure "subindo API + painel").

## 6. Gerar o endereço (HTTPS)
- Aba **Settings → Networking → Generate Domain** → vira algo como `thepop7-production.up.railway.app` (com HTTPS).
- (Opcional) **Custom Domain**: aponte `painel.sualoja.com.br` e o Railway emite o certificado.

## 7. Entrar
- Abra a URL → **login** com `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Tudo funcionando em modo "laboratório" (conectores simulados).

## 8. Atualizações
- `git push` → o Railway **rebuilda e publica sozinho**. (O start roda o `db push` de novo, idempotente.)

## 9. Ligar os conectores reais (quando as contas saírem)
- Em **Variables**, preencha os tokens (WhatsApp/Bling/Mercado Pago/PlugNotas) e mude `USE_MOCK_CONNECTORS=false`. Salvar → redeploy automático.

---

### Notas
- **Custo:** Railway cobra por uso (CPU/RAM/banco). Começo barato; acompanhe no painel deles.
- **Backups:** o Postgres do Railway tem backups; confira o plano.
- **Multi-instância:** se um dia escalar pra várias réplicas, tirar o `db push`/seed do start e rodar como passo separado (pra não rodar em paralelo).
