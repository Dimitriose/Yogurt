import type { YogurtApi } from '@shared/api'

declare global {
  interface Window {
    yogurt: YogurtApi
  }
}

export {}
