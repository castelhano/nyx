'use client'

import { useState } from 'react'
import { ArrowRight, ArrowLeft, ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react'
import { useShortcut } from '@/lib/keywatch'

export function useCardNavigation(count: number, onSelect: (index: number) => void) {
  const [active, setActive] = useState(0)

  const move = (delta: number) =>
    setActive((i) => Math.max(0, Math.min(count - 1, i + delta)))

  useShortcut('arrowright', () => move(+1), {
    desc:   'Próximo card',
    icon:   ArrowRight,
    origin: 'apps/web/src/core/useCardNavigation',
  })

  useShortcut('arrowleft', () => move(-1), {
    desc:   'Card anterior',
    icon:   ArrowLeft,
    origin: 'apps/web/src/core/useCardNavigation',
  })

  useShortcut('arrowdown', () => move(+1), {
    desc:    'Próximo card',
    icon:    ArrowDown,
    origin:  'apps/web/src/core/useCardNavigation',
    display: false,
  })

  useShortcut('arrowup', () => move(-1), {
    desc:    'Card anterior',
    icon:    ArrowUp,
    origin:  'apps/web/src/core/useCardNavigation',
    display: false,
  })

  useShortcut('enter', () => onSelect(active), {
    desc:   'Acessar card selecionado',
    icon:   CornerDownLeft,
    origin: 'apps/web/src/core/useCardNavigation',
  })

  return { active, setActive }
}
