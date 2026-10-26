<?php

declare(strict_types=1);

namespace App\Modules\Organization\Services;

use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

/**
 * Referential checks behind the integration foreign keys (company_id and cross-module references
 * of Reference, Parties and Catalog from Phase 2, of Accounting from Phase 3 and of Inventory from Phase 4). Works on table and column names only (no other
 * module's models), so it can run in migrations, commands and on installs missing a module.
 *
 * - orphans(): rows whose reference points at no row at all (what a foreign key would reject).
 * - repairOrphans(): opt-in fix for the references that may safely become NULL; everything else is
 *   only reported and needs a manual decision.
 * - tenancyViolations(): rows referencing a record of another company. Single-column keys cannot
 *   express this, the lookups prevent it on write; this is the read-only audit for old data.
 */
final class MasterDataIntegrity
{
    /** company_id -> companies.id. */
    public const array COMPANY_TABLES = [
        'company_currencies', 'exchange_rates', 'tax_codes', 'payment_terms', 'warehouses', 'locations',
        'cost_centers', 'projects',
        'parties', 'party_addresses', 'party_contacts', 'party_bank_accounts',
        'units', 'unit_conversions', 'item_categories', 'items', 'item_variants', 'item_units',
        'item_barcodes', 'price_lists', 'price_list_lines', 'discount_rules',
    ];

    /**
     * Cross-module references: table, column, referenced table, referenced column, repairable
     * (true: an orphan may be set to NULL without breaking a rule of the owning module).
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string, 4: bool}>
     */
    public const array CROSS_MODULE = [
        ['parties', 'payment_term_id', 'payment_terms', 'id', true],
        ['parties', 'price_list_id', 'price_lists', 'id', true],
        ['items', 'default_tax_code_id', 'tax_codes', 'id', true],
        ['items', 'purchase_tax_code_id', 'tax_codes', 'id', true],
        ['projects', 'party_id', 'parties', 'id', true],
        ['warehouses', 'branch_id', 'branches', 'id', true],
        // NULL would turn a party discount into one for everybody.
        ['discount_rules', 'party_id', 'parties', 'id', false],
        ['company_currencies', 'currency_code', 'currencies', 'code', false],
        ['exchange_rates', 'currency_code', 'currencies', 'code', false],
        ['parties', 'default_currency_code', 'currencies', 'code', true],
        // A risk limit needs its currency.
        ['parties', 'risk_currency_code', 'currencies', 'code', false],
        ['party_bank_accounts', 'currency_code', 'currencies', 'code', true],
        ['price_lists', 'currency_code', 'currencies', 'code', false],
    ];

    /** company_id -> companies.id for the Accounting tables. */
    public const array ACCOUNTING_COMPANY_TABLES = [
        'fiscal_years', 'accounting_periods', 'accounts', 'journal_entries', 'journal_lines',
        'account_balances', 'account_determination_rules',
    ];

    /**
     * Accounting references to other modules: table, column, referenced table, referenced column.
     * None is repairable: ledger rows are evidence and posted ones cannot change at all.
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public const array ACCOUNTING_CROSS_MODULE = [
        ['accounts', 'currency_code', 'currencies', 'code'],
        ['journal_lines', 'currency_code', 'currencies', 'code'],
        ['journal_lines', 'party_id', 'parties', 'id'],
        ['journal_lines', 'cost_center_id', 'cost_centers', 'id'],
        ['journal_lines', 'project_id', 'projects', 'id'],
        ['fiscal_years', 'closed_by', 'users', 'id'],
        ['accounting_periods', 'closed_by', 'users', 'id'],
        ['journal_entries', 'posted_by', 'users', 'id'],
        ['journal_entries', 'created_by', 'users', 'id'],
    ];

    /** company_id -> companies.id for the Inventory tables. */
    public const array INVENTORY_COMPANY_TABLES = [
        'stock_warehouse_settings', 'stock_lots', 'stock_serials', 'stock_documents', 'stock_document_lines',
        'stock_movements', 'stock_valuations', 'stock_balances', 'stock_cost_layers', 'stock_reservations',
    ];

