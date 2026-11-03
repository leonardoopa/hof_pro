# HOF PRO: foto clínica, pontos de aplicação e antes/depois

Estudo técnico-clínico de 03/11/2026 para decidir como implementar (A) a captura da foto do paciente, (B) os pontos de aplicação e (C) o antes/depois com o "novo rosto".

Convenções deste documento:

- **[F]** fato com fonte.
- **[I]** inferência ou proposta de quem escreveu o estudo.
- "Não verificado" significa que nenhuma fonte foi aberta. Nesses casos o item deve ser validado pela profissional antes de entrar no sistema.
- O código analisado é o da branch `staging` (`origin/staging`), que estava cerca de 103 arquivos e 5.900 linhas à frente da `main`.

> **Aviso clínico.** As doses abaixo são faixas de literatura, não prescrição. A decisão é do profissional. Unidades de toxina não são intercambiáveis entre marcas (Botox, Dysport/Azzalure e Bocouture têm potências diferentes), então o sistema deve guardar a marca junto da dose.

## Limitações da pesquisa

- O PDF do protocolo fotográfico da AHOF (Saleme Junior et al., *Aesthetic Orofacial Science* 2021, 2(1):72-82) não foi lido, porque a máquina não tem `pdftotext`. Só o resumo da página foi consultado. Para extrair as especificações exatas, instale `poppler` (`brew install poppler`) ou envie o PDF em texto.
- Não apareceram consensos de dose por ponto de fabricantes (Galderma, Merz, Allergan) nem de sociedades brasileiras (SBD, SBCP).
- O DOI de Ettorre et al. 2006 foi inferido pela citação. Valide o link.
- A Resolução CFO 196/2019 foi lida pelo resumo da busca, não pelo texto integral.

---

## 0. Estado atual do código (`staging`)

### Pronto

- **Regiões e tratamentos:** `frontend/src/planning/regions.js` tem 8 regiões (testa, têmporas, olheiras, malar, nasolabial, mandíbula, mento, boca) e 5 tratamentos (botox em U; preenchimento, bioestimulador, skinbooster e outro em ml).
- **Pontos do plano:** `PlanPoint` (`backend/apps/clinical/models.py`) guarda `region`, `treatment`, `x`, `y` (0..1), `amount`, `unit`, `technique`, `depth` e `lot`. A lateralidade (D/E/C) é calculada no frontend por `assignSides`.
- **Template de pontos:** `template.js` gera os pontos sugeridos a partir de landmarks do MediaPipe Face Mesh (índices 33, 133, 263, 362, 70, 105, 300, 334, 127, 356, 129, 358, 61, 291, 58, 288, 172, 397 etc.). Existe um `fallbackTemplate` para quando o rosto não é detectado.
- **Detecção de rosto:** `faceLandmarks.js` roda o Face Landmarker no navegador (WASM). A foto não sai do aparelho.
- **Captura:** `CameraCapture.jsx` usa `getUserMedia` (1920×1440 ideal) e uma `PoseGuide` em SVG estático.
- **Alinhamento:** `evolution/alignment.js` alinha por similaridade (escala, rotação, translação) pelo centro dos olhos. `CompareCanvas.jsx` faz o antes/depois com divisor.
- **Simulação (`simulate.js`):** toxina aplica desfoque local em disco. Volume aplica warp radial por ponto (fator `0.17·√ml + 0.06`, limitado a 0,4, ou 0,5 nos lábios). Lábios usam elipse e leve realce de cor.
- **Upload no backend:** `PatientPhoto.Kind` tem frontal, perfil direito, perfil esquerdo e outra. O upload valida o formato, corrige a rotação EXIF, limita o lado a 2000 px e regrava em JPEG, o que remove EXIF/GPS. A foto só sai por rota autenticada.
- **Outros módulos:** consentimento versionado com assinatura e hash (inclui termo `uso_imagem` separado), estoque por lote, auditoria, anonimização e relatórios.
- **README:** já admite que a simulação é "um efeito de imagem, não um modelo clínico nem generativo".

### Lacunas

