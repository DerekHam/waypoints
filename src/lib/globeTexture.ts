import * as THREE from 'three'

export type TextureProgress = {
  stage: 'loading' | 'ready' | 'error'
  highResolution?: boolean
}

export type GlobeTextureCallbacks = {
  onBase: (texture: THREE.Texture) => void
  onHighResolution: (texture: THREE.Texture) => void
  onProgress: (progress: TextureProgress) => void
}

const basePath = import.meta.env.BASE_URL || './'

function assetUrl(file: string): string {
  return new URL(`${basePath.replace(/\/$/, '')}/globe/${file}`, document.baseURI).toString()
}

function configure(texture: THREE.Texture, renderer: THREE.WebGLRenderer): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/**
 * The basemap is pre-rendered from Natural Earth data by
 * `npm run globe:texture`. The 4K image is the fast first paint; desktop
 * devices with enough texture memory upgrade to the 8K version in the
 * background.
 */
export async function loadGlobeTexture(
  renderer: THREE.WebGLRenderer,
  callbacks: GlobeTextureCallbacks,
): Promise<void> {
  const loader = new THREE.TextureLoader()
  callbacks.onProgress({ stage: 'loading' })
  let base: THREE.Texture
  try {
    base = configure(await loader.loadAsync(assetUrl('globe-4096.jpg')), renderer)
  } catch {
    callbacks.onProgress({ stage: 'error' })
    throw new Error('Could not load the globe basemap')
  }
  callbacks.onBase(base)
  callbacks.onProgress({ stage: 'ready' })

  const maxTextureSize = renderer.capabilities.maxTextureSize
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const reducedData = window.matchMedia('(prefers-reduced-data: reduce)').matches
  if (reducedData || window.innerWidth < 900 || maxTextureSize < 8192) return

  const candidates: string[] = []
  if (maxTextureSize >= 12288 && deviceMemory >= 8 && window.innerWidth >= 1100) {
    candidates.push('globe-12288.jpg')
  }
  candidates.push('globe-8192.jpg')

  for (const candidate of candidates) {
    try {
      const high = configure(await loader.loadAsync(assetUrl(candidate)), renderer)
      callbacks.onHighResolution(high)
      callbacks.onProgress({ stage: 'ready', highResolution: true })
      return
    } catch {
      // Try the next detail level, then keep the 4K basemap.
    }
  }
}
