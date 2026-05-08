/**
 * KeywatchCore — gerenciador de atalhos de teclado (zero DOM)
 * Port do Keywatch v7.1 para React/Next.js.
 * Toda interação com DOM (event listeners, modal) fica na camada React.
 */

export type ShortcutIcon = unknown

export interface HandlerOptions {
  context?:        string
  desc?:           string
  icon?:           ShortcutIcon | null
  origin?:         string
  keydown?:        boolean
  keyup?:          boolean
  group?:          string | null
  display?:        boolean
  order?:          number
  preventDefault?: boolean
  useCapture?:     boolean
  composed?:       boolean
}

export interface HandlerEntry {
  id:              symbol
  context:         string
  desc:            string
  icon:            ShortcutIcon | null
  origin:          string | undefined
  keydown:         boolean
  keyup:           boolean
  group:           string | null
  display:         boolean
  order:           number
  preventDefault:  boolean
  useCapture:      boolean
  composed:        boolean
  scope:           string
  schema:          string
  mods:            string[]
  key:             string
  method:          (ev: KeyboardEvent, handler: HandlerEntry) => void
}

type HandlerMap = Record<string, Record<string, Record<string, HandlerEntry[]>>>

type ComposedMatch = [] | [string, string[]]

export interface CoreOptions {
  splitKey?:                       string
  separator?:                      string
  tabOnEnter?:                     boolean
  composedTrigger?:                string
  composedListener?:               (args: { state: 0 | 1; scope: string; target: EventTarget | null }) => void
  reserve?:                        Record<string, string>
  shortcutMaplistOnlyContextActive?: boolean
  checkInputHint?:                 boolean
  checkInputModifier?:             string[]
  checkInputHintDelay?:            number
  setupModifierHint?:              ((args: { state: 0 | 1; modifier: string; ev: KeyboardEvent }) => void) | null
  composedPattern?:                ((schema: string, mods: string[], mainKey: string) => boolean) | null
  onContextChange?:                (context: string) => void
}

export class KeywatchCore {
  // ── Estado público ────────────────────────────────────────────────────────
  handlers:     HandlerMap = {}
  pressed:      string[]   = []
  contexts:     Record<string, string> = { all: 'Atalhos Globais', default: 'Atalhos Base' }
  contextPool:  string[]   = []
  locked        = false
  context       = 'default'

  // ── Opções da instância ───────────────────────────────────────────────────
  readonly splitKey:                       string
  readonly separator:                      string
  readonly tabOnEnter:                     boolean
  readonly composedTrigger:                string
  readonly reserve:                        Record<string, string>
  readonly shortcutMaplistOnlyContextActive: boolean
  readonly checkInputHint:                 boolean
  readonly checkInputModifier:             string[]
  readonly checkInputHintDelay:            number
  readonly setupModifierHint:              ((args: { state: 0 | 1; modifier: string; ev: KeyboardEvent }) => void) | null
  readonly composedPattern:                ((schema: string, mods: string[], mainKey: string) => boolean) | null
  composedListener:  (args: { state: 0 | 1; scope: string; target: EventTarget | null }) => void
  onContextChange?:  (context: string) => void

  // ── Estado interno ────────────────────────────────────────────────────────
  private _composedMatch:      ComposedMatch = []
  private _modifierHintTimer:  ReturnType<typeof setTimeout> | null = null
  private _modifierHintActive: string | null = null

  // ── Aliases de teclas ─────────────────────────────────────────────────────
  readonly modifier: Record<string, string> = {
    ctrl:      'control',
    '[space]': ' ',
    esc:       'escape',
    '↑':       'arrowup',
    '↓':       'arrowdown',
    '→':       'arrowright',
    '←':       'arrowleft',
  }

