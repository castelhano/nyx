'use client'

import { useState } from 'react'
import type React from 'react'
import { ArrowRight, ArrowLeft, ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react'
import { useShortcut } from '@/lib/keywatch'

export function useCardNavigation(
  count: number,
  onSelect: (index: number) => void,
  gridRef?: React.RefObject<HTMLElement | null>,
) {
  const [active, setActive] = useState(0)

  const cols = () =>
    gridRef?.current
      ? getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length
      : 1

  const move = (delta: number) => {
    ;(document.activeElement as HTMLElement)?.blur()
    setActive((i) => Math.max(0, Math.min(count - 1, i + delta)))
  }

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

  useShortcut('arrowdown', () => move(+cols()), {
    desc:    'Card abaixo',
    icon:    ArrowDown,
    origin:  'apps/web/src/core/useCardNavigation',
    display: false,
  })

  useShortcut('arrowup', () => move(-cols()), {
    desc:    'Card acima',
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
