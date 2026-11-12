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
- Front no navegador (Playwright): `cd frontend && npx playwright install --only-shell chromium && npm run test:e2e`. A suíte sobe o próprio backend (porta 8001) e o próprio frontend (porta 5174), com banco e fotos descartáveis, e falha se as portas estiverem ocupadas. O teste com detecção real precisa de internet: baixa o runtime e o modelo do MediaPipe e um retrato de exemplo, que fica fora do repositório.

## O que existe

- **Login e cadastro** por e-mail e senha (JWT, 12 h). Cada profissional só enxerga os próprios pacientes.
- **Pacientes**: lista com busca, cadastro, arquivamento e ocultação de dados. Nada é apagado.
- **Anamnese**: 15 perguntas sim/não semeadas por migration (editáveis no admin Django). "Sim" exige descrição. Cada alteração salva vira uma versão que não muda mais, com autor, data e a pergunta como foi feita; a tela mostra o histórico e o que mudou em cada versão. Anamnese salva antes deste recurso começa na versão 1, com o estado em que estava: o que já tinha sido sobrescrito não volta. Pergunta desativada sai do formulário, e a resposta já dada segue guardada e visível no histórico.
- **Planejamento facial**:
  - **base do plano**: foto frontal do paciente (câmera ou upload) ou **rosto simétrico de referência** (desenho de linhas, sem foto; o plano é salvo sem foto e os pontos valem para o desenho). Trocar de uma base para outra apaga os pontos colocados, porque as posições são da imagem. No rosto de referência não há simulação nem painel de simetria;
  - **o rosto ocupa a tela** (sem painel lateral; os totais ficam numa linha ao lado de "Salvar plano"). **O plano começa vazio**: tocar numa região do rosto amplia essa região, mesmo sem pontos (no computador, um anel com o nome da região segue o cursor; "Ir para região" faz o mesmo pelo teclado). Sobre a imagem aparecem os tratamentos (Botox, Preenchimento, Bioestimulador, Skinbooster, Outro): escolher um e tocar na imagem marca um ponto dele a cada toque, até "Concluir" ou Esc, e o ponto marcado tem a quantidade ajustável ali mesmo. Uma região entra em "Regiões do plano" quando ganha o primeiro ponto. O botão "Sugerir pontos" (só com o plano vazio) coloca os pontos sugeridos de uma vez: o MediaPipe detecta o rosto no navegador e posiciona os pontos, ou usa a posição padrão no rosto de referência. As 19 regiões são:
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
- Financeiro aparece como "Em breve".

## Decisões e limites

- **Nada se apaga** (decisão do responsável pelo projeto, 2026-11-06). A API não tem rota DELETE, o admin não oferece exclusão e o ORM recusa apagar registro (`apps/audit/retention.py`). Paciente sai da lista por **arquivamento**, com volta. Produto é desativado. Lote lançado errado tem o saldo ajustado com motivo.
- **Ocultar dados** tira nome, nascimento, contato, observações e fotos das telas e dos documentos, e fecha o planejamento. Tudo fica guardado e "Mostrar dados" devolve. Anamnese, termos assinados (com o nome de quem assinou) e rastreabilidade continuam visíveis. Como o dado continua guardado, isto **não é anonimização para a LGPD**: o sistema não atende um pedido de eliminação feito pelo paciente, e a guarda sem prazo final precisa de validação com assessoria jurídica.
- Editar ainda sobrescreve o valor anterior no cadastro e no rascunho de plano, que não têm histórico. Plano aplicado e assinatura não mudam. Quem tem acesso direto ao banco ou aos arquivos de foto ainda pode apagá-los; backup é tarefa da implantação.
- "Valor do ml" é a **quantidade** aplicada em cada ponto, sem preço. Orçamentos e recebimentos, quando existirem, ficam no Financeiro.
- Toxina é dosada em **unidades (U)**; preenchimento, bioestimulador, skinbooster e outro, em **ml**.
- A simulação é um efeito de imagem no navegador, não um modelo de IA. A IA que simula o tratamento (anotada no esboço) é a próxima etapa e exige um modelo generativo e revisão clínica.
- Fotos de pacientes são dados sensíveis (LGPD). Ficam em `backend/media`, sem rota pública, e só saem por `/api/photos/{id}/file` com token. O upload é regravado como JPEG, o que remove EXIF/GPS.
- O MediaPipe roda localmente: a foto não vai para nenhum serviço. Só o runtime WASM (jsDelivr) e o modelo (Google Storage) são baixados; para produção ou uso offline, hospede os dois (`frontend/src/planning/faceLandmarks.js`).
- Sem refresh token ainda. O limite de tentativas de login fica em memória: com vários processos, precisa de armazenamento compartilhado.

## Decisões da agenda e do relatório mensal

- Agendamento nunca é apagado: cancelar muda o status, e agendamento cancelado não ocupa o horário (reativar exige o horário livre). O conflito é por profissional. Criar, editar e mudar status travam o profissional (`select_for_update`) dentro da transação antes de checar o conflito, para dois pedidos simultâneos não duplicarem o horário no SQL Server. O SQLite ignora o bloqueio, e não há teste de concorrência real.
- Novo paciente é um "lead" (nome e telefone no próprio agendamento); "Cadastrar como paciente" cria o cadastro e vincula. Não há checagem de duplicidade com pacientes existentes.
- Agenda semanal de 07h às 20h (a grade se estende sozinha se houver agendamento fora da faixa; cancelados ficam ocultos até marcar "Mostrar cancelados"), sem recorrência, sem lembretes e sem integração com calendário externo.
- O relatório mensal reaproveita a consulta de `/reports/usage`; o consumo de produto inclui aplicações de pacientes com dados ocultos (estoque não expõe dado pessoal), mas a lista de pacientes não (a tela avisa).
- Todo CSV exportado neutraliza texto que começa com `=`, `+`, `-` ou `@` (apóstrofo na frente), para o Excel não executar como fórmula.
- Retenção: a clínica precisa guardar os dados e os relatórios das pessoas por 5 anos, então o nome e o telefone do lead permanecem no agendamento (cancelar só muda o status) e nada é apagado automaticamente. Listar agendamentos não grava log de acesso (criar e editar gravam); decisão consciente, a rever se a rastreabilidade de leitura for exigida.

## Próximos passos

1. Agenda: lembretes por WhatsApp/e-mail, recorrência, bloqueio de horários e visão diária no celular.
2. Financeiro (orçamentos e recebimentos) e histórico por paciente.
3. Simulação por IA a partir do planejamento.