  private readonly _defaults: Omit<HandlerEntry, 'id' | 'scope' | 'schema' | 'mods' | 'key' | 'method'> = {
    context:        'default',
    desc:           '',
    icon:           null,
    origin:         undefined,
    keydown:        true,
    keyup:          false,
    group:          null,
    display:        true,
    order:          5,
    preventDefault: true,
    useCapture:     false,
    composed:       false,
  }

  constructor(options: CoreOptions = {}) {
    this.splitKey    = options.splitKey    ?? '+'
    this.separator   = options.separator   ?? ';'
    this.tabOnEnter  = options.tabOnEnter  ?? true
    this.composedTrigger  = options.composedTrigger  ?? ';'
    this.composedListener = options.composedListener ?? (() => {})
    this.reserve     = options.reserve     ?? {}
    this.shortcutMaplistOnlyContextActive = options.shortcutMaplistOnlyContextActive ?? true
    this.checkInputHint      = options.checkInputHint      ?? false
    this.checkInputModifier  = (options.checkInputModifier ?? ['ctrl']).map(m => this.modifier[m] || m.toLowerCase())
    this.checkInputHintDelay = options.checkInputHintDelay ?? 400
    this.setupModifierHint   = options.setupModifierHint   ?? null
    this.composedPattern     = options.composedPattern     ?? null
    this.onContextChange     = options.onContextChange
  }

  // ── Processamento de eventos ──────────────────────────────────────────────

  handleEvent(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null
    if (this.locked || target?.dataset?.keywatch?.toLowerCase() === 'escape') return

    if (ev.type === 'keydown') {
      const key = this._normalize(ev.key)
      if (ev.key && !this.pressed.includes(key)) this.pressed.push(key)

      // Modifier hint
      if (this.checkInputHint && this.setupModifierHint) {
        if (this.pressed.length === 1 && this.checkInputModifier.includes(key)) {
          clearTimeout(this._modifierHintTimer!)
          this._modifierHintTimer = setTimeout(() => {
            this._modifierHintTimer  = null
            this._modifierHintActive = key
            this.setupModifierHint!({ state: 1, modifier: key, ev })
          }, this.checkInputHintDelay)
        } else if (this._modifierHintTimer !== null) {
          clearTimeout(this._modifierHintTimer)
          this._modifierHintTimer = null
        }
      }

      const scope = this._buildScope()
      const found = this._eventsMatch(scope, ev)

      if (!found && ev.key !== this.composedTrigger && this._composedMatch.length > 0) {
        this._composedMatch = []
        this.composedListener({ state: 0, scope, target })
      }

      // tabOnEnter — avança foco ao pressionar Enter em inputs/selects
      const inputTarget = target as HTMLInputElement | null
      if (!found && this.tabOnEnter && ev.key === 'Enter' && inputTarget?.form &&
          (target?.nodeName === 'INPUT' || target?.nodeName === 'SELECT')) {
        const kw = target?.dataset?.keywatch
        if (kw === 'default') return
        ev.preventDefault()
        if (kw === 'none') return
        const form  = inputTarget.form
        const index = Array.prototype.indexOf.call(form.elements, inputTarget)
        for (let i = index + 1; i < form.elements.length; i++) {
          const el = form.elements[i] as HTMLElement
          if (this._isFieldFocusable(el)) { el.focus(); break }
        }
      }

    } else if (ev.type === 'keyup') {
      // Modifier hint release
      if (this.checkInputHint && this.setupModifierHint) {
        const modCodeMap: Record<string, string> = {
          AltLeft: 'alt', AltRight: 'alt',
          ControlLeft: 'control', ControlRight: 'control',
          ShiftLeft: 'shift', ShiftRight: 'shift',
          MetaLeft: 'meta', MetaRight: 'meta',
        }
        const releasedKey = modCodeMap[ev.code] || this._normalize(ev.key)
        if (this.checkInputModifier.includes(releasedKey)) {
          clearTimeout(this._modifierHintTimer!)
          this._modifierHintTimer = null
          if (this._modifierHintActive === releasedKey) {
            this._modifierHintActive = null
            this.setupModifierHint!({ state: 0, modifier: releasedKey, ev })
          }
        }
      }

      const scope = this._buildScope()
      this._eventsMatch(scope, ev)
      this._removeKeyFromPressed(ev)
      if (ev.key.toLowerCase() === 'escape') this.pressed = []
    }
  }

