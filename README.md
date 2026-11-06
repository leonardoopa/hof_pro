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
- Senha do SQL Server (`sa`) e chave do Django têm valores de desenvolvimento. Para trocar, edite `DB_PASSWORD` e `DJANGO_SECRET_KEY` no `.env`. A senha fica gravada no volume na primeira subida; para trocar depois use `docker compose down -v`.
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
- **Pacientes**: lista com busca, cadastro, exclusão.
- **Anamnese**: 15 perguntas sim/não semeadas por migration (editáveis no admin Django). "Sim" exige descrição.
- **Planejamento facial**:
  - foto frontal pela câmera ou por upload;
  - o MediaPipe detecta o rosto no navegador e posiciona os pontos sugeridos em 19 regiões:
    - terço superior: testa, glabela, têmporas, periorbital (pés de galinha);
    - terço médio: olheiras, nariz (inclui bunny lines), zigomático, malar, submalar, nasolabial, sorriso gengival (LLSAN);
    - terço inferior: boca, marionete, DAO, mento (inclui mentual), pré-jowl, mandíbula, masseter;
    - pescoço: platisma;
  - cada ponto sugerido tem nome anatômico (ex.: prócero, corrugador medial, arco do cupido), salvo no plano; a região mostra um alerta de risco quando o estudo em `docs/IMPLEMENTACAO-FOTO-PONTOS-ANTES-DEPOIS.md` tem fonte para ele. Doses de referência não aparecem até serem validadas por profissional;
  - planos salvos antes dos nomes de ponto ganham as regiões que faltam (quantidade 0) ao abrir; nos demais, região vazia é escolha do profissional e continua vazia;
  - tocar numa região dá zoom e mostra os pontos; cada ponto tem produto e quantidade, pode ser arrastado, removido ou adicionado;
  - resumo ao vivo: total de ml (preenchimentos), unidades (toxina) e número de áreas;
  - **Simular resultado**: comparação antes/depois ilustrativa (suavização para toxina, volume local para preenchedores).
- **Região boca** (lábios) e **técnica / profundidade / lote** por ponto no mapa facial.
- **Estoque**: produtos (marca, unidade, registro Anvisa) e lotes com validade e saldo; alerta de vencimento (30 dias); "Marcar como aplicado" dá baixa atômica nos lotes (bloqueia lote vencido, unidade incompatível e saldo insuficiente) e grava o **cartão de rastreabilidade** imprimível por paciente.
- **Prontuário / Termos**: termos versionados, assinatura desenhada no canvas (PNG), hash SHA-256 do conteúdo, data/hora e IP; autorização de uso de imagem separada e revogável; documento imprimível.
- **Evolução**: comparação antes/depois de fotos do paciente, com alinhamento pelos olhos.
- **Resumo e Orientações**: orientações pós-procedimento por tratamento, geradas a partir do plano, imprimíveis.
- **Design system** (`styles/tokens.css`) com tema claro/escuro e alternador.
- Financeiro aparece como "Em breve".

## Decisões e limites

- "Valor do ml" foi lido como **quantidade** aplicada em cada ponto. Valores em reais ficam para o Financeiro.
- Toxina é dosada em **unidades (U)**; preenchimento, bioestimulador, skinbooster e outro, em **ml**.
- A simulação é um efeito de imagem no navegador, não um modelo de IA. A IA que simula o tratamento (anotada no esboço) é a próxima etapa e exige um modelo generativo e revisão clínica.
- Fotos de pacientes são dados sensíveis (LGPD). Ficam em `backend/media`, sem rota pública, e só saem por `/api/photos/{id}/file` com token. O upload é regravado como JPEG, o que remove EXIF/GPS.
- O MediaPipe roda localmente: a foto não vai para nenhum serviço. Só o runtime WASM (jsDelivr) e o modelo (Google Storage) são baixados; para produção ou uso offline, hospede os dois (`frontend/src/planning/faceLandmarks.js`).
- Sem refresh token ainda. O limite de tentativas de login fica em memória: com vários processos, precisa de armazenamento compartilhado.

## Próximos passos

1. Financeiro (orçamentos e recebimentos) e histórico por paciente.
2. Simulação por IA a partir do planejamento.
