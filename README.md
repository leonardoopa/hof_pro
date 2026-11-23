# HOF PRO

Painel para profissionais de estética facial: cadastro de pacientes, anamnese, planejamento facial com pontos de aplicação (ml / unidades) e pré-visualização do resultado.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Modelos, migrations, admin, hash de senha | Django 5 |
| API REST (`/api`, docs em `/docs`) | FastAPI + JWT |
| Banco | SQL Server (via `mssql-django`) — SQLite como alternativa de desenvolvimento |
| Front | React 19 + Vite, React Router, MediaPipe Face Landmarker |

Django e FastAPI rodam no **mesmo processo**: `backend/config/asgi.py` monta o Django (admin, estáticos) dentro do app FastAPI. FastAPI usa o ORM do Django, então há um único modelo de dados e um único conjunto de migrations.

## Rodando

### Com Docker (recomendado)

```bash
cp .env.example .env   # opcional: sem ele valem os mesmos valores de desenvolvimento
docker compose up --build
```

O projeto tem um único arquivo de configuração (`.env` na raiz, modelo em `.env.example`) e um único `requirements.txt` (na raiz). Com Docker não é preciso instalar nada além do Docker: as imagens instalam o `requirements.txt` e o `package.json` sozinhas.

Abra http://localhost:5173 e crie sua conta em `/cadastro`. A API fica em http://localhost:8000/docs e o admin Django em http://localhost:8000/admin/.

O compose sobe três serviços: SQL Server, backend (espera o banco, cria o banco `hofpro` e aplica as migrations) e frontend. Código de `backend/` e `frontend/` é montado nos containers, então editar recarrega sozinho.

- Primeira subida baixa cerca de 1,5 GB de imagens.
- Mac Apple Silicon: Docker Desktop > Settings > General > "Use Rosetta for x86_64/amd64 emulation" (a imagem do SQL Server só existe para amd64).
- Senha do SQL Server (`sa`) e chave do Django têm valores de desenvolvimento. Para trocar, edite `DB_PASSWORD` e `DJANGO_SECRET_KEY` no `.env`. A senha fica gravada no volume na primeira subida; para trocar depois use `docker compose down -v`, que apaga banco e fotos: faça backup antes.
- O build do backend instala o driver ODBC 18 da Microsoft e aceita a licença dele (`ACCEPT_EULA=Y` no `backend/Dockerfile`).
- Parar: `docker compose down`. Apagar também banco e fotos: `docker compose down -v`.

### Sem Docker