  // ── Bind / Unbind ─────────────────────────────────────────────────────────

  bind(
    scope: string,
    method: (ev: KeyboardEvent, handler: HandlerEntry) => void,
    options: HandlerOptions = {},
  ): void {
    const keys     = this._getMultipleKeys(scope)
    const resolver = typeof this.composedPattern === 'function'
      ? this.composedPattern
      : (_s: string, mods: string[], key: string) => this._defaultComposedPattern(mods, key)

    keys.forEach((entry, index) => {
      const handler = { ...this._defaults, ...options } as HandlerEntry
      handler.id = Symbol()

      const [mods, key] = this._getScope(entry)
      handler.mods   = mods
      handler.key    = key
      handler.scope  = [...mods, key].join()
      handler.schema = scope
      handler.method = method

      // Apenas o primeiro alias aparece no modal
      if (index > 0) handler.display = false

      handler.composed = resolver(entry, mods, key)

      this._spreadHandler(handler)
    })
  }

  unbind(scope: string, options: { context?: string; type?: string } = {}): void {
    if (!options.type) {
      this.unbind(scope, { ...options, type: 'keydown' })
      this.unbind(scope, { ...options, type: 'keyup' })
      return
    }
    if (!options.context) {
      for (const ctx in this.contexts) this.unbind(scope, { ...options, context: ctx })
      return
    }
    if (!Object.prototype.hasOwnProperty.call(this.contexts, options.context)) return

    const [mods, key]     = this._getScope(scope)
    const normalizedScope = [...mods, key].join()
    if (!this.handlers?.[options.type]?.[options.context]?.[normalizedScope]) return

    delete this.handlers[options.type][options.context][normalizedScope]
    if (!Object.keys(this.handlers[options.type][options.context]).length)
      delete this.handlers[options.type][options.context]
    if (!Object.keys(this.handlers[options.type]).length)
      delete this.handlers[options.type]
  }

  unbindById(id: symbol): void {
    for (const type in this.handlers)
      for (const ctx in this.handlers[type])
        for (const scope in this.handlers[type][ctx]) {
          const list = this.handlers[type][ctx][scope]
          const next = list.filter(h => h.id !== id)
          if (next.length !== list.length) {
            if (next.length) this.handlers[type][ctx][scope] = next
            else {
              delete this.handlers[type][ctx][scope]
              if (!Object.keys(this.handlers[type][ctx]).length) delete this.handlers[type][ctx]
              if (!Object.keys(this.handlers[type]).length)      delete this.handlers[type]
            }
          }
        }
  }

  unbindGroup(group: string): void {
    if (!group) return
    for (const type in this.handlers)
      for (const ctx in this.handlers[type])
        for (const scope in this.handlers[type][ctx]) {
          const next = this.handlers[type][ctx][scope].filter(h => h.group !== group)
          if (next.length) this.handlers[type][ctx][scope] = next
          else {
            delete this.handlers[type][ctx][scope]
            if (!Object.keys(this.handlers[type][ctx]).length) delete this.handlers[type][ctx]
          }
        }
    for (const type in this.handlers)
      if (!Object.keys(this.handlers[type]).length) delete this.handlers[type]
  }

  unbindContext(context: string): void {
    for (const type in this.handlers) {
      delete this.handlers[type][context]
      if (!Object.keys(this.handlers[type]).length) delete this.handlers[type]
    }
  }

  unbindAll(): void { this.handlers = {} }

  // ── Contextos ─────────────────────────────────────────────────────────────

  getContext(): string { return this.context }

  addContext(context: string, desc = ''): void {
    if (context && !Object.prototype.hasOwnProperty.call(this.contexts, context))
      this.contexts[context] = desc
  }

