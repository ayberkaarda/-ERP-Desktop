import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/datetime'
import { useIntlLocale } from '@/lib/datetime/locale'
import { Can, usePermission } from '@/lib/permissions'
import { PageShell } from '../components/PageShell'
import { ProjectDialog } from '../components/ProjectDialog'
import { RowActions } from '../components/RowActions'
import { useEditor } from '../components/useEditor'
import { useProjectList, useRemoveProject } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import { PROJECT_STATUSES, type Project } from '../types'

const col = createColumnHelper<Project>()

const dateCell = (value: string | null, locale: string) => (value ? formatDate(value, locale) : '—')

export function ProjectsPage() {
  const t = useRefT()
  const locale = useIntlLocale()
  const canUpdate = usePermission(REF_PERMISSIONS.projects.update)
  const canDelete = usePermission(REF_PERMISSIONS.projects.delete)
  const editor = useEditor<Project>()
  const remove = useRemoveProject()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: 'reference.projects' },
  )
  const list = useProjectList(query)

  const columns = useMemo(
    () => [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 120,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        size: 260,
      }),
      col.accessor('status', {
        header: t('projects.status'),
        meta: {
          label: t('projects.status'),
          filter: {
            key: 'status',
            options: PROJECT_STATUSES.map((s) => ({
              value: s,
              label: t(`projects.statuses.${s}`),
            })),
          },
        },
        cell: (c) => (
          <StatusBadge
            status={c.getValue()}
            definitions={{
              planned: { tone: 'info', label: t('projects.statuses.planned') },
              active: { tone: 'success', label: t('projects.statuses.active') },
              on_hold: { tone: 'warning', label: t('projects.statuses.on_hold') },
              closed: { tone: 'neutral', label: t('projects.statuses.closed') },
            }}
          />
        ),
        size: 130,
      }),
      // Dates are not sortable: the backend sorts projects by code, name and created_at only.
      col.accessor('start_date', {
        header: t('projects.startDate'),
        meta: { label: t('projects.startDate') },
        cell: (c) => dateCell(c.getValue(), locale),
        size: 120,
      }),
      col.accessor('end_date', {
        header: t('projects.endDate'),
        meta: { label: t('projects.endDate') },
        cell: (c) => dateCell(c.getValue(), locale),
        size: 120,
      }),
      ...(canUpdate || canDelete
        ? [
            col.display({
              id: 'actions',
              header: () => <span className="sr-only">{t('fields.actions')}</span>,
              meta: { label: t('fields.actions'), align: 'right' as const },
              enableHiding: false,
              cell: (c) => (
                <RowActions
                  name={c.row.original.code}
                  onEdit={canUpdate ? () => editor.openEdit(c.row.original) : undefined}
                  onDelete={
                    canDelete
                      ? () =>
                          remove.mutateAsync({
                            id: c.row.original.id,
                            version: c.row.original.version,
                          })
                      : undefined
                  }
                />
              ),
              size: 100,
            }),
          ]
        : []),
    ],
    // editor and remove are stable for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, canUpdate, canDelete],
  )

  return (
    <PageShell
      title={t('projects.title')}
      description={t('projects.subtitle')}
      actions={
        <Can permission={REF_PERMISSIONS.projects.create}>
          <Button onClick={editor.openNew}>
            <Plus aria-hidden="true" />
            {t('projects.new')}
          </Button>
        </Can>
      }
    >
      <DataTable<Project>
        label={t('projects.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta?.pagination?.total ?? list.data?.data.length ?? 0}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey="reference.projects"
        onRowActivate={canUpdate ? editor.openEdit : undefined}
      />
      {editor.target.mode !== 'closed' && (
        <ProjectDialog
          record={editor.target.mode === 'edit' ? editor.target.record : null}
          onClose={editor.close}
        />
      )}
    </PageShell>
  )
}
