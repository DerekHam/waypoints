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

  const canUpgrade =
    renderer.capabilities.maxTextureSize >= 8192 &&
    window.innerWidth >= 900 &&
    !window.matchMedia('(prefers-reduced-data: reduce)').matches

  if (!canUpgrade) return
  try {
    const high = configure(await loader.loadAsync(assetUrl('globe-8192.jpg')), renderer)
    callbacks.onHighResolution(high)
    callbacks.onProgress({ stage: 'ready', highResolution: true })
  } catch {
    // The 4K basemap is perfectly usable if the detail pass is unavailable.
  }
}