Backend (SQLite, sem precisar de SQL Server):

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # e, no .env, troque DB_ENGINE=mssql por DB_ENGINE=sqlite
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/uvicorn config.asgi:application --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxy de /api para :8000)
```

Para usar SQL Server sem Docker no backend, instale o driver (`brew tap microsoft/mssql-release && brew install msodbcsql18`), deixe `DB_ENGINE=mssql` no `.env` da raiz e ajuste os `DB_*`, rode `manage.py ensure_db` (cria o banco) e depois `migrate`.

Testes:

- Backend (SQLite, não precisa de SQL Server): `cd backend && ../.venv/bin/python -m pytest`
- Front, funções puras (pontos, simetria, layout): `cd frontend && npm test`
- Front no navegador (Playwright): `cd frontend && npx playwright install --only-shell chromium && npm run test:e2e`. A suíte sobe o próprio backend (porta 8001) e o próprio frontend (porta 5174), com banco e fotos descartáveis, e falha se as portas estiverem ocupadas; troque com `E2E_BACKEND_PORT` e `E2E_FRONTEND_PORT`. O teste com detecção real precisa de internet: baixa o runtime e o modelo do MediaPipe e um retrato de exemplo, que fica fora do repositório.

## O que existe

- **Login e cadastro** por e-mail e senha (JWT, 12 h). Cada profissional só enxerga os próprios pacientes.
- **Pacientes**: lista com busca, cadastro, arquivamento e ocultação de dados. Nada é apagado.
- **Anamnese**: 15 perguntas sim/não semeadas por migration (editáveis no admin Django). "Sim" exige descrição. Cada alteração salva vira uma versão que não muda mais, com autor, data e a pergunta como foi feita; a tela mostra o histórico e o que mudou em cada versão. Anamnese salva antes deste recurso começa na versão 1, com o estado em que estava: o que já tinha sido sobrescrito não volta. Pergunta desativada sai do formulário, e a resposta já dada segue guardada e visível no histórico. Ao fim do formulário, o **paciente assina a versão salva**: declaração de veracidade, nome e assinatura desenhada no canvas (PNG), com data, IP e hash SHA-256 das respostas, da declaração e da assinatura (`POST /api/patients/{id}/anamnesis/signature`). Uma assinatura por versão; alterar a anamnese cria versão nova, que pede assinatura nova, e o histórico mostra qual versão foi assinada.
- **Planejamento facial**:
  - **base do plano**: foto frontal do paciente (câmera ou upload) ou **rosto simétrico de referência** (retrato de estúdio em `frontend/public/reference-face.jpg`, sem foto do paciente; o plano é salvo sem foto e os pontos valem para essa imagem). Trocar de uma base para outra apaga os pontos colocados, porque as posições são da imagem. No rosto de referência não há simulação nem painel de simetria;
  - **o rosto ocupa a tela** (sem painel lateral, sem lista de regiões e sem faixa de controles abaixo dele; os totais ficam numa linha ao lado de "Salvar plano", as observações abrem numa janela pelo botão "Observações", e simular, ocultar pontos, sugerir pontos e trocar a imagem são botões redondos sobre a imagem). **O plano começa vazio**: tocar numa região do rosto amplia essa região, mesmo sem pontos (no computador, um anel com o nome da região segue o cursor; "Ir para região" faz o mesmo pelo teclado). Sobre a imagem aparecem os tratamentos (Botox, Preenchimento, Bioestimulador, Skinbooster, Outro): escolher um e tocar na imagem marca um ponto dele a cada toque, até "Concluir" ou Esc, e o ponto marcado tem a quantidade ajustável ali mesmo. Na região aberta, as posições sugeridas aparecem como alvos tracejados: com um tratamento escolhido, tocar num alvo marca o ponto já com o nome anatômico; sem tratamento escolhido, nada é marcado. Uma região ganha marcador no rosto quando recebe o primeiro ponto. O botão "Sugerir pontos" (só com o plano vazio) coloca os pontos sugeridos de uma vez: o MediaPipe detecta o rosto no navegador e posiciona os pontos, ou usa a posição padrão no rosto de referência. As 19 regiões são:
    - terço superior: testa, glabela, têmporas, periorbital (pés de galinha);
    - terço médio: olheiras, nariz (inclui bunny lines), zigomático, malar, submalar, nasolabial, sorriso gengival (LLSAN);
    - terço inferior: boca, marionete, DAO, mento (inclui mentual), pré-jowl, mandíbula, masseter;
    - pescoço: platisma;
  - cada ponto sugerido tem nome anatômico (ex.: prócero, corrugador medial, arco do cupido), salvo no plano; a região mostra um alerta de risco quando o estudo em `docs/IMPLEMENTACAO-FOTO-PONTOS-ANTES-DEPOIS.md` tem fonte para ele. Doses de referência não aparecem até serem validadas por profissional;
  - planos já salvos abrem como foram salvos, sem regiões acrescentadas;
  - a região ampliada mostra os pontos dela no painel ao lado (abaixo, no celular); cada ponto tem produto e quantidade, pode ser arrastado, removido ou adicionado;
  - totais ao vivo: unidades (toxina), ml (demais) e número de áreas;
  - **Simular resultado**: comparação antes/depois ilustrativa, com divisor (suavização para toxina, volume local para preenchedores, clareamento do vinco nos sulcos).
- **Região boca** (lábios) e **técnica / profundidade / lote** por ponto no mapa facial. O lote sai do estoque ou é cadastrado ali mesmo em "Novo lote" (com produto novo, se preciso), já entrando no estoque.
- **Estoque**: produtos (marca, unidade, registro Anvisa), cadastrados já com o primeiro lote, e lotes com validade e saldo; alerta de vencimento (30 dias); "Marcar como aplicado" dá baixa atômica nos lotes (bloqueia lote vencido, unidade incompatível e saldo insuficiente) e grava o **cartão de rastreabilidade** imprimível por paciente, com região e nome do ponto.
- **Prontuário / Termos**: só os termos dos tratamentos do plano mais recente (com quantidade) aparecem, e a API recusa assinar um procedimento fora do plano (409); o de uso de imagem vale sempre. Termos versionados, assinatura desenhada no canvas (PNG), hash SHA-256 do conteúdo, data/hora e IP; autorização de uso de imagem separada e revogável; documento imprimível.
- **Evolução**: comparação antes/depois de fotos do paciente, com alinhamento pelos olhos. Abaixo, fotos das etiquetas dos produtos (arquivo ou câmera traseira): ficam fora da comparação, não servem de base ao plano e abrem ampliadas para ler lote e validade.
- **Resumo e Orientações**: orientações pós-procedimento por tratamento, geradas a partir do plano, imprimíveis.
- **Design system** (`styles/tokens.css`) com tema claro/escuro e alternador.
- **Relatório mensal** (`GET /api/reports/monthly?month=AAAA-MM`): pacientes atendidos no mês (com novos cadastros e nº de aplicações), produtos e lotes usados (total em U/ml, validade e saldo atual), exportação CSV. Pacientes com dados ocultos ficam de fora.
- **Agenda** (app `scheduling`, `/api/appointments`): visão semanal, agendamento de paciente cadastrado ou de novo paciente (nome/telefone), status (agendado, confirmado, realizado, cancelado, faltou), conflito de horário (409) e conversão do lead em paciente. Auditado.
- **Intercorrências** (app `safety`, aba "Intercorrências" do paciente): registro de evento adverso (oclusão vascular, nódulo, edema, hematoma, ptose, infecção, alergia, assimetria) ligado à aplicação, que traz região, ponto e lote. O botão "Suspeita de oclusão vascular" abre o protocolo na tela: cronômetro desde o início, passos sem dose, checklist de sinais (alteração visual, dor ocular ou sinal neurológico vira aviso de emergência) e as referências (Cohen et al., Aesthet Surg J 2015; guia CMAC, JCAD 2021; força-tarefa ASDS). A hialuronidase usada sai do saldo do lote, como numa aplicação. Desfecho, data e número da notificação à Anvisa ficam no registro, e "Copiar resumo para o Notivisa" gera o texto para colar no formulário. O sistema não envia nada à Anvisa.
- **Recall por lote** (`GET /api/inventory/lots/{id}/patients`, botão com ícone de pessoas no Estoque): quem recebeu o lote, com data, região e contato, para alerta da Anvisa ou recolhimento do fabricante. Paciente com dados ocultos aparece como tal. A consulta é auditada.
- **Checagem antes de "Marcar como aplicado"** (`GET /api/plans/{id}/apply-check`): avisa, sem bloquear, anamnese não preenchida, termo do tratamento não assinado, toxina aplicada há menos de `TOXIN_MIN_INTERVAL_DAYS` dias (padrão 84, com o total de unidades no período), preenchedor em zona de maior risco vascular (nariz, glabela, testa, nasolabial, malar), ponto sem lote e intercorrência em acompanhamento.
- **Histórico do paciente** (aba "Histórico", `GET /api/patients/{id}/timeline?limit=`): linha do tempo única, do mais novo para o mais antigo, com plano, aplicação, termo, intercorrência, agendamento, foto, versão de anamnese, orçamento e pagamento. Com dados ocultos, nenhum item leva nome, texto livre nem foto. A leitura é auditada.
- **Retornos** (`GET /api/returns?within_days=`, tela "Retornos"): quem está perto de voltar para reaplicação, por paciente e tipo de produto. O intervalo vem de `Product.return_interval_days` ou, sem ele, do padrão do tipo (toxina 120 dias, bioestimulador 180, preenchedor 365, skinbooster 90; "outro" só com intervalo próprio). São valores de partida configuráveis, **não recomendação clínica**. "Próximo" = vence em até 30 dias. Paciente com agendamento futuro não cancelado sai da fila. A tela gera a mensagem e o link `wa.me`; o envio é do dentista (nada é enviado pelo sistema).
- **Pendências do prontuário** (`GET /api/compliance`, tela "Pendências"): anamnese ausente, procedimento aplicado sem termo, ponto aplicado sem lote, intercorrência em acompanhamento e plano parado há mais de 30 dias, por prioridade, com link para a aba certa.
- **Financeiro** (app `finance`, `/api/finance`, tela "Financeiro"): tabela de preços por tratamento e região, orçamento manual ou gerado do plano (`from-plan`; item sem preço entra com valor 0 e aviso), aprovação, pagamentos por forma, **estorno por lançamento negativo** (pagamento nunca é editado nem apagado), saldo e resumo mensal. Dinheiro em centavos inteiros. O botão "Gerar orçamento" fica no planejamento.
- **Base do assistente** (app `assistant`, `/api/assistant`): só a camada de ações, sem LLM e sem tela. `GET /actions` lista o catálogo; leitura executa na hora; escrita (`create_appointment`, `reschedule_appointment`, `cancel_appointment`) vira proposta que só grava em `POST /proposals/{id}/confirm` (idempotente, vence em 10 minutos, auditada). O dono vem sempre da sessão. Um assistente de chat futuro deve chamar estas ações.

## Decisões e limites

- **Nada se apaga** (decisão do responsável pelo projeto, 2026-11-06). A API não tem rota DELETE, o admin não oferece exclusão e o ORM recusa apagar registro (`apps/audit/retention.py`). Paciente sai da lista por **arquivamento**, com volta. Produto é desativado. Lote lançado errado tem o saldo ajustado com motivo.
- **Ocultar dados** tira nome, nascimento, contato, observações e fotos das telas e dos documentos, e fecha o planejamento. Tudo fica guardado e "Mostrar dados" devolve. Anamnese, termos assinados (com o nome de quem assinou) e rastreabilidade continuam visíveis. Como o dado continua guardado, isto **não é anonimização para a LGPD**: o sistema não atende um pedido de eliminação feito pelo paciente, e a guarda sem prazo final precisa de validação com assessoria jurídica.
- Editar ainda sobrescreve o valor anterior no cadastro e no rascunho de plano, que não têm histórico. Plano aplicado e assinatura não mudam. Quem tem acesso direto ao banco ou aos arquivos de foto ainda pode apagá-los; backup é tarefa da implantação.
- "Valor do ml" é a **quantidade** aplicada em cada ponto, sem preço. Orçamentos e recebimentos, quando existirem, ficam no Financeiro.
- Toxina é dosada em **unidades (U)**; preenchimento, bioestimulador, skinbooster e outro, em **ml**.
- A simulação é um efeito de imagem no navegador, não um modelo de IA. A IA que simula o tratamento (anotada no esboço) é a próxima etapa e exige um modelo generativo e revisão clínica.
- Fotos de pacientes são dados sensíveis (LGPD). Ficam em `backend/media`, sem rota pública, e só saem por `/api/photos/{id}/file` com token. O upload é regravado como JPEG, o que remove EXIF/GPS.
- O MediaPipe roda localmente: a foto não vai para nenhum serviço. Só o runtime WASM (jsDelivr) e o modelo (Google Storage) são baixados; para produção ou uso offline, hospede os dois (`frontend/src/planning/faceLandmarks.js`).
- O intervalo de toxina (84 dias) vem de literatura de uso terapêutico; para estética não achamos consenso brasileiro. É aviso, não bloqueio, e a clínica ajusta em `TOXIN_MIN_INTERVAL_DAYS`. O protocolo de oclusão não mostra dose de hialuronidase pelo mesmo motivo das doses de referência: falta validação por profissional.
- Sem refresh token ainda. O limite de tentativas de login fica em memória: com vários processos, precisa de armazenamento compartilhado.

## Decisões da agenda e do relatório mensal

- Agendamento nunca é apagado: cancelar muda o status, e agendamento cancelado não ocupa o horário (reativar exige o horário livre). O conflito é por profissional. Criar, editar e mudar status travam o profissional (`select_for_update`) dentro da transação antes de checar o conflito, para dois pedidos simultâneos não duplicarem o horário no SQL Server. O SQLite ignora o bloqueio, e não há teste de concorrência real.
- Novo paciente é um "lead" (nome e telefone no próprio agendamento); "Cadastrar como paciente" cria o cadastro e vincula. Não há checagem de duplicidade com pacientes existentes.
- Agenda semanal de 07h às 20h (a grade se estende sozinha se houver agendamento fora da faixa; cancelados ficam ocultos até marcar "Mostrar cancelados"), sem recorrência, sem lembretes e sem integração com calendário externo.
- O relatório mensal reaproveita a consulta de `/reports/usage`; o consumo de produto inclui aplicações de pacientes com dados ocultos (estoque não expõe dado pessoal), mas a lista de pacientes não (a tela avisa).
- Todo CSV exportado neutraliza texto que começa com `=`, `+`, `-` ou `@` (apóstrofo na frente), para o Excel não executar como fórmula.
- Retenção: a clínica precisa guardar os dados e os relatórios das pessoas por 5 anos, então o nome e o telefone do lead permanecem no agendamento (cancelar só muda o status) e nada é apagado automaticamente. Listar agendamentos não grava log de acesso (criar e editar gravam); decisão consciente, a rever se a rastreabilidade de leitura for exigida.

## Decisões desta rodada (2026-11-20)

- Escopo escolhido pelo responsável: histórico, retornos, financeiro e só a base do assistente; "pendências" foi escolha minha a partir da pesquisa.
- Fica de fora de propósito: LLM, WhatsApp API, voz, bot de paciente, anamnese por link público, calculadora de dose, aniversário/NPS e programa de indicação (base LGPD, ética de publicidade e validação clínica pendentes).
- Pagamento duplicado por clique duplo com valor parcial é indistinguível de dois pagamentos reais (sem chave de idempotência); só o saldo trava. `select_for_update` não age no SQLite: a serialização real vale no SQL Server e não foi testada lá.
- A base legal da HOF por dentistas está em disputa judicial (a 8ª Turma do TRF1 anulou a Resolução CFO 198/2019 em 19/08/2026; cabe recurso). Por isso o produto não usa "especialista em HOF" como rótulo nem campo obrigatório. Não substitui orientação jurídica.
- Retenção continua 5 anos, sem purge (decisão do responsável). A pesquisa citou prazos maiores para prontuário (10 anos pelo CFO, 20 pela Lei 13.787/2018); como nada é apagado, não há conflito, mas confirme com assessoria jurídica antes de qualquer rotina de expurgo.

## Próximos passos

1. Agenda: lembretes por WhatsApp/e-mail, recorrência, bloqueio de horários e visão diária no celular.
2. Financeiro: parcelamento, pacotes de sessões e chave de idempotência nos pagamentos.
3. Assistente de chat (LLM com tool use sobre `/api/assistant`), depois bot de WhatsApp para pacientes (API oficial, templates aprovados, opt-in).
4. Retornos: editar o intervalo por produto na tela de Estoque.
5. Simulação por IA a partir do planejamento.
6. Da pesquisa de 2026-11 (ainda não feito): retorno de 15 dias e retoque de toxina ligado à sessão original; kit de emergência com conferência mensal no estoque; copiar sessão anterior e modelos de plano; prontuário completo exportável em PDF; anamnese preenchida pelo paciente com confirmação da profissional.
7. Público: no início o produto é só para cirurgiões-dentistas (decisão do responsável, 2026-11-19); o cadastro pede o registro no CRO. Risco a acompanhar: o TRF-1 anulou a Resolução CFO 198/2019 (HOF como especialidade do dentista) em 19/08/2026, e o CFO anunciou recurso.
