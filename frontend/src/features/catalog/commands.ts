import { Boxes, Calculator, FolderTree, Percent, Plus, Ruler, Tags } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { CATALOG_OPEN } from './permissions'

/** Palette entries for the catalog; each is hidden unless its permission is granted. */
export function catalogCommands(): Command[] {
  return [
    {
      id: 'catalog.items',
      group: 'navigation',
      icon: Boxes,
      permission: 'items.view',
      title: (t) => t('nav.items', { ns: 'catalog' }),
      keywords: (t) => [
        t('nav.catalog', { ns: 'catalog' }),
        'item',
        'stok',
        'ürün',
        'sku',
        'barkod',
      ],
      run: ({ navigate }) => navigate('/catalog/items'),
    },
    {
      id: 'catalog.items.new',
      group: 'actions',
      icon: Plus,
      permission: ['items.view', 'items.create'],
      title: (t) => t('palette.newItem', { ns: 'catalog' }),
      keywords: () => ['new item', 'yeni stok', 'stok kartı'],
      run: ({ navigate }) => navigate('/catalog/items/new'),
    },
    {
      id: 'catalog.units',
      group: 'navigation',
      icon: Ruler,
      // Readers of these records see the entries; the pages gate their write actions.
      permission: CATALOG_OPEN.units,
      title: (t) => t('nav.units', { ns: 'catalog' }),
      keywords: () => ['unit', 'birim', 'dönüşüm', 'conversion'],
      run: ({ navigate }) => navigate('/catalog/units'),
    },
    {
      id: 'catalog.categories',
      group: 'navigation',
      icon: FolderTree,
      permission: CATALOG_OPEN.categories,
      title: (t) => t('nav.categories', { ns: 'catalog' }),
      keywords: () => ['category', 'kategori', 'grup'],
      run: ({ navigate }) => navigate('/catalog/categories'),
    },
    {
      id: 'catalog.priceLists',
      group: 'navigation',
      icon: Tags,
      permission: 'price_lists.view',
      title: (t) => t('nav.priceLists', { ns: 'catalog' }),
      keywords: () => ['price list', 'fiyat listesi', 'fiyat'],
      run: ({ navigate }) => navigate('/catalog/price-lists'),
    },
    {
      id: 'catalog.priceLists.new',
      group: 'actions',
      icon: Plus,
      permission: ['price_lists.view', 'price_lists.create'],
      title: (t) => t('palette.newPriceList', { ns: 'catalog' }),
      keywords: () => ['new price list', 'yeni fiyat listesi'],
      run: ({ navigate }) => navigate('/catalog/price-lists/new'),
    },
    {
      id: 'catalog.discountRules',
      group: 'navigation',
      icon: Percent,
      permission: CATALOG_OPEN.discountRules,
      title: (t) => t('nav.discountRules', { ns: 'catalog' }),
      keywords: () => ['discount', 'indirim', 'iskonto'],
      run: ({ navigate }) => navigate('/catalog/discount-rules'),
    },
    {
      id: 'catalog.pricing',
      group: 'navigation',
      icon: Calculator,
      permission: 'pricing.view',
      title: (t) => t('nav.pricing', { ns: 'catalog' }),
      keywords: () => ['pricing', 'fiyat hesapla', 'fiyat çöz'],
      run: ({ navigate }) => navigate('/catalog/pricing'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerCatalogCommands(): () => void {
  return registerCommands(catalogCommands())
}
