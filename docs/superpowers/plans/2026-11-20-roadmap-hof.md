# HOF PRO roadmap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar histórico do paciente, retornos, pendências do prontuário, financeiro e a base de ações do assistente.

**Architecture:** Um router FastAPI + schemas + testes por frente (padrão atual: `@orm`, `log_access`, `get_patient_or_404`). Modelos novos só em `apps/finance` e `apps/assistant` (apps novos) e um campo em `inventory.Product`. Frontend: uma página/CSS por frente, rotas já fiadas.

**Tech Stack:** Django 5 ORM, FastAPI, pytest, React 19 + Vite, Playwright e2e, agent-browser (Vercel) para checagem visual.

**Spec:** `docs/superpowers/specs/2026-11-20-roadmap-hof-design.md` (contém os contratos de API: seguir à risca).

## Global Constraints

- Nada se apaga: sem rota DELETE, sem `.delete()` em modelo de negócio. Mudança de estado por status ou por lançamento de estorno.
- Cada profissional só enxerga o que é dele (filtrar por `owner`/`user`).
- Português do Brasil em toda mensagem ao usuário. Dinheiro em centavos inteiros (`*_cents`).
- Paciente com `anonymized_at` preenchido (dados ocultos): nunca mostrar nome, telefone nem observações; mostrar "Dados ocultos".
- Público só dentistas com CRO; não escrever "especialista em HOF" em tela nem campo.
- Cada agente mexe só nos arquivos listados na sua tarefa. Arquivos compartilhados (`api/main.py`, `config/settings.py`, `App.jsx`, `AppLayout.jsx`, `main.jsx`, `PatientWorkspace.jsx`, README) já estão fiados pelo controlador: não editar.
- Testes: backend `cd backend && ../venv/bin/python -m pytest <arquivo>`; front `cd frontend && npm test` (funções puras `*.check.mjs`) e `npm run build`.
- Sem commit: o controlador integra no fim.

## Review Focus

- Paciente com dados ocultos aparecendo em histórico, retornos, pendências e assistente: nunca vaza nome/telefone.
- Usuário B tentando ler ou gravar dado do usuário A (IDOR) em qualquer rota nova.
- Pagamento maior que o saldo, pagamento em orçamento não aprovado, pagamento duplicado em clique duplo: recusar com 409/422, saldo nunca negativo.
- Proposta do assistente confirmada duas vezes ou vencida: sem efeito duplo (idempotente) e recusa quando vencida.
- Retorno de paciente sem telefone, sem aplicação, ou com agendamento futuro: sem erro e sem item indevido.

---

## Task 0: Fiação (controlador, antes dos agentes)

**Files:** Create stubs `backend/api/routers/{timeline,returns,compliance,finance,assistant}.py`, `backend/apps/{finance,assistant}/{__init__,apps,models,admin}.py` + `migrations/__init__.py`; Modify `backend/api/main.py`, `backend/config/settings.py`, `frontend/src/App.jsx`, `frontend/src/components/AppLayout.jsx`, `frontend/src/pages/PatientWorkspace.jsx`, `frontend/src/main.jsx`; Create page stubs.

- [ ] Registrar routers, apps, rotas `/retornos`, `/pendencias`, `/financeiro`, aba `historico` no paciente, itens de menu, imports de CSS.
- [ ] Verificar: `pytest -q` e `npm run build` verdes com os stubs.

## Task 1: Histórico do paciente

**Files:** Modify `backend/api/routers/timeline.py`; Create `backend/tests/test_timeline.py`, `frontend/src/pages/TimelineStep.jsx`, `frontend/src/styles/timeline.css`, `frontend/src/pages/timeline.check.mjs` (+ `npm test` já inclui via Task 0 se o script listar; senão agente informa).
**Interfaces:** Produces `GET /api/patients/{id}/timeline?limit=100` (contrato na spec). Consumes modelos existentes (FacialPlan, Application, ConsentRecord/Termos, AdverseEvent, Appointment, PatientPhoto, AnamnesisVersion).

