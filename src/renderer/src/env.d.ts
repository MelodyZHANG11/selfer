/// <reference types="vite/client" />
import type { SelferAPI } from '@shared/types'

declare global {
  interface Window {
    selfer: SelferAPI
  }
}

export {}
