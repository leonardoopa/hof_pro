# HOF PRO — rodada de evolução (histórico, retornos, pendências, financeiro, base do assistente)

Data: 2026-11-20. Aprovado pelo responsável do projeto por instrução direta ("aprove o plano e execute tudo"); escolhas de escopo respondidas por ele na conversa.

## Intenção

O produto é para dentistas (CRO) que fazem HOF. O núcleo clínico já existe (anamnese, planejamento facial, estoque por lote, termos, intercorrências, recall, agenda, relatório mensal). Esta rodada acrescenta o que faz o dentista voltar todo dia e ganhar dinheiro com o sistema: ver tudo do paciente num lugar, saber quem precisa voltar, fechar pendências do prontuário, orçar e receber, e deixar pronta a camada que um assistente de chat vai usar depois.

## Escolhas do responsável

- Assistente: **só a base de ações** (serviços internos + API propor/confirmar). Sem UI de chat, sem LLM.
- Frentes: histórico do paciente, financeiro, retorno e lembretes, e "as melhores da pesquisa" (escolha minha: painel de pendências do prontuário, ideia 7 da pesquisa).

## Metas

1. Linha do tempo única por paciente.
2. Lista de retornos (reaplicação) com intervalo configurável por tipo de produto e mensagem pronta de WhatsApp (link `wa.me`, sem API paga).
3. Painel de pendências: aplicações/planos sem termo, sem lote, sem anamnese, intercorrência em acompanhamento.
4. Financeiro: tabela de preços, orçamento gerado a partir do plano, pagamentos, saldo, relatório de receita.
5. Base do assistente: registro de ações tipadas, cada escrita em duas etapas (propor, confirmar), auditada.

## Não-metas / anti-metas

- Nada de LLM, WhatsApp API, voz, bot de paciente, anamnese por link público, calculadora de dose/diluição (precisa validação clínica), programa de indicação e aniversário/NPS (base LGPD e ética de publicidade a validar).
- Nada é apagado (decisão antiga): sem rota DELETE, sem exclusão no admin. Orçamento e pagamento mudam de status; pagamento errado é estornado por lançamento, não editado.
- Público continua só dentistas com CRO. Não usar "especialista em HOF" como rótulo ou campo obrigatório (a base legal da HOF por dentistas está em disputa judicial; ver relatório da pesquisa).
- Retenção: 5 anos, sem purge (decisão do responsável). Não reabrir.

## Abordagens consideradas

- **A. Um módulo por frente, em paralelo, cada um com router, schemas e testes próprios (escolhida).** Cabe no padrão atual (um router FastAPI por área, um app Django por modelo novo). Frentes não compartilham arquivos além da fiação que eu faço antes.
- B. Um serviço único "domínio" e telas finas. Mais limpo a longo prazo, reescreve o que existe. Descartada: risco alto, ganho só futuro.
- C. Só frontend, calculando tudo no navegador. Descartada: assistente e relatórios precisam da regra no servidor.

## Decisões minhas (marcadas como minhas, corrigíveis)

- Intervalos padrão de retorno por tipo de produto, configuráveis em `Product.return_interval_days` (nulo = usa o padrão do tipo): toxina 120 dias, bioestimulador 180, preenchedor 365, skinbooster 90, outro sem lembrete. Não é recomendação clínica; a tela diz isso. Fonte do padrão: faixa de 4 a 6 meses citada pelo responsável; pesquisa mostrou variação grande.
- "Próximo" = vence em até 30 dias. "Vencido" = passou da data. Paciente com agendamento futuro (não cancelado) sai da fila de retorno.
- Mensagem de WhatsApp é só texto copiável + link `wa.me`; o dentista envia. Lembrete de retorno é ato de atendimento, sem campanha comercial.
- Preços no financeiro: por produto/tratamento e região opcional; moeda BRL em centavos inteiros (`amount_cents`) para evitar erro de ponto flutuante.
- Estorno de pagamento = novo lançamento negativo ligado ao original.

## Contratos de API (fonte da verdade para backend e frontend)

