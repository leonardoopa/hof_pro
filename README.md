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

## Estudo de mercado (nov/2026)

Dois levantamentos na web, feitos em 03/11/2026. Preços vêm de agregadores e dos sites dos fornecedores, então são ordem de grandeza. Nenhum produto concorrente foi visto logado, por isso as observações de design são inferência.

### Panorama

- **Brasil** (Clinicorp, Feegow, iClinic, Amplimed): gestão e prontuário genérico, ~R$ 100–400/mês. Planejamento facial é fraco.
- **Exterior** (Aesthetic Record, Pabau, AestheticsPro, Zenoti): face map e consentimento fortes, mas ignoram a regulação brasileira.
- **Canfield (VISIA, VECTRA)**: imagem 3D e simulação, dependente de hardware caro.
- **Lacuna**: não há software de HOF que una prontuário, planejamento e simulação validados a preço de SaaS. O Clinicorp se aproxima (lista HOF, tem módulo de IA com voz, simulação de sorriso e agentes de WhatsApp), mas é odonto-first.

### Front: mais bonito ou só mais completo?

- Não achei análise independente de design de nenhum concorrente. "O front deles é feio" não está provado.
- Referências de interface limpa em reviews: Jane App e Cliniko. Ganham por simplicidade e poucos toques, mas são de saúde geral, não de estética.
- Os líderes se diferenciam por completude, IA e integração. Um visual lavanda enxuto e premium é plausível como diferencial no Brasil (inferência).

### Funcionalidades novas no mercado

- Zenoti (abr/2026): 11 agentes de IA, incluindo Scribe (prontuário por voz), Photo Manager e Treatment Visualizer. Parte é add-on pago.
- Pabau: AI Scribe, portal do cliente e memberships. Formulários, SMS e app de marca própria são cobrados à parte.
- Simuladores de injetáveis (Galderma FACE, Crisalix, Perfect Corp): simulam, mas não ligam dose, prontuário nem consentimento.
- Apps de HOF no Brasil (HarmonixFace, SHOF): só mapeamento e proporções, sem prontuário.
- Tendência 2025–2026: IA no prontuário, agentes de WhatsApp e plataformas tudo-em-um. A literatura acadêmica pede validação clínica, o que sustenta manter a simulação como "ilustrativa".

### Reclamações de usuários (oportunidade)

- Suporte lento e complexidade pesam mais que falta de recurso.
- Clinicorp no Reclame Aqui (jan–jun/2026): 63 reclamações, 96,6% resolvidas, nota 7,2/10, resposta média de ~9 dias.
- Aesthetic Record: suporte quase inexistente. Pabau: recursos essenciais cobrados à parte.
- Brecha: onboarding simples, suporte rápido e preço sem add-ons.

### Backlog priorizado

Esforço: P (até ~2 semanas), M (~2–6 semanas), G (mais de 6 semanas).

| # | Item | Esforço | Como entra na stack |
|---|---|---|---|
| 1 | Face map de aplicação persistido (ponto, produto, U/ml, técnica, profundidade) | M | Já existem pontos no planejamento. Falta ligar produto, lote e técnica por ponto |
| 2 | Estoque com lote, validade, registro Anvisa e cartão de rastreabilidade | M | Modelos `Produto`, `Lote`, `Aplicacao`; baixa na aplicação; alerta de vencimento; PDF do cartão |
| 3 | Consentimento digital com assinatura | P–M | Termos versionados por procedimento; assinatura em canvas; PDF com hash SHA-256, IP e data/hora |
| 4 | Antes/depois com slider, pose padronizada e alinhamento por landmarks | M | MediaPipe e fotos já existem |
| 5 | Orientações pós-procedimento por tipo (PDF ou link) | P | Templates no Django |
| 6 | Design system lavanda (tokens, dark mode, estados vazios, microinterações) | P–M | Só front |
| 7 | Relatório de retorno e uso de U/ml por lote | M | Consultas SQL |
| 8 | Onboarding com modelos prontos e dados de demonstração | P | Seeds e telas |
| 9 | Escore de simetria e sugestão de pontos, como apoio ao profissional | M | Landmarks do MediaPipe |
| 10 | Lembretes de retorno por WhatsApp | G | WhatsApp Business API, com opt-in e custo |

Depois: financeiro e orçamentos, agenda com confirmação, prontuário por voz (Web Speech API é gratuita, mas irregular), portal do paciente em PWA, simulação visual por warp de malha.

Fora de escopo por ora: scan ou face map 3D, simulação generativa realista e multi-unidade.

Ordem sugerida: 2 e 3 primeiro (núcleo regulatório), depois 1 e 4, em paralelo com 6. LGPD (auditoria de acesso, perfis, criptografia, exclusão de dados do titular) corre desde o início.

### Riscos regulatórios

- **Quem pode fazer HOF está em disputa.** A Resolução CFO 198/2019 reconheceu a HOF como especialidade odontológica. Em 19/08/2026 o TRF-1 a anulou, e o CFO afirma que vai recorrer. Não embuta no sistema a premissa de que só uma categoria atende.
- **Rastreabilidade Anvisa.** Injetáveis exigem produto com registro e cartão de rastreabilidade com cópia no prontuário. Confirmar o número da RDC no portal da Anvisa antes de citá-lo no produto.
- **LGPD.** Foto facial e dados de saúde são dados sensíveis. Exigir consentimento separado para uso de imagem em marketing.
- **Prontuário eletrônico.** Lei 13.787/2018 e normas do CFM. Sem SBIS ou ICP-Brasil, o valor probatório é menor.
- **IA e simulação** são apoio ao profissional, nunca diagnóstico, e não podem ser divulgadas como promessa de resultado.
- **Publicidade.** Antes/depois em redes sociais tem restrições dos conselhos; separar prontuário de marketing.

### Lacunas do estudo

- Sem preço ou detalhe de Amplimed, Nextech, Consentz e Crystal Vision.
- Nada verificado sobre o front de Feegow, iClinic, Symplast e Nextech.
- Número da RDC de rastreabilidade não confirmado.
- Reviews do Play Store e do Trustpilot não foram lidos.
- A matriz de funcionalidades é leitura geral do mercado, não verificada produto a produto.

### Principais fontes

- Clinicorp: https://www.clinicorp.com/
- Reclame Aqui, Clinicorp: https://www.reclameaqui.com.br/empresa/clinicorp/
- Zenoti, agentes de IA: https://www.zenoti.com/fr/press/zenoti-expands-its-ai-workforce-purpose-built-ai-agents-for-every-medspa-workflow
- Pabau: https://pabau.com/industry/lp/aesthetic-clinic-software/
- Aesthetic Record (Capterra): https://www.capterra.com/p/162938/Aesthetic-Record/reviews
- Galderma FACE: https://practicaldermatology.com/news/meet-face-by-galderma/2461524/
- Canfield VISIA 3D: https://www.canfieldsci.com/in-the-news/stories/canfield-scientific-premieres-next-generation-visia-skin-analysis.-now-in-3d.
- Resolução CFO 198/2019: https://website.cfo.org.br/wp-content/uploads/2019/01/Resolu%C3%A7%C3%A3o-CFO-198-2019.pdf
- Decisão do TRF-1 (CFM): https://portal.cfm.org.br/noticias/tribunal-regional-federal-anula-resolucao-que-autorizava-dentistas-a-realizar-harmonizacao-orofacial
- Protocolo de fotos em HOF (AHOF): https://ahof.emnuvens.com.br/ahof/article/download/45/42