- [ ] Teste falhando: paciente com plano, aplicação, termo, intercorrência, agendamento, foto e versão de anamnese gera itens na ordem decrescente; outro usuário recebe 404; paciente oculto não traz nome; `limit` respeitado (1..300).
- [ ] Implementar rota; grava `log_access` de leitura.
- [ ] Front: lista vertical agrupada por mês, ícone por `kind`, link por `ref` para a aba certa, estado vazio e erro.
- [ ] Função pura de agrupamento por mês com `.check.mjs`.

## Task 2: Retornos e lembretes

**Files:** Modify `backend/api/routers/returns.py`, `backend/apps/inventory/models.py` (campo `Product.return_interval_days`), `backend/api/routers/inventory.py` (aceitar o campo no PATCH de produto) + `backend/api/schemas_inventory.py`; Create migration `backend/apps/inventory/migrations/00NN_product_return_interval.py`, `backend/api/returns_logic.py`, `backend/tests/test_returns.py`, `frontend/src/returns/ReturnsPage.jsx`, `frontend/src/returns/message.js`, `frontend/src/returns/message.check.mjs`, `frontend/src/styles/returns.css`.
**Interfaces:** Produces `GET /api/returns?within_days=30` e `returns_logic.due_returns(user, today, within_days) -> list[dict]` (o assistente usa na Task 5). Padrões: toxina 120, bioestimulador 180, preenchedor 365, skinbooster 90, outro sem lembrete.

- [ ] Testes falhando: toxina há 130 dias = vencido; há 100 = próximo (dentro de 30); há 10 = em_dia (fora da janela, não listado); intervalo do produto vence o padrão; agendamento futuro tira da fila; sem telefone retorna `phone: ""`; paciente oculto sem nome/telefone; arquivado fora; outro usuário não vê.
- [ ] Implementar `due_returns` (último `Application.applied_at` por paciente e tipo de produto) e a rota.
- [ ] Mensagem pronta no servidor (texto neutro, sem promoção, com o nome do paciente e o tipo).
- [ ] Front: tabela com filtro Vencidos/Próximos, botão "WhatsApp" (`https://wa.me/55<dígitos>?text=` codificado, desabilitado sem telefone), botão copiar mensagem, aviso de que o intervalo é configurável e não recomendação clínica; editar intervalo por produto fica na tela de Estoque só se for trivial, senão apenas leitura (decisão do agente, informar).
- [ ] `message.js`: `onlyDigits`, `waLink(phone, text)`; teste puro cobre telefone com máscara, com 55, vazio.

## Task 3: Pendências do prontuário

**Files:** Modify `backend/api/routers/compliance.py`; Create `backend/api/compliance_logic.py`, `backend/tests/test_compliance.py`, `frontend/src/compliance/CompliancePage.jsx`, `frontend/src/styles/compliance.css`.
**Interfaces:** Produces `GET /api/compliance` (contrato na spec) e `compliance_logic.pending_items(user) -> list[dict]`.

- [ ] Testes falhando por código: `sem_anamnese` (paciente ativo sem anamnese salva e com plano), `sem_termo` (plano aplicado sem termo assinado do tratamento), `sem_lote` (ponto de plano aplicado sem lote/aplicação), `intercorrencia_aberta` (desfecho em acompanhamento), `plano_sem_aplicacao` (rascunho com mais de 30 dias); paciente arquivado fora; oculto sem nome; isolamento por usuário; contagens por severidade.
- [ ] Implementar com consultas agregadas (sem N+1: usar `select_related`/`prefetch_related`).
- [ ] Front: lista agrupada por severidade, cada item leva à aba do paciente certa (`ref`), estado vazio "Nenhuma pendência".

## Task 4: Financeiro — backend

**Files:** Create `backend/apps/finance/models.py` (PriceItem, Budget, BudgetItem, Payment), migration `0001_initial.py`, `backend/apps/finance/admin.py` (sem exclusão: ver `apps/audit/retention.py`), `backend/api/schemas_finance.py`, `backend/tests/test_finance.py`; Modify `backend/api/routers/finance.py`.
**Interfaces:** Produces todas as rotas `/api/finance/*` da spec. Estados: rascunho → aprovado|recusado|cancelado; `Budget.total_cents`, `paid_cents`, `balance_cents` calculados no servidor.