    /**
     * Inventory references to other modules (items, units, Reference warehouses and locations,
     * journal entries, users) plus the one same-module key the Inventory migrations left out
     * (document line -> reservation). None is repairable: movements are append-only evidence and
     * posted documents cannot change. stock_balances.location_id / lot_id hold a nil uuid sentinel
     * for "none" and are not constrained; stock_movements.document_id / document_line_id and
     * stock_documents.source_id point at documents of any module (typed by their *_type column).
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public const array INVENTORY_CROSS_MODULE = [
        ['stock_warehouse_settings', 'warehouse_id', 'warehouses', 'id'],
        ['stock_lots', 'item_id', 'items', 'id'],
        ['stock_serials', 'item_id', 'items', 'id'],
        ['stock_serials', 'warehouse_id', 'warehouses', 'id'],
        ['stock_serials', 'location_id', 'locations', 'id'],
        ['stock_documents', 'warehouse_id', 'warehouses', 'id'],
        ['stock_documents', 'target_warehouse_id', 'warehouses', 'id'],
        ['stock_documents', 'journal_entry_id', 'journal_entries', 'id'],
        ['stock_documents', 'reversal_journal_entry_id', 'journal_entries', 'id'],
        ['stock_documents', 'posted_by', 'users', 'id'],
        ['stock_documents', 'reversed_by', 'users', 'id'],
        ['stock_documents', 'created_by', 'users', 'id'],
        ['stock_document_lines', 'item_id', 'items', 'id'],
        ['stock_document_lines', 'unit_id', 'units', 'id'],
        ['stock_document_lines', 'location_id', 'locations', 'id'],
        ['stock_document_lines', 'target_location_id', 'locations', 'id'],
        ['stock_document_lines', 'reservation_id', 'stock_reservations', 'id'],
        ['stock_movements', 'item_id', 'items', 'id'],
        ['stock_movements', 'warehouse_id', 'warehouses', 'id'],
        ['stock_movements', 'location_id', 'locations', 'id'],
        ['stock_movements', 'journal_entry_id', 'journal_entries', 'id'],
        ['stock_movements', 'created_by', 'users', 'id'],
        ['stock_valuations', 'item_id', 'items', 'id'],
        ['stock_valuations', 'warehouse_id', 'warehouses', 'id'],
        ['stock_balances', 'item_id', 'items', 'id'],
        ['stock_balances', 'warehouse_id', 'warehouses', 'id'],
        ['stock_cost_layers', 'item_id', 'items', 'id'],
        ['stock_cost_layers', 'warehouse_id', 'warehouses', 'id'],
        ['stock_reservations', 'item_id', 'items', 'id'],
        ['stock_reservations', 'warehouse_id', 'warehouses', 'id'],
        ['stock_reservations', 'created_by', 'users', 'id'],
    ];

    /** company_id -> companies.id for the Sales tables. */
    public const array SALES_COMPANY_TABLES = [
        'sales_quotes', 'sales_quote_lines', 'sales_orders', 'sales_order_lines', 'sales_deliveries', 'sales_delivery_lines', 'sales_invoices', 'sales_invoice_lines', 'sales_returns', 'sales_return_lines', 'sales_receivable_applications',
    ];