Todas as rotas exigem JWT e filtram pelo dono, como as existentes. Datas em ISO 8601.

### Histórico — `GET /api/patients/{id}/timeline?limit=100`
```json
{"items": [{"at": "...", "kind": "plano|aplicacao|termo|intercorrencia|agendamento|foto|anamnese|orcamento|pagamento",
            "title": "Aplicação de toxina", "detail": "Glabela, 20 U, lote L1", "ref": {"type": "plan", "id": 3}}]}
```
Ordem do mais novo para o mais antigo. Paciente com dados ocultos: itens sem nome pessoal. Grava log de acesso.

### Retornos — `GET /api/returns?within_days=30`
```json
{"items": [{"patient_id": 1, "patient_name": "Maria", "phone": "119...", "kind": "toxina",
            "last_applied_at": "...", "due_on": "2026-12-01", "days_overdue": -11,
            "status": "vencido|proximo|em_dia", "interval_days": 120, "interval_source": "produto|padrao",
            "message": "Olá, Maria! ..."}],
 "defaults": {"toxina": 120, "bioestimulador": 180, "preenchedor": 365, "skinbooster": 90}}
```
`PATCH /api/inventory/products/{id}` aceita `return_interval_days` (1..1825 ou null).

### Pendências — `GET /api/compliance`
```json
{"items": [{"patient_id": 1, "patient_name": "Maria", "code": "sem_termo|sem_lote|sem_anamnese|intercorrencia_aberta|plano_sem_aplicacao",
            "severity": "alta|media|baixa", "message": "...", "ref": {"type": "plan", "id": 3}}],
 "counts": {"alta": 1, "media": 2, "baixa": 0}}
```

### Financeiro — prefixo `/api/finance`
- `GET|POST /price-items` — `{id, name, treatment, region|null, unit_price_cents, active}`; `PATCH /price-items/{id}` (desativar em vez de apagar).
- `POST /budgets` `{patient_id, plan_id|null, items:[{description, quantity, unit_price_cents}], discount_cents, notes}` → orçamento `status=rascunho`.
- `POST /budgets/from-plan/{plan_id}` — monta itens a partir dos pontos do plano e da tabela de preços (item sem preço sai com 0 e aviso).
- `GET /budgets?patient_id=` / `GET /budgets/{id}` — `{id, patient_id, status, total_cents, paid_cents, balance_cents, items, payments}`.
- `POST /budgets/{id}/status` `{status: "aprovado|recusado|cancelado"}`; só `rascunho` vira aprovado/recusado; aprovado não edita itens.
- `POST /budgets/{id}/payments` `{amount_cents, method: "pix|dinheiro|debito|credito|boleto|outro", paid_at, notes}`; só em orçamento aprovado; não excede o saldo.
- `POST /payments/{id}/reverse` `{reason}` — cria lançamento negativo.
- `GET /summary?month=AAAA-MM` — `{billed_cents, received_cents, open_cents, by_method: {...}, by_day: [...]}`.

### Base do assistente — prefixo `/api/assistant`
- `GET /actions` — catálogo `[{name, description, writes: bool, params_schema}]`.
- `POST /actions/{name}/propose` `{params}` → `{proposal_id, summary, writes, expires_at, params}`; leitura executa na hora e devolve `{result}`.
- `POST /proposals/{id}/confirm` → executa e devolve `{result}`; idempotente (segunda chamada devolve o mesmo resultado); proposta vence em 10 min.
- Ações iniciais: `search_patients`, `list_free_slots`, `create_appointment`, `reschedule_appointment`, `cancel_appointment`, `list_returns_due`, `get_patient_summary`.
- O dono vem da sessão, nunca de parâmetro. Toda proposta e confirmação grava `AccessLog` e uma linha `AssistantProposal` (params, resumo, estado).

## O que fica para quem constrói

Detalhes de layout, mensagens de erro e nomes internos, desde que respeitem os contratos acima e os padrões do repositório (`@orm`, `log_access`, `get_patient_or_404`, testes pytest com `client`/`auth`).