- [ ] Verificar como `apps/audit/retention.py` bloqueia exclusão e fazer os modelos novos herdarem a mesma proteção.
- [ ] Testes falhando: criar item de preço; orçamento manual com desconto; `from-plan` usa preço do tratamento+região (região específica vence a genérica; sem preço gera item 0 e `warnings`); aprovar só de rascunho; item não edita após aprovado; pagamento em rascunho = 409; pagamento acima do saldo = 422; dois pagamentos somam; estorno cria negativo e recompõe saldo; estorno duplo = 409; resumo mensal; usuário B recebe 404 em tudo; paciente oculto sem nome na listagem.
- [ ] Implementar; escrita dentro de `transaction.atomic()` com lock do orçamento (`select_for_update`) para pagamentos simultâneos; `log_access` em toda escrita.

## Task 5: Financeiro — frontend (depende da Task 4)

**Files:** Create `frontend/src/finance/FinancePage.jsx`, `BudgetModal.jsx`, `PricesTab.jsx`, `money.js`, `money.check.mjs`, `frontend/src/styles/finance.css`; Modify `frontend/src/pages/PlanningStep.jsx` somente para o botão "Gerar orçamento" (único ponto de contato; mudança mínima).
**Interfaces:** Consumes `/api/finance/*` da spec.

- [ ] `money.js`: `formatBRL(cents)`, `parseBRL(text) -> cents|null`; teste puro com "1.234,56", "10", "", "abc", negativos.
- [ ] Páginas: abas Orçamentos | Preços | Resumo; criar orçamento a partir de plano; aprovar; registrar pagamento; estorno com motivo; indicador de saldo; estados vazio/erro/carregando.
- [ ] Remover o aviso "Em breve" do menu é feito pelo controlador na integração.

## Task 6: Base de ações do assistente

**Files:** Create `backend/apps/assistant/models.py` (`AssistantProposal`), migration `0001_initial.py`, `backend/apps/assistant/registry.py` (registro de ações), `backend/apps/assistant/actions.py`, `backend/api/schemas_assistant.py`, `backend/tests/test_assistant.py`; Modify `backend/api/routers/assistant.py`.
**Interfaces:** Produces `/api/assistant/*` da spec. Registro: `Action(name, description, writes, params_model: type[BaseModel], run(user, params) -> dict, summarize(user, params) -> str)`; `registry.get(name)`, `registry.catalog()`. Consumes `returns_logic.due_returns` (Task 2): se ainda não existir, `list_returns_due` fica fora do registro e o agente informa; o controlador liga depois.

- [ ] Testes falhando: catálogo lista as ações; leitura executa e devolve resultado; escrita só devolve proposta e NÃO grava; confirmar grava e devolve resultado; confirmar duas vezes não duplica; proposta vencida (10 min, relógio injetável) = 410; proposta de outro usuário = 404; parâmetro `owner`/`user_id` ignorado; ação inexistente = 404; `create_appointment` respeita conflito de horário (409 na confirmação); resultados não expõem dados de paciente oculto; `AccessLog` gravado.
- [ ] Reaproveitar as regras de `routers/appointments.py` extraindo funções puras só se for preciso para não duplicar o teste de conflito; sem mudar o comportamento do router existente (testes antigos continuam verdes).
- [ ] Sem LLM, sem UI.

## Task 7: Integração (controlador)

- [ ] Ligar `list_returns_due`; README (seção "O que existe" + decisões); remover "Em breve" do Financeiro; rodar `pytest`, `npm test`, `npm run build`, Playwright e agent-browser nas telas novas; corrigir regressões.

## Ordem e paralelismo

Onda 1 em paralelo: Tasks 1, 2, 3, 4, 6 (arquivos disjuntos). Onda 2: Task 5 (precisa da 4). Onda 3: Task 7.