    /**
     * Sales references to other modules: parties, currencies, Reference payment terms, warehouses,
     * cost centers, projects and tax codes, Catalog price lists, items, variants and units,
     * Inventory stock documents and reservations, Accounting journal entries, Workflow approval
     * requests and users. source_id / source_line_id point at documents of any type (typed by
     * source_type) and are not constrained; links inside the module are keys of the Sales migration.
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public const array SALES_CROSS_MODULE = [
        ['sales_quotes', 'party_id', 'parties', 'id'],
        ['sales_quotes', 'currency_code', 'currencies', 'code'],
        ['sales_quotes', 'payment_term_id', 'payment_terms', 'id'],
        ['sales_quotes', 'price_list_id', 'price_lists', 'id'],
        ['sales_quotes', 'warehouse_id', 'warehouses', 'id'],
        ['sales_quotes', 'cost_center_id', 'cost_centers', 'id'],
        ['sales_quotes', 'project_id', 'projects', 'id'],
        ['sales_quotes', 'created_by', 'users', 'id'],
        ['sales_orders', 'party_id', 'parties', 'id'],
        ['sales_orders', 'currency_code', 'currencies', 'code'],
        ['sales_orders', 'payment_term_id', 'payment_terms', 'id'],
        ['sales_orders', 'price_list_id', 'price_lists', 'id'],
        ['sales_orders', 'warehouse_id', 'warehouses', 'id'],
        ['sales_orders', 'cost_center_id', 'cost_centers', 'id'],
        ['sales_orders', 'project_id', 'projects', 'id'],
        ['sales_orders', 'created_by', 'users', 'id'],
        ['sales_deliveries', 'party_id', 'parties', 'id'],
        ['sales_deliveries', 'currency_code', 'currencies', 'code'],
        ['sales_deliveries', 'payment_term_id', 'payment_terms', 'id'],
        ['sales_deliveries', 'price_list_id', 'price_lists', 'id'],
        ['sales_deliveries', 'warehouse_id', 'warehouses', 'id'],
        ['sales_deliveries', 'cost_center_id', 'cost_centers', 'id'],
        ['sales_deliveries', 'project_id', 'projects', 'id'],
        ['sales_deliveries', 'created_by', 'users', 'id'],
        ['sales_invoices', 'party_id', 'parties', 'id'],
        ['sales_invoices', 'currency_code', 'currencies', 'code'],
        ['sales_invoices', 'payment_term_id', 'payment_terms', 'id'],
        ['sales_invoices', 'price_list_id', 'price_lists', 'id'],
        ['sales_invoices', 'warehouse_id', 'warehouses', 'id'],
        ['sales_invoices', 'cost_center_id', 'cost_centers', 'id'],
        ['sales_invoices', 'project_id', 'projects', 'id'],
        ['sales_invoices', 'created_by', 'users', 'id'],
        ['sales_returns', 'party_id', 'parties', 'id'],
        ['sales_returns', 'currency_code', 'currencies', 'code'],
        ['sales_returns', 'payment_term_id', 'payment_terms', 'id'],
        ['sales_returns', 'price_list_id', 'price_lists', 'id'],
        ['sales_returns', 'warehouse_id', 'warehouses', 'id'],
        ['sales_returns', 'cost_center_id', 'cost_centers', 'id'],
        ['sales_returns', 'project_id', 'projects', 'id'],
        ['sales_returns', 'created_by', 'users', 'id'],
        ['sales_orders', 'credit_override_by', 'users', 'id'],
        ['sales_orders', 'confirmed_by', 'users', 'id'],
        ['sales_orders', 'approval_request_id', 'approval_requests', 'id'],
        ['sales_deliveries', 'stock_document_id', 'stock_documents', 'id'],
        ['sales_deliveries', 'reversal_stock_document_id', 'stock_documents', 'id'],
        ['sales_deliveries', 'journal_entry_id', 'journal_entries', 'id'],
        ['sales_deliveries', 'posted_by', 'users', 'id'],
        ['sales_deliveries', 'cancelled_by', 'users', 'id'],
        ['sales_invoices', 'journal_entry_id', 'journal_entries', 'id'],
        ['sales_invoices', 'reversal_journal_entry_id', 'journal_entries', 'id'],
        ['sales_invoices', 'issued_by', 'users', 'id'],
        ['sales_invoices', 'reversed_by', 'users', 'id'],
        ['sales_invoices', 'credit_override_by', 'users', 'id'],
        ['sales_returns', 'stock_document_id', 'stock_documents', 'id'],
        ['sales_returns', 'journal_entry_id', 'journal_entries', 'id'],
        ['sales_returns', 'approved_by', 'users', 'id'],
        ['sales_returns', 'received_by', 'users', 'id'],
        ['sales_returns', 'credited_by', 'users', 'id'],
        ['sales_quote_lines', 'item_id', 'items', 'id'],
        ['sales_quote_lines', 'variant_id', 'item_variants', 'id'],
        ['sales_quote_lines', 'unit_id', 'units', 'id'],
        ['sales_quote_lines', 'tax_code_id', 'tax_codes', 'id'],
        ['sales_quote_lines', 'warehouse_id', 'warehouses', 'id'],
        ['sales_order_lines', 'item_id', 'items', 'id'],
        ['sales_order_lines', 'variant_id', 'item_variants', 'id'],
        ['sales_order_lines', 'unit_id', 'units', 'id'],
        ['sales_order_lines', 'tax_code_id', 'tax_codes', 'id'],
        ['sales_order_lines', 'warehouse_id', 'warehouses', 'id'],
        ['sales_delivery_lines', 'item_id', 'items', 'id'],
        ['sales_delivery_lines', 'variant_id', 'item_variants', 'id'],
        ['sales_delivery_lines', 'unit_id', 'units', 'id'],
        ['sales_delivery_lines', 'tax_code_id', 'tax_codes', 'id'],
        ['sales_delivery_lines', 'warehouse_id', 'warehouses', 'id'],
        ['sales_invoice_lines', 'item_id', 'items', 'id'],
        ['sales_invoice_lines', 'variant_id', 'item_variants', 'id'],
        ['sales_invoice_lines', 'unit_id', 'units', 'id'],
        ['sales_invoice_lines', 'tax_code_id', 'tax_codes', 'id'],
        ['sales_invoice_lines', 'warehouse_id', 'warehouses', 'id'],
        ['sales_return_lines', 'item_id', 'items', 'id'],
        ['sales_return_lines', 'variant_id', 'item_variants', 'id'],
        ['sales_return_lines', 'unit_id', 'units', 'id'],
        ['sales_return_lines', 'tax_code_id', 'tax_codes', 'id'],
        ['sales_return_lines', 'warehouse_id', 'warehouses', 'id'],
        ['sales_order_lines', 'reservation_id', 'stock_reservations', 'id'],
        ['sales_receivable_applications', 'created_by', 'users', 'id'],
    ];

    /**
     * References between company scoped records (table, column, referenced table) checked for
     * crossing companies. Global rows (company_id NULL, e.g. seeded tax codes) are allowed.
     *
     * @var list<array{0: string, 1: string, 2: string}>
     */
    public const array TENANT_REFERENCES = [
        ['parties', 'payment_term_id', 'payment_terms'],
        ['parties', 'price_list_id', 'price_lists'],
        ['items', 'default_tax_code_id', 'tax_codes'],
        ['items', 'purchase_tax_code_id', 'tax_codes'],
        ['projects', 'party_id', 'parties'],
        ['projects', 'cost_center_id', 'cost_centers'],
        ['warehouses', 'branch_id', 'branches'],
        ['discount_rules', 'party_id', 'parties'],
        ['journal_lines', 'party_id', 'parties'],
        ['journal_lines', 'cost_center_id', 'cost_centers'],
        ['journal_lines', 'project_id', 'projects'],
        ['stock_documents', 'warehouse_id', 'warehouses'],
        ['stock_documents', 'target_warehouse_id', 'warehouses'],
        ['stock_document_lines', 'item_id', 'items'],
        ['stock_movements', 'item_id', 'items'],
        ['stock_movements', 'warehouse_id', 'warehouses'],
        ['stock_reservations', 'item_id', 'items'],
        ['stock_reservations', 'warehouse_id', 'warehouses'],
        ['sales_quotes', 'party_id', 'parties'],
        ['sales_quotes', 'payment_term_id', 'payment_terms'],
        ['sales_quotes', 'price_list_id', 'price_lists'],
        ['sales_quotes', 'warehouse_id', 'warehouses'],
        ['sales_quotes', 'cost_center_id', 'cost_centers'],
        ['sales_quotes', 'project_id', 'projects'],
        ['sales_orders', 'party_id', 'parties'],
        ['sales_orders', 'payment_term_id', 'payment_terms'],
        ['sales_orders', 'price_list_id', 'price_lists'],
        ['sales_orders', 'warehouse_id', 'warehouses'],
        ['sales_orders', 'cost_center_id', 'cost_centers'],
        ['sales_orders', 'project_id', 'projects'],
        ['sales_deliveries', 'party_id', 'parties'],
        ['sales_deliveries', 'payment_term_id', 'payment_terms'],
        ['sales_deliveries', 'price_list_id', 'price_lists'],
        ['sales_deliveries', 'warehouse_id', 'warehouses'],
        ['sales_deliveries', 'cost_center_id', 'cost_centers'],
        ['sales_deliveries', 'project_id', 'projects'],
        ['sales_invoices', 'party_id', 'parties'],
        ['sales_invoices', 'payment_term_id', 'payment_terms'],
        ['sales_invoices', 'price_list_id', 'price_lists'],
        ['sales_invoices', 'warehouse_id', 'warehouses'],
        ['sales_invoices', 'cost_center_id', 'cost_centers'],
        ['sales_invoices', 'project_id', 'projects'],
        ['sales_returns', 'party_id', 'parties'],
        ['sales_returns', 'payment_term_id', 'payment_terms'],
        ['sales_returns', 'price_list_id', 'price_lists'],
        ['sales_returns', 'warehouse_id', 'warehouses'],
        ['sales_returns', 'cost_center_id', 'cost_centers'],
        ['sales_returns', 'project_id', 'projects'],
        ['sales_quote_lines', 'item_id', 'items'],
        ['sales_quote_lines', 'unit_id', 'units'],
        ['sales_quote_lines', 'tax_code_id', 'tax_codes'],
        ['sales_quote_lines', 'warehouse_id', 'warehouses'],
        ['sales_order_lines', 'item_id', 'items'],
        ['sales_order_lines', 'unit_id', 'units'],
        ['sales_order_lines', 'tax_code_id', 'tax_codes'],
        ['sales_order_lines', 'warehouse_id', 'warehouses'],
        ['sales_delivery_lines', 'item_id', 'items'],
        ['sales_delivery_lines', 'unit_id', 'units'],
        ['sales_delivery_lines', 'tax_code_id', 'tax_codes'],
        ['sales_delivery_lines', 'warehouse_id', 'warehouses'],
        ['sales_invoice_lines', 'item_id', 'items'],
        ['sales_invoice_lines', 'unit_id', 'units'],
        ['sales_invoice_lines', 'tax_code_id', 'tax_codes'],
        ['sales_invoice_lines', 'warehouse_id', 'warehouses'],
        ['sales_return_lines', 'item_id', 'items'],
        ['sales_return_lines', 'unit_id', 'units'],
        ['sales_return_lines', 'tax_code_id', 'tax_codes'],
        ['sales_return_lines', 'warehouse_id', 'warehouses'],
    ];

