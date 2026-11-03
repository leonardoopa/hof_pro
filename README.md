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
docker compose up --build
```

Abra http://localhost:5173 e crie sua conta em `/cadastro`. A API fica em http://localhost:8000/docs e o admin Django em http://localhost:8000/admin/.

O compose sobe três serviços: SQL Server, backend (espera o banco, cria o banco `hofpro` e aplica as migrations) e frontend. Código de `backend/` e `frontend/` é montado nos containers, então editar recarrega sozinho.

- Primeira subida baixa cerca de 1,5 GB de imagens.
- Mac Apple Silicon: Docker Desktop > Settings > General > "Use Rosetta for x86_64/amd64 emulation" (a imagem do SQL Server só existe para amd64).
- Senha do SQL Server (`sa`) e chave do Django têm valores de desenvolvimento. Para trocar, crie um `.env` na raiz com `DB_PASSWORD` e `DJANGO_SECRET_KEY`. A senha fica gravada no volume na primeira subida; para trocar depois use `docker compose down -v`.
- O build do backend instala o driver ODBC 18 da Microsoft e aceita a licença dele (`ACCEPT_EULA=Y` no `backend/Dockerfile`).
- Parar: `docker compose down`. Apagar também banco e fotos: `docker compose down -v`.

### Sem Docker

Backend (SQLite, sem precisar de SQL Server):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
printf 'DB_ENGINE=sqlite\n' > .env
.venv/bin/python manage.py migrate
.venv/bin/uvicorn config.asgi:application --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxy de /api para :8000)
```

Para usar SQL Server sem Docker no backend, instale o driver (`brew tap microsoft/mssql-release && brew install msodbcsql18`), copie `backend/.env.example` para `backend/.env`, rode `manage.py ensure_db` (cria o banco) e depois `migrate`.

Testes (SQLite, não precisam de SQL Server): `cd backend && .venv/bin/python -m pytest`

## O que existe

- **Login e cadastro** por e-mail e senha (JWT, 12 h). Cada profissional só enxerga os próprios pacientes.
- **Pacientes**: lista com busca, cadastro, exclusão.
- **Anamnese**: 15 perguntas sim/não semeadas por migration (editáveis no admin Django). "Sim" exige descrição.
- **Planejamento facial**:
  - foto frontal pela câmera ou por upload;
  - o MediaPipe detecta o rosto no navegador e posiciona os pontos sugeridos (testa, têmporas, olheiras, malar, nasolabial, mandíbula, mento, dos dois lados);
  - tocar numa região dá zoom e mostra os pontos; cada ponto tem produto e quantidade, pode ser arrastado, removido ou adicionado;
  - resumo ao vivo: total de ml (preenchimentos), unidades (toxina) e número de áreas;
  - **Simular resultado**: comparação antes/depois ilustrativa (suavização para toxina, volume local para preenchedores).
- Estoque, Prontuário/Termos, Resumo e Financeiro aparecem como "Em breve".

## Decisões e limites

- "Valor do ml" foi lido como **quantidade** aplicada em cada ponto. Valores em reais ficam para o Financeiro.
- Toxina é dosada em **unidades (U)**; preenchimento, bioestimulador, skinbooster e outro, em **ml**.
- A simulação é um efeito de imagem no navegador, não um modelo de IA. A IA que simula o tratamento (anotada no esboço) é a próxima etapa e exige um modelo generativo e revisão clínica.
- Fotos de pacientes são dados sensíveis (LGPD). Ficam em `backend/media`, sem rota pública, e só saem por `/api/photos/{id}/file` com token. O upload é regravado como JPEG, o que remove EXIF/GPS.
- O MediaPipe roda localmente: a foto não vai para nenhum serviço. Só o runtime WASM (jsDelivr) e o modelo (Google Storage) são baixados; para produção ou uso offline, hospede os dois (`frontend/src/planning/faceLandmarks.js`).
- Sem rate limit no login e sem refresh token ainda.

## Próximos passos (do esboço)

1. Estoque com marca / lote / validade e alerta de vencimento.
2. Prontuário e termos de consentimento com assinatura digital, depois do planejamento.
3. Resumo e orientações pós-procedimento.
4. Financeiro e aba de histórico por paciente.
5. Simulação por IA a partir do planejamento.