- Só existe a pose frontal. Não há 45°, perfil, sorriso, repouso nem vistas inferior/superior.
- A captura não checa pose, luz, desfoque nem distância. A `PoseGuide` é fixa e `Kind` não tem poses clínicas.
- Não há catálogo de pontos com nome anatômico, camada padrão, dose de referência, zona de risco ou contraindicação. A região "boca" é um saco único.
- Faltam regiões e músculos: glabela, periorbital, nasal, DAO, platisma, masseter, gengival, mento muscular, nariz, marionete, pré-jowl, zigomático e submalar.
- Não há mapa de risco vascular visível ao usuário.
- A simulação não usa malha triangulada nem deformação consistente com a anatomia, e só vale para a pose frontal.
- Não há termo de ciência específico da simulação, marca d'água "ilustrativo" nem exportação (PDF ou link).
- A foto "antes" não tem metadados de pose, distância nem calibração de escala em mm.

---

## A. Fotografia clínica

### Fatos com fonte

- **Protocolo de Prantl, Brandl e Ceballos (2017)** [F], [PMC5585426](https://pmc.ncbi.nlm.nih.gov/articles/PMC5585426):
  - 3 a 5 ângulos de face.
  - Distância câmera-sujeito marcada e fixa, com zoom só para enquadrar.
  - Câmera na altura da região e na horizontal.
  - Luz: duas fontes difusas a cerca de 45° e levemente acima do paciente, 5.500 K, sem flash e sem luz do dia.
  - ISO 200, mesma câmera e mesmas configurações ao longo do acompanhamento.
  - Fundo cinza constante ou azul-escuro.
  - Sem maquiagem nem joias, cabelo preso, expressão neutra.
  - Os autores propõem uma "Network line" no lugar do plano de Frankfurt, porque Frankfurt eleva o rosto e esconde a gordura submentoniana.
- **Padronização:** os padrões de 1998 de DiBernardo et al. são citados por Prantl. Rhee (2017, [DOI 10.1007/s00266-017-0788-0](https://doi.org/10.1007/s00266-017-0788-0)) propôs um método simples de padronização internacional, e a própria autora reconheceu em 2018 que é cedo para adotá-lo como padrão [F].
- **Conjunto básico europeu:** [Ettorre et al. 2006, J Craniomaxillofac Surg 34:65-73](https://doi.org/10.1016/j.jcms.2005.11.001): frontal, oblíqua, oblíqua submentoniana e lateral. Distâncias e valores exatos: não verificado.
- **Plano de Frankfurt:** linha entre a borda orbital inferior e a incisura supratragal, paralela ao horizonte. Há debate: em pé o plano fica cerca de 13° acima da horizontal, e sentado, 5° (homens) a 8° (mulheres). Não há padrão internacional único [F].

### Proposta para o HOF PRO [I]

**Poses do assistente de captura**

- Frontal em repouso.
- Frontal sorrindo.
- 45° direito e esquerdo.
- Perfil direito e esquerdo.
- Vista inferior (submentoniana) e superior, opcionais.
- Poses dinâmicas: frontal franzindo a testa (glabela e frontal), sorriso forçado (periocular, gengival) e lábios em bico (mento e perioral). Essas poses são prática comum em HOF, mas as fontes lidas não as listam. **Não verificado, validar com a profissional.**

**Frankfurt ou Network line:** oferecer Frankfurt como padrão e deixar a escolha configurável pela profissional. Para submento e linha mandibular, verificar o ângulo da cabeça por landmarks.

**Checagens automáticas no navegador, a cada frame do vídeo**

| Critério | Como medir |
|---|---|
| Rotação (roll) | Ângulo entre os olhos, índices 33 e 263 (limiar sugerido ±2°) |
| Guinada (yaw) | Assimetria entre as distâncias nariz-contornos (índices 1, 234 e 454) |
| Inclinação (pitch) | Razão entre as distâncias glabela-nariz e nariz-mento |
| Tamanho do rosto no quadro | Largura entre os índices 234 e 454, em % da imagem, para fixar a distância |
| Centralização | Nariz (índice 1) dentro da grade central |
| Luz | Histograma de luminância em duas faixas (esquerda e direita do rosto) para detectar sombra ou desequilíbrio |
| Nitidez | Variância do Laplaciano dentro da caixa do rosto |
| Expressão | Blendshapes do Face Landmarker (mouthSmile, browDown etc.) para confirmar repouso ou sorriso |

Os limiares são sugestões e precisam de calibração em campo.

**Guia de captura:** a `PoseGuide` deixa de ser SVG fixo e passa a ser uma silhueta por pose, com cores verde e vermelha por critério.

**Escala em mm:** a distância interpupilar média (~63 mm em adultos) é só estimativa. Para medida real, usar um marcador de referência (régua ou cartão) em uma foto e registrar `mm_per_px`. É opcional na fase 1.

**Resolução:** o backend limita o lado a 2000 px (`MAX_SIDE = 2000`). Basta para análise. Para arquivo clínico, considerar manter o original em alta resolução e uma derivada para tela (hoje o original é descartado).

### Armazenamento seguro e LGPD

O desenho atual já é razoável: foto em `backend/media`, sem rota pública, regravada em JPEG. Melhorias propostas [I]:

- Criptografia em repouso.
- URL assinada com expiração, no lugar de token fixo.
- Retenção e prazo de guarda do prontuário (consultar a profissional e o CFO).
- Log de acesso a cada foto. A auditoria já existe e deve ser estendida às fotos.
- Base legal: o consentimento para dado sensível precisa ser específico, destacado e revogável (LGPD art. 11, I; [resumo de Confidata](https://confidata.com.br/blog/dados-sensiveis-lgpd-bases-legais-cuidados)). Dado de saúde pode ter base legal própria (tutela da saúde, art. 11, II, "f"), mas o enquadramento não foi verificado. Validar com assessoria jurídica.
- A ANPD abriu tomada de subsídios sobre dados biométricos ([gov.br](https://www.gov.br/participamaisbrasil/ts-dados-biometricos)). Foto comum não é automaticamente biométrica, mas passa a ser se for processada para identificação. O HOF PRO usa landmarks só para mapear pontos, não para identificar a pessoa [F/I].
- Manter o termo `uso_imagem` separado do termo do procedimento e criar um termo específico de simulação (seção C).

### Publicidade e situação jurídica

- A Resolução CFO 196/2019 autoriza divulgar autorretratos e imagens de diagnóstico e resultado final, com autorização prévia por TCLE. A regra anterior (Res. 118/2012) tratava o antes e depois como infração. Imagens de tecido biológico e do procedimento continuam proibidas [F]. Fontes: [texto da Res. 196](https://website.cfo.org.br/wp-content/uploads/2019/01/Resolu%c3%a7%c3%a3o-CFO-196-2019.pdf) e [Migalhas](https://www.migalhas.com.br/coluna/migalhas-de-responsabilidade-civil/377358/antes-e-depois-x-direito-a-imagem-divulgacao-de-fotos-de-pacientes). Números de artigos: não verificado.
- Em 19/08/2026 o TRF-1 anulou a **Resolução CFO 198/2019**, que reconhecia a HOF como especialidade odontológica. Ainda cabe recurso e o CFO diz que as atribuições não mudaram [F]. Fontes: [Ohoje](https://ohoje.com/2026/08/22/justica-derruba-norma-que-permitia-harmonizacao-orofacial-por-dentistas/) e [JB](https://www.jb.com.br/colunistas/voce-tem-direito/2026/10/amp/1061302-harmonizacao-orofacial-a-resolucao-caiu-a-duvida-ficou.html). As fontes divergem em detalhes.
- Consequência: o sistema **não deve exibir "especialista em HOF" por padrão**. Isso afeta texto de marketing, termos de consentimento e o seguro de responsabilidade civil da cliente. A profissional deve validar com o CRO e um advogado.

---

## B. Pontos de aplicação por região e produto

### B1. Toxina botulínica

| Ponto | Dose referida | Fonte | Observação |
|---|---|---|---|
| Glabela | 5 pontos × 10 sU | Consenso Speywood 2010, [PubMed 20337830](https://pubmed.ncbi.nlm.nih.gov/20337830/) | Material de curso cita 20-30 U (mulheres) e 30-40 U (homens) em Botox ([WVU](https://medicine.hsc.wvu.edu/media/2063/cosmeticbotox.pdf)); fonte secundária |
| Frontal | 4-6 pontos × 5-10 sU | mesmo consenso | Bocouture (Merz): 10-20 U em 5 pontos, pelo resumo da busca |
| Periorbital (pés de galinha) | 3 pontos/lado × 5-10 sU | mesmo consenso | Bocouture: 4 U × 3 pontos/lado = 12 U/lado |
| Masseter | 15-40 U/lado em relatos; estudo com 15, 25 e 35 U/lado mostrou eficácia em 35 U | resumos de busca | Revisão de 2017 diz que não há consenso. Fonte primária não aberta: **não verificado** |
| Platisma (bandas) | 10-30 U (mulheres) e 10-40 U (homens) como dose inicial, ~10 U ao longo da borda mandibular (Nefertiti) | revisão [PubMed 28654586](https://pubmed.ncbi.nlm.nih.gov/28654586/) | A série Nefertiti original usou média de 124,9 U de abobotulinumtoxinA (outra marca/unidade) |
| Gengival (LLSAN) | 2 U/lado para exposição de 4-5 mm; 2,5 U/lado em 2 pontos se > 8,5 mm | [Quintessence 2019](https://admin.quintessence-publishing.com/anz/de/article/854439/international-journal-of-periodontics-restorative-dentistry/2019/04/ideal-dose-and-injection-site-for-gummy-smile-treatment-with-botulinum-toxin-a-a-systematic-review-and-introduction-of-a-case-study) | Via resumo; confirmar na fonte |
| Mentual e DAO | 4-10 U de onabotulinumtoxinA (4-18 U de abobotulinum) em 2-6 pontos; menor dose eficaz no terço inferior | [mdedge](https://mdedge.com/content/botulinum-toxin-less-more-lower-face) | Fonte indireta |
| Nasal (bunny lines) | **Não verificado, validar com a profissional** | só fonte de clínica | Não usar |
| DAO isolado | **Não verificado** | — | — |

- **Camada:** intramuscular na maior parte; subdérmica na periorbital e em pontos superficiais [I]. As fontes abertas não detalham camada por ponto. Validar.
- **Contraindicações gerais:** gestação e lactação, doença neuromuscular (miastenia, ELA), infecção no local, hipersensibilidade [I]. Nenhuma bula foi aberta nesta rodada. A profissional deve validar com a bula do produto que usa.
- **Zonas de risco:** ptose palpebral (glabela e frontal, perto do septo orbital), assimetria de sorriso (DAO, risório, zigomático), disfagia ou fraqueza cervical (platisma) [I]. Sem fonte aberta, validar.

### B2. Ácido hialurônico

Fonte principal: [van Loghem et al., Clin Cosmet Investig Dermatol 2021;14:1175-1199](https://www.dovepress.com/consensus-on-the-use-of-hyaluronic-acid-fillers-from-the-cohesive-poly-peer-reviewed-fulltext-article-CCID). É um consenso para uma plataforma específica de AH (CPM-HA, linha Belotero), então as doses **não generalizam** para todos os AH [F]. Complementos: [PMC12460893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12460893/) (olheira) e [PMC8127324](https://pmc.ncbi.nlm.nih.gov/articles/PMC8127324/) (sulco lacrimal).

| Região | Camada | Técnica | Volume referido |
|---|---|---|---|
| Testa | supraperiosteal | linhas retrógradas, cânula 22G | 0,025-0,04 ml por linha |
| Têmpora posterior | subdérmica (lifting) ou interfascial (só volume) | cânula 22-25G; nunca agulha no compartimento temporal inferior | 0,5-1,0 ml/lado; mais em casos graves |
| Malar lateral | supraperiosteal | agulha 27G ou cânula 22-25G | 0,2 ml por ponto (2 pontos) |
| Malar medial (coxim profundo) | gordura profunda da bochecha | leque com cânula 22-25G | 1,0-1,5 ml/lado |
| Sulco lacrimal / olheira | supraperiosteal, junto do osso | cânula ≥ 25G | 0,1-0,5 ml/lado; subcorrigir 10-20% |
| Marionete (superficial) | intradérmica | agulha, blanching | até 0,5 ml |
| Marionete (grave) | subdérmica, do sulco pré-jowl para cima | — | não informado |
| Comissura oral caída | bolus pequenos nas bordas labiais | — | 0,1 ml por bolus |
| Lábios (contorno) | derme superficial | cânula 25G ou agulha 30G | cânula 0,1-0,2 ml; agulha < 0,05 ml/linha |
| Lábios (volume) | subdérmica | agulha 30G ou cânula 25G | até 0,5-1,0 ml em linhas |
| Mento (projeção) | epiperiosteal | cânula 22-25G ou agulha 27-30G | 1-2 ml no total |
| Mandíbula (linha) | subdérmica + bolus supraperiosteal no ângulo | agulha 27G; cânula 27G rígida no sulco pré-jowl | não informado; "não injetar na gordura do jowl" |

- **Não cobertos pelo consenso (não verificado, validar com a profissional):** sulco nasolabial, zigomático e submalar isolados, nariz (rinomodelação) e pré-jowl como ponto separado.
- **Zonas de risco vascular** [F]:
  - Glabela, nariz e testa: risco "muito alto". Têmpora, nasolabial, periocular e malar medial: "alto" (slide de protocolo com ultrassom da [Clarius](https://clarius.com/wp-content/uploads/2022/11/2022.11.10-Facial-Filler-Danger-Zones-Ultrasound-Protocol-for-Safe-Injections-in-the-Chin-Forehead-and-Marionette-Lines.pdf); material comercial, usar só como orientação).
  - A artéria supratroclear sai da órbita a cerca de 2 cm da linha média e pode estar na linha da glabela ou na camada subdérmica. Ela, a supraorbital, a nasal dorsal e a angular formam uma rede que pode levar êmbolo retrógrado à artéria oftálmica ([parjournal](https://parjournal.net/article/view/3605), [Thieme](https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0043-1770078?lang=en)).
  - A artéria angular cruza o sulco nasojugal, na área do sulco lacrimal.
  - A artéria facial passa cerca de 1 cm lateral à comissura oral. Cuidado perto da linha média dos lábios, onde as artérias labiais são mais superficiais (van Loghem 2021).
  - Evitar o forame supraorbital, a glândula parótida, o ducto de Stenson e a veia facial na região pré-auricular e sobre o masseter (van Loghem 2021).
  - Boas práticas: baixa pressão no êmbolo, pequenas alíquotas, agulha em movimento, hialuronidase disponível, cânula ≥ 25G pode reduzir o risco intravascular. A aspiração é controversa.
- **Contraindicações:** gestação, infecção ou inflamação ativa no local, hipersensibilidade a AH ou lidocaína, doenças autoimunes ativas [I]. Validar.

### B3. Bioestimuladores, skinbooster e fios

- **Hidroxiapatita de cálcio (Radiesse):** consenso de 10 especialistas sobre uso diluído (1:1) e hiperdiluído (1:2 ou mais), [PMC6467620](https://pmc.ncbi.nlm.nih.gov/articles/PMC6467620). No pescoço: cânula e diluição de 1:2 a 1:4, para reduzir o risco de colocar muito superficial. Evento adverso mais comum: eritema e nódulo não inflamatório. Oclusão vascular é rara [F].
- **PLLA (Sculptra):** revisão multicêntrica de prontuários com reconstituição final de 8-10 ml (incluindo anestésico) e perfil de risco favorável, pelo resumo. Volume por sessão e região: **não verificado, validar com a profissional**.
- **Skinbooster e fios:** não pesquisados com fonte clínica. O sistema deve oferecer campos livres (produto, volume, técnica), sem dose de referência até a validação.

### B4. Catálogo de pontos: modelo de dados proposto [I]

O catálogo guarda dados clínicos versionados e imutáveis (como os termos de consentimento já fazem), sem lógica no código:

```json
{
  "catalog_version": 1,
  "points": [
    {
      "id": "temporal_posterior",
      "label": "Têmpora posterior",
      "region": "temporas",
      "bilateral": true,
      "treatments": [
        {
          "treatment": "preenchimento",
          "default_layer": "interfascial",
          "layers_allowed": ["subdermico", "interfascial"],
          "techniques": ["canula"],
          "dose": {"min": 0.5, "max": 1.0, "unit": "ml", "per": "side"},
          "source": {
            "url": "https://www.dovepress.com/consensus-on-the-use-of-hyaluronic-acid-fillers-from-the-cohesive-poly-peer-reviewed-fulltext-article-CCID",
            "validated_by_professional": false
          }
        }
      ],
      "anchor": {"landmarks": [21, 127], "mix": 0.55, "dx_face_width": 0.05, "dy_face_height": 0.0},
      "risk": {"level": "high", "vessels": ["temporal superficial", "zigomático-temporal"], "notes": "Evitar agulha no compartimento temporal inferior"},
      "contraindications": []
    }
  ]
}
```

- `anchor.landmarks` usa índices do Face Mesh. Para a testa, o `template.js` atual já faz isso de forma imperativa (índice, mistura entre dois pontos, deslocamento proporcional à largura ou altura do rosto). O catálogo substitui esse código por dados.
- **Landmarks úteis** (de `template.js` e `alignment.js`): 10 (topo da testa), 152 (mento), 234 e 454 (contorno lateral), 33/133 e 263/362 (olhos), 70/105 e 300/334 (sobrancelha), 129 e 358 (asa do nariz), 61 e 291 (comissuras), 0/13/14/17 (lábios), 58 e 288 (ângulo mandibular). Não há lista pública verificável de índices para glabela, nasal, DAO e sulco lacrimal. Montar com a imagem UV do repositório do MediaPipe (`canonical_face_model_uv_visualization.png`) e validar visualmente.
- **Pontos a acrescentar (nome anatômico, sem dose até validar):**
  - toxina: glabela (prócero, corrugadores), frontal, periorbital, nasal, LLSAN, DAO, mentual, platisma, masseter;
  - AH: zigomático, submalar, pré-jowl, marionete, arco do cupido e vermelhão.

  Cada um com `risk` e `source` próprios.

---

## C. Antes/depois e "novo rosto"

| Opção | Como funciona | Prós | Contras | Esforço |
|---|---|---|---|---|
| **C1. Warp por malha (MLS ou thin-plate spline) ancorado em landmarks** | Move landmarks próximos ao ponto para fora, proporcional ao volume, e reamostra a imagem por triângulos da malha do Face Mesh | Roda no navegador, rápido, sem dependência externa, preserva a textura real, determinístico e auditável. Evolui o `simulate.js` | Só funciona bem na pose frontal ou próxima dela. Sem profundidade. Pode "esticar" demais | M |
| **C2. Mapa de calor do plano** | Gaussianas por ponto, cor por tratamento, intensidade por dose | Não mente sobre o resultado, mostra onde e quanto | Não mostra "como ficaria" | P |
| **C3. Suavização para toxina** (já existe) | Desfoque local (`boxBlur`) | Já pronto | Efeito "filtro de beleza", remove textura de forma indistinta e pode induzir expectativa irreal. Trocar por redução de contraste das rugas em banda de frequência | P |
| **C4. Perfil e 3/4 com malha 3D** | Usa a coordenada z dos landmarks para deslocar na superfície e projetar | Melhora a simulação em 45° | Qualidade ainda limitada, precisa testar | G |
| **C5. Difusão ou inpainting local** | Pede a um modelo que "preencha" a região | Resultado visualmente convincente | Pode ser irreal e gerar expectativa errada. Envia foto de paciente a terceiros (LGPD, consentimento). Custo. Difícil provar fidelidade ao plano | G |
| **C6. Serviço comercial** (Crisalix, Perfect Corp, ModiFace) | 3D ou AR de terceiros | Pronto | Preço não público ([Crisalix](https://www.crisalix.com/en/prices): sob consulta). Termos de API do Perfect Corp não encontrados. Dependência e envio de foto a terceiros. Foco em cirurgia e pele, não em dose de AH | G |
| **C7. 3D a partir de foto 2D** | Reconstrói malha facial 3D | Permite girar | Precisão limitada e ruído. Exige validação clínica. Fora do escopo inicial | G |

### Evidência sobre simulação por IA

- Um estudo de imagens de contorno corporal geradas por IA concluiu que a maioria era anatomicamente irreal ([eplasty](https://www.hmpgloballearningnetwork.com/site/eplasty/original-research/ai-cosmetic-surgery-new-look-virtual-abdominoplasty-and-buttock)).
- Revisões narrativas apontam expectativa irreal, viés e privacidade como riscos centrais ([PMC11803538](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11803538/)).
- Não foi encontrado estudo comparando a simulação com o resultado real.
- Alguns autores indicam que simulações podem reduzir arrependimento e ajudar no planejamento. A literatura é de revisões, não de ensaios.

### Honestidade da simulação [I]

- Marca d'água fixa: "Simulação ilustrativa, não garante resultado".
- Limite máximo de deslocamento por região (já existe `Math.min(..., 0.4)`), configurável pela profissional.
- Mostrar sempre a foto real ao lado, com o slider.
- Não permitir exportar a simulação para redes sociais, só a foto real do resultado final.
- Registrar no prontuário a versão do algoritmo e que a simulação foi mostrada.
- Termo de ciência: o paciente declara que entendeu que é ilustrativo. Criar um `Term` do tipo `simulacao` (a estrutura de `Term`/`Signature` já suporta isso).
- A simulação não é "resultado final" e **não deve** ser usada em publicidade. Tratá-la como material de consulta interna. Validar com a profissional e o CRO.

### O que o paciente vê [I]

- Fase 1: tela do tablet com slider e rótulo "simulação ilustrativa".
- Fase 2: PDF do plano com marca d'água.
- Fase 3: link com expiração e senha, só depois de resolver LGPD e retenção.

### Recomendação por fase

- **Fase 1 (M), viável na stack atual:**
  - evoluir `simulate.js` para um warp de malha com a triangulação do Face Mesh, só na pose frontal;
  - trocar o desfoque da toxina por redução de contraste das linhas;
  - mapa de calor do plano;
  - marca d'água;
  - termo `simulacao` bloqueante;
  - catálogo de pontos em JSON, sem doses não validadas;
  - reaproveitar `CompareCanvas` e o alinhamento por olhos.
- **Fase 2 (M a G):**
  - captura guiada com checagem por landmarks (seção A);
  - várias poses (frontal, 45°, perfil) com simulação a partir do z dos landmarks;
  - PDF do plano com marca d'água;
  - doses de referência validadas pela profissional.
- **Fase 3 (G):**
  - avaliar C5, C6 e C7 só depois de parecer jurídico sobre LGPD e publicidade, e de a profissional comparar simulação com resultado real em casos reais;
  - não implementar difusão que envie foto a terceiros sem consentimento específico.

---

## D. Plano de implementação [I]

### Etapa 1: catálogo e modelo (M)

- Criar `backend/apps/clinical/catalog/points.v1.json` e um comando `load_catalog` que o valida (schema Pydantic).
- Ampliar `Region` com as regiões novas (migração `0006`), mantendo as 8 atuais compatíveis.
- Acrescentar a `PlanPoint` os campos `point_id` (id do catálogo, opcional), `product_brand` e `catalog_version`.
- Endpoint `GET /api/catalog/points` em `backend/api/routers/catalog.py` (novo), com lista filtrada por região e tratamento.
- Frontend: `frontend/src/planning/catalog.js` substitui o `SIDES` e o corpo de `buildTemplate` por interpretação de `anchor`.
- **Aceite:**
  - o template atual é reproduzido pelo catálogo (mesmo resultado dentro de 1 px nas fotos de teste);
  - `symmetry.check.mjs` continua passando;
  - testes pytest novos para o schema e o carregamento.

### Etapa 2: poses e captura (M)

- Ampliar `PatientPhoto.Kind` (migração em `apps/patients`) com oblíqua 45° D/E, sorriso, repouso, inferior e superior, mantendo os valores atuais.
- Criar `frontend/src/capture/poseChecks.js` (roll, yaw, pitch, tamanho do rosto, luz, nitidez) e `frontend/src/capture/CaptureWizard.jsx`, usando `faceLandmarks.js` em modo `VIDEO`. Hoje o landmarker usa `runningMode: 'IMAGE'`, então é preciso uma segunda instância ou alternar o modo.
- Atualizar `CameraCapture.jsx` e `PoseGuide.jsx` para uma silhueta por pose.
- **Aceite:**
  - o botão "Capturar" só habilita com todos os critérios verdes, ou com justificativa registrada;
  - teste unitário dos cálculos de pose com landmarks sintéticos.

### Etapa 3: simulação e apresentação (M a G)

- Novo `frontend/src/planning/meshWarp.js` (triangulação do Face Mesh, warp afim por triângulo, MLS como alternativa) e ajuste de `simulate.js` para usá-lo.
- `HeatmapLayer` em `FaceStage.jsx` e modo "ver plano" com intensidade por dose.
- Marca d'água na saída do canvas e `Term` `simulacao` (migração em `apps/consent`) com assinatura obrigatória antes de mostrar ao paciente.
- Exportação do plano em PDF, estendendo `backend/api/printing.py` (já existe).
- **Aceite:**
  - nenhum deslocamento passa do limite configurado;
  - a simulação nunca é gravada como foto clínica (fica só no navegador, ou como derivada marcada);
  - o termo é bloqueante.

### Etapa 4: validação clínica e LGPD (P a M)

- Revisão do catálogo pela profissional, campo `validated_by_professional` por ponto, e exibição de "dose de referência" apenas quando validado.
- Estender a auditoria às fotos e à geração de simulação. Definir política de retenção e criptografia em repouso.
- **Aceite:**
  - nenhuma dose exibida sem fonte e validação;
  - revisão jurídica do texto dos termos, com atenção ao quadro CFO/TRF-1 descrito na seção A.

### Testes sugeridos

- pytest para schema e carga do catálogo.
- Testes de rota: limites, permissões, termo exigido.
- `symmetry.check.mjs` e novos `.check.mjs` para pose, warp (deslocamento máximo) e alinhamento.
- Teste de regressão do template contra um conjunto de rostos de referência.

---

## Pendências para a profissional validar

1. Doses, camadas e zonas de risco marcadas "não verificado": nasal, DAO, nasolabial, zigomático, submalar, nariz, bioestimuladores por região, skinbooster, fios e cuidados de cada toxina.
2. Poses e distâncias exatas do protocolo AHOF (PDF não lido).
3. Texto dos termos (simulação e uso de imagem) e linguagem de marketing, à luz da decisão do TRF-1 e da Res. CFO 196/2019.
4. Preferência entre Frankfurt e Network line como referência de pose.

## Fontes principais

- Fotografia: [Prantl 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5585426), [Rhee 2017](https://doi.org/10.1007/s00266-017-0788-0), [AHOF 2021](https://ahof.emnuvens.com.br/ahof/article/view/45).
- Ácido hialurônico: [van Loghem 2021](https://www.dovepress.com/consensus-on-the-use-of-hyaluronic-acid-fillers-from-the-cohesive-poly-peer-reviewed-fulltext-article-CCID).
- Toxina: [consenso Speywood](https://pubmed.ncbi.nlm.nih.gov/20337830/), [platisma](https://pubmed.ncbi.nlm.nih.gov/28654586/).
- Hidroxiapatita de cálcio: [PMC6467620](https://pmc.ncbi.nlm.nih.gov/articles/PMC6467620).
- IA e ética: [PMC11803538](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11803538/).
- Regulação: [Res. CFO 196/2019](https://website.cfo.org.br/wp-content/uploads/2019/01/Resolu%c3%a7%c3%a3o-CFO-196-2019.pdf), [TRF-1 (Ohoje)](https://ohoje.com/2026/08/22/justica-derruba-norma-que-permitia-harmonizacao-orofacial-por-dentistas/), [JB](https://www.jb.com.br/colunistas/voce-tem-direito/2026/10/amp/1061302-harmonizacao-orofacial-a-resolucao-caiu-a-duvida-ficou.html).

## Arquivos do projeto citados (`origin/staging`)

`frontend/src/planning/{regions,simulate,template,faceLandmarks,technique}.js`, `frontend/src/planning/CameraCapture.jsx`, `frontend/src/evolution/{PoseGuide.jsx,alignment.js,CompareCanvas.jsx}`, `backend/apps/clinical/models.py`, `backend/apps/patients/models.py`, `backend/api/routers/{plans,patients}.py`, `backend/apps/consent/models.py`, `README.md`.
