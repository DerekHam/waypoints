import { useEffect, useId, useRef, useState } from 'react'
import type { Locale } from '@shared/atlas'
import { useT } from '@/i18n'
import { searchPlaces, placeSubtitle, type PlaceResult } from '@/lib/search'
import { SearchIcon } from './Icons'
import { Spinner } from './ui'

type SearchBoxProps = {
  locale: Locale
  bias?: { lat: number; lon: number } | null
  placeholder?: string
  onSelect: (place: PlaceResult) => void
  autoFocus?: boolean
}

export function SearchBox({ locale, bias, placeholder, onSelect, autoFocus }: SearchBoxProps) {
  const { t } = useT()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      setError(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchPlaces(trimmed, locale, controller.signal, bias)
        if (controller.signal.aborted) return
        setResults(found)
        setActive(0)
        setOpen(true)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 320)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, locale, bias])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const choose = (place: PlaceResult) => {
    onSelect(place)
    setQuery('')
    setResults([])
    setOpen(false)
    setLoading(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!open) {
      if (event.key === 'ArrowDown' && query.trim().length >= 2) setOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault()
      choose(results[active])
    }
  }

  return (
    <div className="search-box" ref={rootRef}>
      <div className={`search-input-wrap ${open ? 'is-open' : ''}`}>
        <SearchIcon size={17} className="search-leading" />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={query}
          placeholder={placeholder ?? t('searchPlaceholder')}
          onChange={(event) => {
            const value = event.target.value
            setQuery(value)
            setOpen(value.trim().length >= 2)
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true)
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? <Spinner size={15} /> : null}
      </div>

      {open ? (
        <div className="search-results" id={listId} role="listbox">
          {results.map((place, index) => {
            const subtitle = placeSubtitle(place)
            return (
              <button
                key={place.id}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`search-result ${index === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(place)}
              >
                <span className="search-result-main">
                  <span className="search-result-name">{place.name}</span>
                  {subtitle ? <span className="search-result-meta">{subtitle}</span> : null}
                </span>
                {place.kind ? <span className="search-result-kind">{place.kind}</span> : null}
              </button>
            )
          })}
          {!loading && !error && results.length === 0 && query.trim().length >= 2 ? (
            <div className="search-empty">
              <strong>{t('noResults')}</strong>
              <span>{t('searchNoResultsHint')}</span>
            </div>
          ) : null}
          {error ? (
            <div className="search-empty">
              <strong>{t('searchFailed')}</strong>
              <span>{t('searchAttribution')}</span>
            </div>
          ) : null}
          <div className="search-attribution">{t('searchAttribution')}</div>
        </div>
      ) : null}
    </div>
  )
}
