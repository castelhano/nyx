'use client'

import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

export function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <FileQuestion className="h-12 w-12 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-lg font-semibold">Página não encontrada</p>
        <p className="text-sm text-muted-foreground">
          O recurso que você tentou acessar não existe.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-8 items-center rounded-(--radius) border border-input bg-transparent px-3 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        Voltar ao início
      </Link>
    </div>
  )
}
