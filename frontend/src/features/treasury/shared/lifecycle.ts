import { permission, type Area, type TreasuryRecord } from './types'
export function lifecycleActions(
  area: Area,
  record: TreasuryRecord,
): { action: string; permission: string }[] {
  const status = record.status
  const actions: string[] =
    area === 'accounts'
      ? []
      : area === 'payments'
        ? status === 'draft'
          ? ['submit', 'post', 'cancel']
          : status === 'approved'
            ? ['post', 'cancel']
            : status === 'pending_approval'
              ? []
              : status === 'posted'
                ? ['reverse']
                : []
        : area === 'transfers'
          ? status === 'draft'
            ? ['post', 'cancel']
            : status === 'posted'
              ? ['reverse']
              : []
          : area === 'plans'
            ? status === 'scheduled'
              ? ['fulfil', 'cancel']
              : []
            : area === 'banking'
              ? status === 'imported'
                ? ['reconcile']
                : status === 'reconciled'
                  ? ['reopen']
                  : []
              : status === 'draft'
                ? ['direction' in record && record.direction === 'received' ? 'receive' : 'issue']
                : status === 'portfolio'
                  ? ['endorse', 'collect', 'pledge', 'clear', 'dishonour', 'return']
                  : status === 'collection'
                    ? ['clear', 'dishonour', 'return']
                    : status === 'pledged'
                      ? ['release']
                      : status === 'issued'
                        ? ['clear', 'dishonour', 'return']
                        : []
  return actions.map((action) => ({
    action,
    permission:
      area === 'banking'
        ? permission(area, action === 'reopen' ? 'reopen' : 'reconcile')
        : area === 'plans'
          ? permission(area, action === 'fulfil' ? 'fulfil' : 'update')
          : area === 'instruments'
            ? permission(
                area,
                ['endorse', 'clear'].includes(action)
                  ? action
                  : ['dishonour', 'return'].includes(action)
                    ? 'reverse'
                    : 'post',
              )
            : permission(
                area,
                action === 'cancel' ? 'update' : action === 'submit' ? 'post' : action,
              ),
  }))
}