    /** @return list<array{0: string, 1: string, 2: string, 3: string}> */
    public static function purchasingKeys(): array
    {
        return [
            ['purchase_requests', 'company_id', 'companies', 'id'],
            ['purchase_rfqs', 'company_id', 'companies', 'id'],
            ['purchase_orders', 'company_id', 'companies', 'id'],
            ['purchase_receipts', 'company_id', 'companies', 'id'],
            ['purchase_invoices', 'company_id', 'companies', 'id'],
            ['purchase_returns', 'company_id', 'companies', 'id'],
            ['purchase_request_lines', 'company_id', 'companies', 'id'],
            ['purchase_rfq_lines', 'company_id', 'companies', 'id'],
            ['purchase_order_lines', 'company_id', 'companies', 'id'],
            ['purchase_receipt_lines', 'company_id', 'companies', 'id'],
            ['purchase_invoice_lines', 'company_id', 'companies', 'id'],
            ['purchase_return_lines', 'company_id', 'companies', 'id'],
            ['purchase_rfq_suppliers', 'company_id', 'companies', 'id'],
            ['purchase_rfq_quotes', 'company_id', 'companies', 'id'],
            ['purchase_payable_applications', 'company_id', 'companies', 'id'],
            ['purchase_payable_applications', 'created_by', 'users', 'id'],
            ['purchase_requests', 'currency_code', 'currencies', 'code'],
            ['purchase_requests', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_requests', 'created_by', 'users', 'id'],
            ['purchase_requests', 'cost_center_id', 'cost_centers', 'id'],
            ['purchase_requests', 'project_id', 'projects', 'id'],
            ['purchase_rfqs', 'currency_code', 'currencies', 'code'],
            ['purchase_rfqs', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_rfqs', 'created_by', 'users', 'id'],
            ['purchase_orders', 'currency_code', 'currencies', 'code'],
            ['purchase_orders', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_orders', 'created_by', 'users', 'id'],
            ['purchase_orders', 'cost_center_id', 'cost_centers', 'id'],
            ['purchase_orders', 'project_id', 'projects', 'id'],
            ['purchase_orders', 'party_id', 'parties', 'id'],
            ['purchase_orders', 'payment_term_id', 'payment_terms', 'id'],
            ['purchase_receipts', 'currency_code', 'currencies', 'code'],
            ['purchase_receipts', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_receipts', 'created_by', 'users', 'id'],
            ['purchase_receipts', 'cost_center_id', 'cost_centers', 'id'],
            ['purchase_receipts', 'project_id', 'projects', 'id'],
            ['purchase_receipts', 'party_id', 'parties', 'id'],
            ['purchase_receipts', 'payment_term_id', 'payment_terms', 'id'],
            ['purchase_invoices', 'currency_code', 'currencies', 'code'],
            ['purchase_invoices', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_invoices', 'created_by', 'users', 'id'],
            ['purchase_invoices', 'cost_center_id', 'cost_centers', 'id'],
            ['purchase_invoices', 'project_id', 'projects', 'id'],
            ['purchase_invoices', 'party_id', 'parties', 'id'],
            ['purchase_invoices', 'payment_term_id', 'payment_terms', 'id'],
            ['purchase_returns', 'currency_code', 'currencies', 'code'],
            ['purchase_returns', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_returns', 'created_by', 'users', 'id'],
            ['purchase_returns', 'cost_center_id', 'cost_centers', 'id'],
            ['purchase_returns', 'project_id', 'projects', 'id'],
            ['purchase_returns', 'party_id', 'parties', 'id'],
            ['purchase_returns', 'payment_term_id', 'payment_terms', 'id'],
            ['purchase_request_lines', 'item_id', 'items', 'id'],
            ['purchase_request_lines', 'variant_id', 'item_variants', 'id'],
            ['purchase_request_lines', 'unit_id', 'units', 'id'],
            ['purchase_request_lines', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_rfq_lines', 'item_id', 'items', 'id'],
            ['purchase_rfq_lines', 'variant_id', 'item_variants', 'id'],
            ['purchase_rfq_lines', 'unit_id', 'units', 'id'],
            ['purchase_order_lines', 'item_id', 'items', 'id'],
            ['purchase_order_lines', 'variant_id', 'item_variants', 'id'],
            ['purchase_order_lines', 'unit_id', 'units', 'id'],
            ['purchase_order_lines', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_order_lines', 'tax_code_id', 'tax_codes', 'id'],
            ['purchase_order_lines', 'withholding_code_id', 'tax_codes', 'id'],
            ['purchase_receipt_lines', 'item_id', 'items', 'id'],
            ['purchase_receipt_lines', 'variant_id', 'item_variants', 'id'],
            ['purchase_receipt_lines', 'unit_id', 'units', 'id'],
            ['purchase_receipt_lines', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_receipt_lines', 'tax_code_id', 'tax_codes', 'id'],
            ['purchase_receipt_lines', 'withholding_code_id', 'tax_codes', 'id'],
            ['purchase_invoice_lines', 'item_id', 'items', 'id'],
            ['purchase_invoice_lines', 'variant_id', 'item_variants', 'id'],
            ['purchase_invoice_lines', 'unit_id', 'units', 'id'],
            ['purchase_invoice_lines', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_invoice_lines', 'tax_code_id', 'tax_codes', 'id'],
            ['purchase_invoice_lines', 'withholding_code_id', 'tax_codes', 'id'],
            ['purchase_return_lines', 'item_id', 'items', 'id'],
            ['purchase_return_lines', 'variant_id', 'item_variants', 'id'],
            ['purchase_return_lines', 'unit_id', 'units', 'id'],
            ['purchase_return_lines', 'warehouse_id', 'warehouses', 'id'],
            ['purchase_return_lines', 'tax_code_id', 'tax_codes', 'id'],
            ['purchase_return_lines', 'withholding_code_id', 'tax_codes', 'id'],
            ['purchase_requests', 'approval_request_id', 'approval_requests', 'id'],
            ['purchase_orders', 'approval_request_id', 'approval_requests', 'id'],
            ['purchase_invoices', 'approval_request_id', 'approval_requests', 'id'],
            ['purchase_requests', 'requested_by', 'users', 'id'],
            ['purchase_request_lines', 'suggested_supplier_id', 'parties', 'id'],
            ['purchase_rfqs', 'awarded_by', 'users', 'id'],
            ['purchase_rfq_lines', 'awarded_party_id', 'parties', 'id'],
            ['purchase_rfq_suppliers', 'party_id', 'parties', 'id'],
            ['purchase_rfq_quotes', 'party_id', 'parties', 'id'],
            ['purchase_orders', 'approved_by', 'users', 'id'],
            ['purchase_receipts', 'stock_document_id', 'stock_documents', 'id'],
            ['purchase_receipts', 'reversal_stock_document_id', 'stock_documents', 'id'],
            ['purchase_receipts', 'journal_entry_id', 'journal_entries', 'id'],
            ['purchase_receipts', 'posted_by', 'users', 'id'],
            ['purchase_receipts', 'cancelled_by', 'users', 'id'],
            ['purchase_receipt_lines', 'location_id', 'locations', 'id'],
            ['purchase_invoices', 'journal_entry_id', 'journal_entries', 'id'],
            ['purchase_invoices', 'reversal_journal_entry_id', 'journal_entries', 'id'],
            ['purchase_invoices', 'match_override_by', 'users', 'id'],
            ['purchase_invoices', 'approved_by', 'users', 'id'],
            ['purchase_invoices', 'booked_by', 'users', 'id'],
            ['purchase_invoices', 'reversed_by', 'users', 'id'],
            ['purchase_returns', 'stock_document_id', 'stock_documents', 'id'],
            ['purchase_returns', 'journal_entry_id', 'journal_entries', 'id'],
            ['purchase_returns', 'approved_by', 'users', 'id'],
            ['purchase_returns', 'shipped_by', 'users', 'id'],
            ['purchase_returns', 'debited_by', 'users', 'id'],
        ];
    }

    public function __construct(private readonly Connection $db) {}

    /**
     * Every key the integration migrations add, as table, column, referenced table and column.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function companyKeys(): array
    {
        return array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::COMPANY_TABLES);
    }

    /**
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function crossModuleKeys(): array
    {
        return array_values(array_map(static fn (array $key): array => [$key[0], $key[1], $key[2], $key[3]], self::CROSS_MODULE));
    }

    /**
     * Keys of the Accounting integration migration: company_id of every Accounting table, then the
     * cross-module references.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function accountingKeys(): array
    {
        return [
            ...array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::ACCOUNTING_COMPANY_TABLES),
            ...self::ACCOUNTING_CROSS_MODULE,
        ];
    }

    /**
     * Keys of the Inventory integration migration: company_id of every Inventory table, then the
     * cross-module references.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function inventoryKeys(): array
    {
        return [
            ...array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::INVENTORY_COMPANY_TABLES),
            ...self::INVENTORY_CROSS_MODULE,
        ];
    }

    /**
     * Keys of the Sales integration migration: company_id of every Sales table, then the
     * cross-module references.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function salesKeys(): array
    {
        return [
            ...array_map(static fn (string $table): array => [$table, 'company_id', 'companies', 'id'], self::SALES_COMPANY_TABLES),
            ...self::SALES_CROSS_MODULE,
        ];
    }

    /**
     * Orphan counts per "table.column" (only entries with orphans), for the given keys.
     *
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     * @return array<string, int>
     */
    public function orphans(array $keys): array
    {
        $found = [];
        foreach ($keys as [$table, $column, $references, $key]) {
            if (! $this->present($table, $references)) {
                continue;
            }
            $count = $this->orphanQuery($table, $column, $references, $key)->count();
            if ($count > 0) {
                $found["{$table}.{$column}"] = $count;
            }
        }

        return $found;
    }

    /**
     * Fails with the orphan counts before a migration adds foreign keys; nothing is changed.
     *
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     */
    public function assertNoOrphans(array $keys, ?string $hint = null): void
    {
        $orphans = $this->orphans($keys);
        if ($orphans === []) {
            return;
        }
        $lines = array_map(static fn (string $ref, int $count): string => "  {$ref}: {$count}", array_keys($orphans), $orphans);

        throw new RuntimeException(
            "Cannot add foreign keys: rows reference missing records.\n".implode("\n", $lines)."\n"
            .($hint ?? 'Review them with `php artisan master-data:repair-orphans --dry-run`; the command clears the references '
            .'that may become empty, the others need a manual fix. Then run the migration again.'),
        );
    }

    /**
     * Clears repairable orphan references (NULL, version + 1, updated_at now). Returns per
     * "table.column": [count, repaired]; unrepairable ones are reported with repaired = false.
     *
     * @return array<string, array{0: int, 1: bool}>
     */
    public function repairOrphans(bool $dryRun): array
    {
        $report = [];
        $keys = [...array_map(static fn (array $key): array => [...$key, false], self::companyKeys()), ...self::CROSS_MODULE];
        $this->db->transaction(function () use ($keys, $dryRun, &$report): void {
            foreach ($keys as [$table, $column, $references, $key, $repairable]) {
                if (! $this->present($table, $references)) {
                    continue;
                }
                $count = $this->orphanQuery($table, $column, $references, $key)->count();
                if ($count === 0) {
                    continue;
                }
                $report["{$table}.{$column}"] = [$count, $repairable && ! $dryRun];
                if ($repairable && ! $dryRun) {
                    $changes = [$column => null, 'updated_at' => now()];
                    if (Schema::connection($this->db->getName())->hasColumn($table, 'version')) {
                        $changes['version'] = $this->db->raw('version + 1');
                    }
                    $this->orphanQuery($table, $column, $references, $key)->update($changes);
                }
            }
        });

        return $report;
    }

    /**
     * Rows referencing a record of another company, per "table.column".
     *
     * @return array<string, int>
     */
    public function tenancyViolations(): array
    {
        $found = [];
        foreach ([...self::TENANT_REFERENCES, ...array_filter(self::purchasingKeys(), static fn (array $key): bool => ! in_array($key[2], ['companies', 'users', 'currencies'], true))] as [$table, $column, $references]) {
            if (! $this->present($table, $references)) {
                continue;
            }
            $count = $this->db->table($table)
                ->join("{$references} as ref", 'ref.id', '=', "{$table}.{$column}")
                ->whereNotNull('ref.company_id')
                ->whereColumn('ref.company_id', '<>', "{$table}.company_id")
                ->count();
            if ($count > 0) {
                $found["{$table}.{$column}"] = $count;
            }
        }

        return $found;
    }

    /**
     * Adds the keys for populated databases: orphans are refused first (clear message, no repair);
     * each key is added NOT VALID in its own short statement (new writes are checked, existing rows
     * are not scanned under the strong lock), then validated in separate statements, which only
     * take a lock that does not block reads or writes. Run outside a migration transaction. Keys
     * that already exist (re-run after a failure) are kept; missing tables are skipped.
     *
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     */
    public function addKeys(array $keys, ?string $hint = null): void
    {
        $keys = array_values(array_filter($keys, fn (array $key): bool => $this->present($key[0], $key[2])));
        $this->assertNoOrphans($keys, $hint);
        foreach ($keys as [$table, $column, $references, $key]) {
            if (! $this->constraintExists($table, self::constraintName($table, $column))) {
                $this->db->statement(sprintf(
                    'ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID',
                    $table, self::constraintName($table, $column), $column, $references, $key,
                ));
            }
        }
        foreach ($keys as [$table, $column]) {
            $this->db->statement(sprintf('ALTER TABLE %s VALIDATE CONSTRAINT %s', $table, self::constraintName($table, $column)));
        }
    }

    /**
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $keys
     */
    public function dropKeys(array $keys): void
    {
        foreach (array_reverse($keys) as [$table, $column]) {
            if (Schema::connection($this->db->getName())->hasTable($table)) {
                $this->db->statement(sprintf('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s', $table, self::constraintName($table, $column)));
            }
        }
    }

    /** Laravel's naming, so the keys look like any other foreign key of the schema. */
    public static function constraintName(string $table, string $column): string
    {
        return "{$table}_{$column}_foreign";
    }

    private function constraintExists(string $table, string $name): bool
    {
        return $this->db->table('pg_constraint')
            ->join('pg_class', 'pg_class.oid', '=', 'pg_constraint.conrelid')
            ->where('pg_constraint.conname', $name)->where('pg_class.relname', $table)->exists();
    }

    private function orphanQuery(string $table, string $column, string $references, string $key): Builder
    {
        return $this->db->table($table)->whereNotNull($column)->whereNotExists(
            fn (Builder $q) => $q->selectRaw('1')->from($references)->whereColumn("{$references}.{$key}", "{$table}.{$column}"),
        );
    }

    private function present(string $table, string $references): bool
    {
        $schema = Schema::connection($this->db->getName());

        return $schema->hasTable($table) && $schema->hasTable($references);
    }
}
