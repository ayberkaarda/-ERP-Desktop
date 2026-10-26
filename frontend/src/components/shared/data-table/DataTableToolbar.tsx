import type { Table } from '@tanstack/react-table'
import { Columns3, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { setFilter, updateListQuery, type ListQueryState } from './listQuery'
import type { Density } from './useSavedView'

const ALL = '__all'

interface DataTableToolbarProps<T> {
  table: Table<T>
  query: ListQueryState
  onQueryChange: (next: ListQueryState) => void
  searchable: boolean
  density: Density
  onDensityChange: (density: Density) => void
  onResetView?: () => void
  children?: ReactNode
}

export function DataTableToolbar<T>({
  table,
  query,
  onQueryChange,
  searchable,
  density,
  onDensityChange,
  onResetView,
  children,
}: DataTableToolbarProps<T>) {
  const { t } = useTranslation('common')
  const filterColumns = table.getAllLeafColumns().filter((c) => c.columnDef.meta?.filter)
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide())
  const hasFilters = Object.keys(query.filters).length > 0

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      {searchable && (
        <SearchBox value={query.q} onSearch={(q) => onQueryChange(updateListQuery(query, { q }))} />
      )}
      {filterColumns.map((column) => {
        const meta = column.columnDef.meta
        if (!meta?.filter) return null
        const key = meta.filter.key ?? column.id
        const label = meta.label ?? column.id
        return (
          <Select
            key={column.id}
            value={query.filters[key] ?? ALL}
            onValueChange={(value) =>
              onQueryChange(setFilter(query, key, value === ALL ? null : value))
            }
          >
            <SelectTrigger aria-label={label} className="h-control-sm w-auto min-w-36 text-xs">
              <span className="text-muted-foreground">{label}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('dataTable.filterAll')}</SelectItem>
              {meta.filter.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      })}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onQueryChange(updateListQuery(query, { filters: {} }))}
        >
          <X aria-hidden="true" />
          {t('dataTable.clearFilters')}
        </Button>
      )}
      {children}
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <Columns3 aria-hidden="true" />
              {t('dataTable.columns')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('dataTable.columns')}</DropdownMenuLabel>
            {hideable.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(checked) => column.toggleVisibility(checked)}
                onSelect={(e) => e.preventDefault()}
              >
                {column.columnDef.meta?.label ?? column.id}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('dataTable.density')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={density}
              onValueChange={(v) => onDensityChange(v === 'compact' ? 'compact' : 'comfortable')}
            >
              <DropdownMenuRadioItem value="comfortable">
                {t('dataTable.densityComfortable')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">
                {t('dataTable.densityCompact')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {onResetView && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onResetView}>
                  {t('dataTable.resetView')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** Local text, debounced into `q`; an outside reset of `q` replaces the text. */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const { t } = useTranslation('common')
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setText(value)
  }
  const debounced = useDebouncedValue(text, 300)

  useEffect(() => {
    if (debounced.trim() !== synced.trim()) onSearch(debounced.trim())
    // Only a settled keystroke should search; prop identity changes must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  return (
    <div className="relative w-full max-w-64">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
      />
      <Input
        type="search"
        aria-label={t('dataTable.search')}
        placeholder={t('dataTable.searchPlaceholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSearch(text.trim())
        }}
        className="h-control-sm pl-8 text-xs"
      />
    </div>
  )
}
