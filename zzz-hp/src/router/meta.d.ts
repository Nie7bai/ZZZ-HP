import 'vue-router'
import type { ModePanelId } from '@/config/modePanels'
import type { DefenseVariant } from '@/types/defense'
import type { ModeKey } from '@/types/history'

declare module 'vue-router' {
  interface RouteMeta {
    defenseVariant?: DefenseVariant
    modePanelBasePath?: string
    modePanelId?: ModePanelId
    modePanelMode?: ModeKey
  }
}

export {}