  setContext(context?: string, desc = ''): void {
    if (!context) {
      this.context = this.contextPool.pop() || 'default'
      this.onContextChange?.(this.context)
      return
    }
    if (!Object.prototype.hasOwnProperty.call(this.contexts, context)) this.addContext(context, desc)
    else if (desc) this.contexts[context] = desc
    this.contextPool.push(this.context)
    this.context = context
    this.onContextChange?.(this.context)
  }

  updateContext(context: string, desc: string): void {
    if (Object.prototype.hasOwnProperty.call(this.contexts, context))
      this.contexts[context] = desc
  }

  // ── Dados para o modal ────────────────────────────────────────────────────

  getVisibleHandlers(): HandlerEntry[] {
    const seen    = new Set<symbol>()
    const visible: HandlerEntry[] = []

    for (const type in this.handlers)
      for (const ctx in this.handlers[type]) {
        if (this.shortcutMaplistOnlyContextActive && ctx !== this.context && ctx !== 'all') continue
        for (const scope in this.handlers[type][ctx])
          for (const h of this.handlers[type][ctx][scope])
            if (h.display && !seen.has(h.id)) { seen.add(h.id); visible.push(h) }
      }

    return visible.sort((a, b) => a.order - b.order)
  }

  /** Converte schema ('ctrl+s;alt+s') em arrays de keys para exibição: [['ctrl','s'], ['alt','s']] */
  parseSchema(schema: string): string[][] {
    return this._getMultipleKeys(schema).map(entry => {
      const [mods, key] = this._getScope(entry)
      return [...mods, key].map(k => {
        for (const alias in this.modifier)
          if (this.modifier[alias] === k) return alias
        return k
      })
    })
  }

  // ── Utilitários públicos ──────────────────────────────────────────────────

  avail(scope: string, options: { type?: string; context?: string } = {}): boolean {
    const type = options.type || 'keydown'
    const [mods, key]  = this._getScope(scope)
    const normalized   = [...mods, key].join()
    if (options.context) {
      if (!Object.prototype.hasOwnProperty.call(this.contexts, options.context)) return true
      return !this.handlers?.[type]?.[options.context]?.[normalized]
    }
    for (const ctx in this.contexts)
      if (this.handlers?.[type]?.[ctx]?.[normalized]) return false
    return true
  }

