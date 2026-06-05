'use client'

import { MoreHorizontal } from 'lucide-react'
import { resolveIcon } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown'
import type { RowActionDef } from '@nyx/types'

type Row = Record<string, unknown>

function withGroupSeparators(actions: RowActionDef[]): Array<RowActionDef | 'separator'> {
  const result: Array<RowActionDef | 'separator'> = []
  let lastGroup: string | undefined = undefined
  for (const action of actions) {
    if (lastGroup !== undefined && action.group !== lastGroup) {
      result.push('separator')
    }
    result.push(action)
    lastGroup = action.group
  }
  return result
}

interface Props {
  row:       Row
  actions:   RowActionDef[]
  onExecute: (action: RowActionDef, row: Row) => void
}

export function RowActionsCell({ row, actions, onExecute }: Props) {
  const visible = actions.filter(a =>
    !a.visibleWhen || row[a.visibleWhen.field] === a.visibleWhen.value
  )

  if (!visible.length) return null

  if (visible.length === 1) {
    const action = visible[0]
    const Icon   = resolveIcon(action.icon)
    return (
      <Button
        variant={action.variant === 'destructive' ? 'destructive' : 'rowAction'}
        size="sm"
        onClick={() => onExecute(action, row)}
        title={action.label}
      >
        <Icon className="w-3.5 h-3.5" />
        {action.label}
      </Button>
    )
  }

  const items = withGroupSeparators(visible)

  return (
    <Dropdown
      trigger={
        <Button variant="rowAction" size="sm" title="Ações">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      }
      side="bottom"
      align="end"
    >
      {items.map((item, i) => {
        if (item === 'separator') return <DropdownSeparator key={`sep-${i}`} />
        const Icon = resolveIcon(item.icon)
        return (
          <DropdownItem
            key={item.action}
            destructive={item.variant === 'destructive'}
            onClick={() => onExecute(item, row)}
          >
            <Icon className="w-3.5 h-3.5" />
            {item.label}
          </DropdownItem>
        )
      })}
    </Dropdown>
  )
}
