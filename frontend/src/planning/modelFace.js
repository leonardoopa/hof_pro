// Rosto de referência: um retrato frontal de estúdio (frontend/public/reference-face.jpg), para planejar sem a foto do paciente.
// O arquivo foi preparado a partir da imagem de referência do projeto: girado, recortado em cabeça e ombros, com as
// linhas-guia e os pontos do mockup retirados.
//
// MODEL_TEMPLATE guarda as posições sugeridas já calculadas para essa imagem: são as mesmas que `buildTemplate`
// (template.js) gera a partir dos 478 pontos do MediaPipe, gravadas uma vez para o rosto de referência abrir igual em
// qualquer máquina, com ou sem rede. Trocou a imagem? Rode a detecção de novo e grave a lista nova.
const W = 756
const H = 870

// [região, lado, ponto, x, y], com x e y normalizados (0..1) sobre a imagem.
const ROWS = [
  ['testa', 'C', 'frontal_lateral_d', 0.2912, 0.3652],
  ['testa', 'C', 'frontal_medial_d', 0.3936, 0.3584],
  ['testa', 'C', 'frontal_central', 0.4959, 0.3515],
  ['testa', 'C', 'frontal_medial_e', 0.5982, 0.3584],
  ['testa', 'C', 'frontal_lateral_e', 0.7006, 0.3652],
  ['glabela', 'C', 'procero', 0.4966, 0.455],
  ['glabela', 'C', 'corrugador_medial_d', 0.4328, 0.4161],
  ['glabela', 'C', 'corrugador_medial_e', 0.5601, 0.4147],
  ['glabela', 'C', 'corrugador_lateral_d', 0.3742, 0.3977],
  ['glabela', 'C', 'corrugador_lateral_e', 0.6167, 0.3937],
  ['nariz', 'C', 'radix', 0.4973, 0.4837],
  ['nariz', 'C', 'dorso', 0.4981, 0.5569],
  ['nariz', 'C', 'ponta', 0.4984, 0.6188],
  ['nariz', 'C', 'columela', 0.4978, 0.6495],
  ['nariz', 'C', 'nasal_d', 0.4695, 0.5347],
  ['nariz', 'C', 'nasal_e', 0.525, 0.5344],
  ['temporas', 'D', 'tempora', 0.2596, 0.4598],
  ['periorbital', 'D', 'superior', 0.2866, 0.4683],
  ['periorbital', 'D', 'medio', 0.2787, 0.4968],
  ['periorbital', 'D', 'inferior', 0.2866, 0.5252],
  ['olheiras', 'D', 'sulco_lacrimal', 0.3859, 0.5317],
  ['zigomatico', 'D', 'arco', 0.2546, 0.551],
  ['zigomatico', 'D', 'eminencia', 0.2788, 0.5793],
  ['malar', 'D', 'lateral', 0.3257, 0.6006],
  ['malar', 'D', 'medial', 0.3606, 0.5796],
  ['submalar', 'D', 'depressao', 0.3084, 0.6552],
  ['nasolabial', 'D', 'sulco', 0.3858, 0.6803],
  ['gengival', 'D', 'llsan', 0.4173, 0.6184],
  ['marionete', 'D', 'superior', 0.3917, 0.7519],
  ['marionete', 'D', 'inferior', 0.3869, 0.7842],
  ['dao', 'D', 'dao', 0.3601, 0.7978],
  ['prejowl', 'D', 'sulco', 0.4102, 0.8513],
  ['mandibula', 'D', 'angulo', 0.2828, 0.7017],
  ['mandibula', 'D', 'corpo', 0.3027, 0.753],
  ['masseter', 'D', 'superior', 0.2837, 0.6444],
  ['masseter', 'D', 'inferior_anterior', 0.2962, 0.6841],
  ['masseter', 'D', 'inferior_posterior', 0.2725, 0.6841],
  ['platisma', 'D', 'borda_anterior', 0.3781, 0.8561],
  ['platisma', 'D', 'borda_posterior', 0.3189, 0.8062],
  ['platisma', 'D', 'banda', 0.4306, 0.9165],
  ['boca', 'C', 'arco_cupido_d', 0.4678, 0.6918],
  ['boca', 'C', 'comissura_d', 0.3956, 0.7265],
  ['boca', 'C', 'perioral_d', 0.4357, 0.6817],
  ['temporas', 'E', 'tempora', 0.7288, 0.4572],
  ['periorbital', 'E', 'superior', 0.7024, 0.4658],
  ['periorbital', 'E', 'medio', 0.7103, 0.4942],
  ['periorbital', 'E', 'inferior', 0.7024, 0.5226],
  ['olheiras', 'E', 'sulco_lacrimal', 0.6056, 0.53],
  ['zigomatico', 'E', 'arco', 0.7329, 0.5489],
  ['zigomatico', 'E', 'eminencia', 0.7118, 0.5771],
  ['malar', 'E', 'lateral', 0.6649, 0.5999],
  ['malar', 'E', 'medial', 0.631, 0.5786],
  ['submalar', 'E', 'depressao', 0.6822, 0.654],
  ['nasolabial', 'E', 'sulco', 0.6037, 0.6813],
  ['gengival', 'E', 'llsan', 0.5764, 0.6181],
  ['marionete', 'E', 'superior', 0.5953, 0.7534],
  ['marionete', 'E', 'inferior', 0.6011, 0.7849],
  ['dao', 'E', 'dao', 0.6283, 0.7974],
  ['prejowl', 'E', 'sulco', 0.5798, 0.8506],
  ['mandibula', 'E', 'angulo', 0.7049, 0.7003],
  ['mandibula', 'E', 'corpo', 0.6855, 0.7519],
  ['masseter', 'E', 'superior', 0.7037, 0.6429],
  ['masseter', 'E', 'inferior_anterior', 0.6913, 0.6827],
  ['masseter', 'E', 'inferior_posterior', 0.715, 0.6827],
  ['platisma', 'E', 'borda_anterior', 0.6114, 0.8555],
  ['platisma', 'E', 'borda_posterior', 0.6697, 0.8053],
  ['platisma', 'E', 'banda', 0.5589, 0.9165],
  ['boca', 'C', 'arco_cupido_e', 0.5243, 0.692],
  ['boca', 'C', 'comissura_e', 0.5907, 0.7285],
  ['boca', 'C', 'perioral_e', 0.5528, 0.6817],
  ['boca', 'C', 'vermelhao_superior', 0.4958, 0.7115],
  ['boca', 'C', 'vermelhao_inferior', 0.4946, 0.7539],
  ['mento', 'C', 'pogonio', 0.4946, 0.8377],
  ['mento', 'C', 'mentual_d', 0.4704, 0.8522],
  ['mento', 'C', 'mentual_e', 0.5197, 0.8524],
]

export const MODEL_TEMPLATE = ROWS.map(([region, side, point_key, x, y]) => ({ region, side, point_key, x, y }))

/** Substituto de uma imagem carregada: o palco só precisa de `src` e do tamanho natural. */
export const MODEL_FACE = {
  src: '/reference-face.jpg',
  naturalWidth: W,
  naturalHeight: H,
  isModel: true,
}
