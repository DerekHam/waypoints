export const siteConfig = {
  domain: 'waypoints.derekhan.link',
  url: 'https://waypoints.derekhan.link',
  repo: 'DerekHam/waypoints',
  repoUrl: 'https://github.com/DerekHam/waypoints',
  owner: 'Derek',
  title: {
    en: 'Waypoints',
    zh: '途迹',
  },
  subtitle: {
    en: 'An atlas of places I mean to see',
    zh: '一张想去之地的地图',
  },
  description: {
    en: 'A bilingual antique-globe atlas of places worth going to.',
    zh: '一张双语的古地图式旅行愿望清单。',
  },
  dataFile: 'data/atlas.json',
  /**
   * Cloudflare Worker relay. Set VITE_API_BASE at build time, or paste the
   * deployed Worker URL here. Leave empty to use read-only + local preview.
   */
  apiBase: (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '',
}

export type SiteConfig = typeof siteConfig
