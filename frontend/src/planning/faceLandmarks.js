import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

// A inferência roda no navegador (WASM): a foto do paciente não é enviada a nenhum serviço de IA.
// Só o runtime e o modelo são baixados. Para uso offline/produção, hospede os dois e troque as URLs.
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let landmarkerPromise = null

function createLandmarker() {
  return FilesetResolver.forVisionTasks(WASM_URL).then(async (fileset) => {
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
    })
    try {
      return await FaceLandmarker.createFromOptions(fileset, options('GPU'))
    } catch {
      return FaceLandmarker.createFromOptions(fileset, options('CPU'))
    }
  })
}

/** Retorna os 478 pontos normalizados (0..1) do rosto, ou null se nenhum rosto for detectado. */
export async function detectFace(imageElement) {
  landmarkerPromise ??= createLandmarker().catch((err) => {
    landmarkerPromise = null // permite tentar de novo depois de uma falha de rede
    throw err
  })
  const landmarker = await landmarkerPromise
  return landmarker.detect(imageElement).faceLandmarks?.[0] ?? null
}