  run(scope: string, options: { type?: string; context?: string } = {}): void {
    const { type = 'keydown', context = 'default' } = options
    const [mods, key] = this._getScope(scope)
    const normalized  = [...mods, key].join()
    this.handlers?.[type]?.[context]?.[normalized]?.forEach(h =>
      h.method({} as KeyboardEvent, h),
    )
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private _buildScope(): string {
    if (this.pressed.length === 1) return this.pressed[0]
    return [...this.pressed.slice(0, -1).sort(), this.pressed[this.pressed.length - 1]].join()
  }

  private _eventsMatch(scope: string, ev: KeyboardEvent): number {
    let preventDefault = false
    let count          = 0
    const target       = ev.target as HTMLElement | null

    let resolvedScope = scope
    if (scope === this.composedTrigger && this._composedMatch.length > 0)
      resolvedScope = (this._composedMatch as [string, string[]])[0]

    const list = [
      ...(this.handlers?.[ev.type]?.[this.context]?.[resolvedScope] ?? []),
      ...(this.handlers?.[ev.type]?.['all']?.[resolvedScope]         ?? []),
    ]

    for (const handler of list) {
      const tagName    = target?.nodeName.toLowerCase() ?? ''
      const isInputLike = ['input', 'textarea', 'select'].includes(tagName)
      const cm          = this._composedMatch as [string, string[]]
      const isComposed  = this._composedMatch.length === 0 || !cm[1].includes(ev.type)

      if (handler.composed && isComposed && isInputLike) {
        // Aguarda composedTrigger antes de disparar
        if (this._composedMatch.length === 0) {
          this._composedMatch = [resolvedScope, [ev.type]]
        } else if (!cm[1].includes(ev.type)) {
          cm[1].push(ev.type)
        }
        this.composedListener({ state: 1, scope: resolvedScope, target })
        count++
        continue
      }

      // Limpa composedMatch consumido
      if (this._composedMatch.length > 0 && cm[1].includes(ev.type)) {
        const remaining = cm[1].filter(t => t !== ev.type)
        this._composedMatch = remaining.length ? [resolvedScope, remaining] : []
        if (!this._composedMatch.length)
          this.composedListener({ state: 0, scope: resolvedScope, target })
      }

      handler.method(ev, handler)
      count++
      preventDefault = preventDefault || handler.preventDefault
    }

    if (preventDefault) ev.preventDefault()
    return count
  }

  private _spreadHandler(handler: HandlerEntry): void {
    for (const type of ['keydown', 'keyup'] as const) {
      if (!handler[type]) continue
      this.handlers[type]                              ??= {}
      this.handlers[type][handler.context]             ??= {}
      this.handlers[type][handler.context][handler.scope] ??= []
      this.handlers[type][handler.context][handler.scope].push(handler)
      this.handlers[type][handler.context][handler.scope]
        .sort((a, b) => Number(b.useCapture) - Number(a.useCapture))
    }
  }

  private _defaultComposedPattern(mods: string[], mainKey: string): boolean {
    const standardMods = ['control', 'shift', 'alt', 'meta']
    const fKeyRx       = /^f(?:[1-9]|1[0-2])$/
    if (mods.length === 0) return !fKeyRx.test(mainKey) && mainKey !== 'escape'
    if (mods.length === 1) {
      const m = mods[0]
      if (m === 'control' || m === 'shift') return true
      if (m === 'alt'     || m === 'meta')  return false
      return true
    }
    return mods.some(m => !standardMods.includes(m))
  }

  private _normalize(str: string): string {
    return str.normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[çÇ]/g, 'c')
      .toLowerCase()
  }

  private _isFieldFocusable(el: HTMLElement): boolean {
    return !!(
      el &&
      !('disabled' in el && (el as HTMLInputElement).disabled) &&
      !('readOnly' in el && (el as HTMLInputElement).readOnly) &&
      el.offsetParent !== null &&
      el.tabIndex >= 0
    )
  }

  private _removeKeyFromPressed(ev: KeyboardEvent): void {
    let key   = this._normalize(ev.key)
    let index = this.pressed.indexOf(key)
    if (index === -1) {
      const modCodeMap: Record<string, string> = {
        AltLeft: 'alt', AltRight: 'alt',
        ControlLeft: 'control', ControlRight: 'control',
        ShiftLeft: 'shift', ShiftRight: 'shift',
        MetaLeft: 'meta', MetaRight: 'meta',
      }
      key   = modCodeMap[ev.code] || key
      index = this.pressed.indexOf(key)
    }
    if (index > -1) this.pressed.splice(index, 1)
  }

  private _getScope(scope: string): [string[], string] {
    let keys  = scope.split(this.splitKey)
    let index = keys.lastIndexOf('')
    // Reconstrói teclas que contêm o próprio splitKey (ex: ctrl++)
    while (index >= 0) {
      keys[index - 1] += this.splitKey
      keys.splice(index, 1)
      index = keys.lastIndexOf('')
    }
    const mapped  = keys.map(k => this.modifier[k] || k.toLowerCase())
    const mainKey = mapped.pop()!
    return [mapped.sort(), mainKey]
  }

  private _getMultipleKeys(scope: string): string[] {
    let keys  = scope.split(this.separator)
    let index = keys.lastIndexOf('')
    while (index >= 0) {
      keys[index - 1] += ';'
      keys.splice(index, 1)
      index = keys.lastIndexOf('')
    }
    return keys
  }
}
