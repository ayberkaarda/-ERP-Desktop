// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

import type { CommonSamples } from './common'
import type { DeviceLoginRequest } from './device-login.request'
import type { DeviceRefreshRequest } from './device-refresh.request'
import type { DeviceTokenResponse } from './device-token.response'
import type { ErrorCode } from './error-codes'
import type { ErrorResponse } from './error.response'
import type { ManifestResponse } from './manifest.response'
import type { PullRequest } from './pull.request'
import type { PullResponse } from './pull.response'
import type { PushRequest } from './push.request'
import type { PushResponse } from './push.response'
import type { Tombstone } from './tombstone'

/** contracts/sync/fixtures/*.json, each checked against its schema type. */
export const VALID_FIXTURES = {
  'common.sample.json': {
    "uuid": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10",
    "uuidv7": "0193b1f0-1111-7aaa-8bbb-000000000001",
    "xid8": "48213907",
    "cursor": {
      "txid": "48213907",
      "after_id": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10",
      "gen": 0,
      "session": "i_q3Zb7Yk2Lw9pM0cVf4HtGxR8nJ1eSdA6uBoC5yTiEzk"
    },
    "resource_name": "price-lists.lines",
    "timestamp": "2026-10-26T09:15:00+03:00",
    "schema_version": 1,
    "permission": "sales.quotes.create",
    "requires": {
      "any_of": [
        "units.manage",
        "items.view"
      ]
    },
    "api_error": {
      "message": "Belge artık taslak değil.",
      "code": "DOCUMENT_LOCKED"
    },
    "meta": {},
    "visibility_generation": 3,
    "scope": "company_or_global"
  } satisfies CommonSamples,
  'device-login.request.with-2fa.json': {
    "email": "satis@ornek.com.tr",
    "password": "correct horse battery staple",
    "two_factor_code": "482913",
    "device_name": "Satış dizüstü - Ayşe",
    "fingerprint": "b3f1c9e2a7d64f0e9a51c2d8e4b7a6f3"
  } satisfies DeviceLoginRequest,
  'device-refresh.request.rotate.json': {
    "refresh_token": "rt_9f2c4e7a1b8d3f6e0a5c9b2d7e4f1a8c3b6d9e2f5a8c1b4d"
  } satisfies DeviceRefreshRequest,
  'device-token.response.login.json': {
    "data": {
      "token": "7|Qm9yQ2xvdWRzQXJlTm90RGF0YQ0123456789abcdef",
      "expires_at": "2026-10-26T10:15:00+03:00",
      "refresh_token": "rt_9f2c4e7a1b8d3f6e0a5c9b2d7e4f1a8c3b6d9e2f5a8c1b4d",
      "refresh_expires_at": "2026-11-25T09:15:00+03:00"
    },
    "meta": {}
  } satisfies DeviceTokenResponse,
  'error-codes.document-locked.json': "DOCUMENT_LOCKED" satisfies ErrorCode,
  'error-codes.version-conflict.json': "VERSION_CONFLICT" satisfies ErrorCode,
  'error.response.schema-mismatch.json': {
    "errors": {
      "message": "İstemci sürümü desteklenmiyor; lütfen güncelleyin.",
      "code": "SYNC_SCHEMA_MISMATCH"
    }
  } satisfies ErrorResponse,
  'error.response.validation.json': {
    "errors": {
      "message": "Gönderilen veri geçersiz.",
      "code": "VALIDATION_ERROR",
      "fields": {
        "resources.1.resource": [
          "Kaynak bu istekte iki kez geçiyor."
        ]
      }
    }
  } satisfies ErrorResponse,
  'manifest.response.sales-user.json': {
    "data": {
      "schema_version": 1,
      "min_schema_version": 1,
      "offline_manifest_version": 1,
      "server_time": "2026-10-26T09:15:00+03:00",
      "company_id": "01937a2c-5b10-7a3e-9f21-6c0d4e8b1a01",
      "user_id": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
      "device_id": "01937a2c-6f22-7e04-a1b3-9c8d7e6f5a03",
      "permissions": [
        "currencies.view",
        "items.view",
        "parties.create",
        "parties.view",
        "price_lists.view",
        "sales.orders.create",
        "sales.orders.update",
        "sales.orders.view",
        "sales.quotes.create",
        "sales.quotes.update",
        "sales.quotes.view",
        "tax_codes.view"
      ],
      "resources": [
        {
          "resource": "parties",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [
            "create"
          ],
          "visibility_generation": 0
        },
        {
          "resource": "items",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "items.variants",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 4
        },
        {
          "resource": "items.barcodes",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "price-lists",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "price-lists.lines",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "sales-quotes",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": 30,
          "writable": [
            "create",
            "update"
          ],
          "visibility_generation": 2
        },
        {
          "resource": "sales-orders",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": 30,
          "writable": [
            "create",
            "update"
          ],
          "visibility_generation": 0
        },
        {
          "resource": "currencies",
          "scope": "global_with_company_activation",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "tax-codes",
          "scope": "company_or_global",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        }
      ],
      "online_only": [
        "finalizeSalesQuote",
        "confirmSalesOrder",
        "serverCalculation"
      ],
      "limits": {
        "pull_resources_max": 20,
        "pull_page_default": 200,
        "pull_page_max": 1000,
        "push_batch_max": 100,
        "tombstone_retention_days": 90,
        "idempotency_retention_days": 7
      }
    },
    "meta": {}
  } satisfies ManifestResponse,
  'offline-manifest.query-fields.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      },
      {
        "resource": "sales-invoices",
        "module": "Sales",
        "scope": "company",
        "path": "/api/v1/sales-invoices",
        "detail_path": "/api/v1/sales-invoices/{id}",
        "api_resource": "App\\Modules\\Sales\\Http\\Resources\\DocumentResource",
        "requires": {
          "all_of": [
            "sales.invoices.view"
          ]
        },
        "read": "online-first",
        "source": "pull",
        "window_days": 30,
        "window_field": "document_date",
        "query": {
          "default_sort": [
            "-document_date",
            "-created_at"
          ],
          "sort": {
            "document_date": {
              "type": "date"
            },
            "total": {
              "type": "decimal"
            }
          },
          "filters": {
            "status": {
              "match": "eq",
              "type": "string"
            },
            "date_from": {
              "field": "document_date",
              "match": "gte",
              "type": "date"
            },
            "date_to": {
              "field": "document_date",
              "match": "lte",
              "type": "date"
            },
            "number": {
              "match": "contains",
              "type": "string"
            }
          }
        }
      },
      {
        "resource": "stock-balances",
        "module": "Inventory",
        "scope": "company",
        "path": "/api/v1/stock-balances",
        "requires": {
          "all_of": [
            "inventory.stock.view"
          ]
        },
        "read": "offline-fallback",
        "source": "snapshot"
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'pull.request.initial-and-incremental.json': {
    "schema_version": 1,
    "resources": [
      {
        "resource": "parties",
        "cursor": null
      },
      {
        "resource": "sales-quotes",
        "cursor": {
          "txid": "48213907",
          "after_id": null,
          "gen": 2,
          "session": "i_q3Zb7Yk2Lw9pM0cVf4HtGxR8nJ1eSdA6uBoC5yTiEzk"
        },
        "limit": 200
      },
      {
        "resource": "items.variants",
        "cursor": {
          "txid": "48210002",
          "after_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b31",
          "gen": 3,
          "session": "i_q3Zb7Yk2Lw9pM0cVf4HtGxR8nJ1eSdA6uBoC5yTiEzk"
        }
      }
    ]
  } satisfies PullRequest,
  'pull.response.page.json': {
    "data": {
      "horizon": "48214001",
      "server_time": "2026-10-26T09:15:02+03:00",
      "resources": [
        {
          "resource": "parties",
          "rows": [
            {
              "id": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10",
              "company_id": "01937a2c-5b10-7a3e-9f21-6c0d4e8b1a01",
              "code": "C-00042",
              "name": "Anadolu Yapı Market",
              "legal_name": "Anadolu Yapı Market Ltd. Şti.",
              "type": "company",
              "roles": [
                "customer"
              ],
              "tax_office": "Kadıköy",
              "tax_number": "1234567890",
              "country": "TR",
              "default_currency_code": "TRY",
              "payment_term_id": null,
              "price_list_id": null,
              "risk_limit": "250000.0000",
              "risk_currency_code": "TRY",
              "is_active": true,
              "notes": null,
              "tags": [],
              "version": 3,
              "created_at": "2026-09-02T10:00:00+03:00",
              "updated_at": "2026-10-24T14:31:09+03:00",
              "addresses": [],
              "contacts": [],
              "bank_accounts": []
            }
          ],
          "tombstones": [],
          "next_cursor": {
            "txid": "48213120",
            "after_id": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10",
            "gen": 0,
            "session": "0193b1f2-5e55-7a10-9c33-0d1e2f3a4b5c"
          },
          "has_more": true,
          "reset": false
        },
        {
          "resource": "sales-quotes",
          "rows": [],
          "tombstones": [
            {
              "resource": "sales-quotes",
              "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a21",
              "sync_txid": "48213960",
              "deleted_at": "2026-10-26T08:59:41+03:00",
              "reason": "deleted"
            }
          ],
          "next_cursor": {
            "txid": "48214001",
            "after_id": null,
            "gen": 0,
            "session": "i_q3Zb7Yk2Lw9pM0cVf4HtGxR8nJ1eSdA6uBoC5yTiEzk"
          },
          "has_more": false,
          "reset": false
        },
        {
          "resource": "items.variants",
          "rows": [],
          "tombstones": [],
          "next_cursor": {
            "txid": "48214001",
            "after_id": null,
            "gen": 4,
            "session": "i_q3Zb7Yk2Lw9pM0cVf4HtGxR8nJ1eSdA6uBoC5yTiEzk"
          },
          "has_more": false,
          "reset": true,
          "reset_reason": "visibility_changed"
        }
      ]
    },
    "meta": {}
  } satisfies PullResponse,
  'push.request.outbox-batch.json': {
    "schema_version": 1,
    "mutations": [
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000004",
        "op": "create",
        "resource": "parties",
        "id": "0193b1e8-0000-7d30-8333-7a8b9c0d1e60",
        "base_version": null,
        "changed_fields": [],
        "occurred_at": "2026-10-25T18:00:30+03:00",
        "payload": {
          "name": "Ege Hırdavat",
          "type": "company",
          "roles": [
            "customer"
          ],
          "tax_number": "9876543210",
          "country": "TR"
        }
      },
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000001",
        "op": "create",
        "resource": "sales-quotes",
        "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20",
        "base_version": null,
        "changed_fields": [],
        "occurred_at": "2026-10-25T18:02:11+03:00",
        "payload": {
          "document_date": "2026-10-25",
          "party_id": "0193b1e8-0000-7d30-8333-7a8b9c0d1e60",
          "currency_code": "TRY",
          "valid_until": "2026-11-24",
          "lines": [
            {
              "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b30",
              "quantity": "12",
              "unit_price": "149.90",
              "tax_code_id": "0193a000-0000-7000-8000-00000000c020"
            }
          ]
        },
        "depends_on": [
          "0193b1f0-1111-7aaa-8bbb-000000000004"
        ]
      },
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000002",
        "op": "update",
        "resource": "sales-orders",
        "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
        "base_version": 4,
        "changed_fields": [
          "notes"
        ],
        "occurred_at": "2026-10-25T18:05:40+03:00",
        "payload": {
          "notes": "Teslimat cuma öğleden sonra."
        }
      },
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000003",
        "op": "action",
        "action": "counts",
        "resource": "stock-documents",
        "id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d50",
        "base_version": 2,
        "changed_fields": [
          "counts"
        ],
        "occurred_at": "2026-10-25T18:10:00+03:00",
        "payload": {
          "counts": [
            {
              "line_id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d51",
              "counted_quantity": "38"
            },
            {
              "line_id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d52",
              "counted_quantity": null
            }
          ]
        }
      },
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000008",
        "op": "delete",
        "resource": "purchase-requests",
        "id": "0193b1e9-1200-7e40-9444-8b9c0d1e2f70",
        "base_version": 3,
        "changed_fields": [],
        "occurred_at": "2026-10-25T18:15:00+03:00",
        "payload": {}
      },
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-00000000000a",
        "op": "create",
        "resource": "parties",
        "id": "0193b1e8-0000-7d30-8333-7a8b9c0d1e61",
        "base_version": null,
        "changed_fields": [],
        "occurred_at": "2026-10-26T09:20:00+03:00",
        "payload": {
          "name": "Anadolu Yapı Market Şube",
          "type": "company",
          "roles": [
            "customer"
          ],
          "tax_number": "1234567890",
          "country": "TR"
        },
        "resolution": {
          "resolves": "0193b1f0-1111-7aaa-8bbb-000000000009",
          "code": "DUPLICATE_RECORD",
          "choice": "keep_mine"
        }
      }
    ]
  } satisfies PushRequest,
  'push.response.mixed.json': {
    "data": {
      "results": [
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000001",
          "resource": "sales-quotes",
          "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20",
          "status": "applied",
          "replayed": false,
          "version": 1,
          "data": {
            "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20",
            "document_type": "sales_quote",
            "number": "QUO2026000000118",
            "status": "draft",
            "document_date": "2026-10-25",
            "party_id": "0193b1e8-0000-7d30-8333-7a8b9c0d1e60",
            "party_name": "Ege Hırdavat",
            "party_tax_office": null,
            "party_tax_number": "9876543210",
            "billing_address": null,
            "currency_code": "TRY",
            "fx_rate": "1.000000",
            "payment_term_id": null,
            "due_date": null,
            "price_list_id": null,
            "warehouse_id": null,
            "cost_center_id": null,
            "project_id": null,
            "notes": null,
            "internal_notes": null,
            "source_type": null,
            "source_id": null,
            "subtotal": "1798.8000",
            "discount_total": "0.0000",
            "tax_total": "359.7600",
            "total": "2158.5600",
            "subtotal_local": "1798.8000",
            "discount_total_local": "0.0000",
            "tax_total_local": "359.7600",
            "total_local": "2158.5600",
            "valid_until": "2026-11-24",
            "revision": 1,
            "previous_revision_id": null,
            "converted_order_id": null,
            "sent_at": null,
            "accepted_at": null,
            "rejected_at": null,
            "rejection_reason": null,
            "version": 1,
            "created_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
            "created_at": "2026-10-26T09:15:01+03:00",
            "updated_at": "2026-10-26T09:15:01+03:00",
            "lines": [
              {
                "id": "0193b2a0-0001-7b00-8a00-0000000000a1",
                "line_no": 1,
                "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b30",
                "variant_id": null,
                "item_type": "stock",
                "description": "Vida seti 4x40",
                "quantity": "12.000000",
                "unit_id": "0193a000-0000-7000-8000-0000000000b1",
                "base_quantity": "12.000000",
                "unit_price": "149.900000",
                "tax_inclusive": false,
                "discount_percent": "0.0000",
                "discount_amount": "0.0000",
                "gross_amount": "1798.8000",
                "line_discount": "0.0000",
                "net_amount": "1798.8000",
                "tax_code_id": "0193a000-0000-7000-8000-00000000c020",
                "tax_rate": "20.0000",
                "tax_amount": "359.7600",
                "line_total": "2158.5600",
                "warehouse_id": null,
                "source_line_id": null,
                "price_source": "manual"
              }
            ]
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000002",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
          "status": "conflict",
          "replayed": false,
          "conflict": {
            "code": "DOCUMENT_LOCKED",
            "message": "Sipariş onaylandığı için değiştirilemez.",
            "base_version": 4,
            "server_version": 6,
            "conflicting_fields": [],
            "server_data": {
              "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
              "document_type": "sales_order",
              "number": "ORD2026000000042",
              "status": "confirmed",
              "document_date": "2026-10-24",
              "party_id": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10",
              "party_name": "Anadolu Yapı Market",
              "party_tax_office": "Kadıköy",
              "party_tax_number": "1234567890",
              "billing_address": {
                "line1": "Bağdat Cad. 120",
                "city": "İstanbul",
                "country": "TR"
              },
              "currency_code": "TRY",
              "fx_rate": "1.000000",
              "payment_term_id": null,
              "due_date": null,
              "price_list_id": null,
              "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
              "cost_center_id": null,
              "project_id": null,
              "notes": null,
              "internal_notes": null,
              "source_type": null,
              "source_id": null,
              "subtotal": "4497.0000",
              "discount_total": "0.0000",
              "tax_total": "899.4000",
              "total": "5396.4000",
              "subtotal_local": "4497.0000",
              "discount_total_local": "0.0000",
              "tax_total_local": "899.4000",
              "total_local": "5396.4000",
              "requested_delivery_date": "2026-10-30",
              "quote_id": null,
              "revision": 1,
              "credit_override_reason": null,
              "credit_override_by": null,
              "approval_request_id": null,
              "approval_comment": null,
              "confirmed_at": "2026-10-25T15:02:00+03:00",
              "confirmed_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b03",
              "cancelled_at": null,
              "closed_at": null,
              "version": 6,
              "created_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
              "created_at": "2026-10-24T11:20:00+03:00",
              "updated_at": "2026-10-25T15:02:00+03:00",
              "lines": [
                {
                  "id": "0193b2a0-0004-7b00-8a00-0000000000a4",
                  "line_no": 1,
                  "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b30",
                  "variant_id": null,
                  "item_type": "stock",
                  "description": "Vida seti 4x40",
                  "quantity": "30.000000",
                  "unit_id": "0193a000-0000-7000-8000-0000000000b1",
                  "base_quantity": "30.000000",
                  "unit_price": "149.900000",
                  "tax_inclusive": false,
                  "discount_percent": "0.0000",
                  "discount_amount": "0.0000",
                  "gross_amount": "4497.0000",
                  "line_discount": "0.0000",
                  "net_amount": "4497.0000",
                  "tax_code_id": "0193a000-0000-7000-8000-00000000c020",
                  "tax_rate": "20.0000",
                  "tax_amount": "899.4000",
                  "line_total": "5396.4000",
                  "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
                  "source_line_id": null,
                  "price_source": "manual",
                  "delivered_quantity": "0.000000",
                  "invoiced_quantity": "0.000000",
                  "reservation_id": null
                }
              ]
            },
            "choices": [
              "save_as_new_draft",
              "discard"
            ]
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000003",
          "resource": "stock-documents",
          "id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d50",
          "status": "duplicate",
          "replayed": true,
          "version": 3,
          "data": {
            "id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d50",
            "doc_type": "count",
            "number": "CNT2026000000007",
            "status": "draft",
            "document_date": "2026-10-25",
            "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
            "target_warehouse_id": null,
            "reason": null,
            "notes": null,
            "offset_event": null,
            "allow_expired": false,
            "source_type": null,
            "source_id": null,
            "journal_entry_id": null,
            "frozen_at": "2026-10-25T08:00:00+03:00",
            "posted_at": null,
            "posted_by": null,
            "reversal_date": null,
            "reversal_reason": null,
            "reversal_journal_entry_id": null,
            "reversed_at": null,
            "reversed_by": null,
            "created_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
            "version": 3,
            "lines": [
              {
                "id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d51",
                "line_no": 1,
                "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b30",
                "unit_id": "0193a000-0000-7000-8000-0000000000b1",
                "quantity": "0.000000",
                "base_quantity": "0.000000",
                "unit_cost": null,
                "lot_no": null,
                "expiry_date": null,
                "serial_numbers": null,
                "location_id": null,
                "target_location_id": null,
                "direction": null,
                "system_quantity": "40.000000",
                "counted_quantity": "38.000000",
                "avg_cost": "92.1500",
                "difference": "-2.000000",
                "reservation_id": null,
                "notes": null
              },
              {
                "id": "0193b1e7-9a00-7c20-b222-6f7a8b9c0d52",
                "line_no": 2,
                "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b32",
                "unit_id": "0193a000-0000-7000-8000-0000000000b1",
                "quantity": "0.000000",
                "base_quantity": "0.000000",
                "unit_cost": null,
                "lot_no": null,
                "expiry_date": null,
                "serial_numbers": null,
                "location_id": null,
                "target_location_id": null,
                "direction": null,
                "system_quantity": "15.000000",
                "counted_quantity": null,
                "avg_cost": "12.4000",
                "difference": null,
                "reservation_id": null,
                "notes": null
              }
            ],
            "created_at": "2026-10-25T08:00:00+03:00",
            "updated_at": "2026-10-25T18:10:02+03:00"
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000008",
          "resource": "purchase-requests",
          "id": "0193b1e9-1200-7e40-9444-8b9c0d1e2f70",
          "status": "applied",
          "replayed": false,
          "data": null
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000009",
          "resource": "parties",
          "id": "0193b1e8-0000-7d30-8333-7a8b9c0d1e61",
          "status": "conflict",
          "replayed": true,
          "conflict": {
            "code": "DUPLICATE_RECORD",
            "base_version": null,
            "server_version": null,
            "conflicting_fields": [
              "tax_number"
            ],
            "server_data": null,
            "candidates": [
              "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10"
            ],
            "choices": [
              "use_existing",
              "keep_mine",
              "discard"
            ]
          }
        }
      ]
    },
    "meta": {}
  } satisfies PushResponse,
  'push.response.rejected-and-merged.json': {
    "data": {
      "results": [
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000005",
          "resource": "sales-quotes",
          "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a22",
          "status": "rejected",
          "replayed": true,
          "error": {
            "message": "Gönderilen veri geçersiz.",
            "code": "VALIDATION_ERROR",
            "fields": {
              "lines.0.quantity": [
                "Miktar sıfırdan büyük olmalıdır."
              ]
            }
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000006",
          "resource": "sales-quotes",
          "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a22",
          "status": "rejected",
          "replayed": false,
          "error": {
            "message": "Aynı kaydın önceki değişikliği uygulanamadı.",
            "code": "SYNC_DEPENDENCY_FAILED"
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-00000000000b",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c42",
          "status": "rejected",
          "replayed": false,
          "error": {
            "message": "Bildirilen değişen alanlar gönderilen alanlarla uyuşmuyor.",
            "code": "SYNC_CHANGED_FIELDS_MISMATCH",
            "fields": {
              "changed_fields": [
                "payload içinde bildirilmeyen alan: internal_notes"
              ]
            }
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-00000000000c",
          "resource": "purchase-requests",
          "id": "0193b1e9-1200-7e40-9444-8b9c0d1e2f71",
          "status": "conflict",
          "replayed": false,
          "conflict": {
            "code": "VERSION_CONFLICT",
            "message": "Kayıt siz çevrimdışıyken değişti; silme uygulanmadı.",
            "base_version": 2,
            "server_version": 3,
            "conflicting_fields": [],
            "server_data": {
              "id": "0193b1e9-1200-7e40-9444-8b9c0d1e2f71",
              "document_type": "purchase_request",
              "number": "PRQ2026000000015",
              "status": "draft",
              "document_date": "2026-10-22",
              "needed_by": "2026-11-05",
              "requested_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
              "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
              "cost_center_id": null,
              "project_id": null,
              "currency_code": "TRY",
              "notes": "Depo rafları için",
              "internal_notes": null,
              "estimated_total": "3750.0000",
              "approval_request_id": null,
              "approval_comment": null,
              "submitted_at": null,
              "approved_at": null,
              "rejected_at": null,
              "cancelled_at": null,
              "version": 3,
              "created_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
              "created_at": "2026-10-22T10:00:00+03:00",
              "updated_at": "2026-10-25T16:40:00+03:00",
              "lines": [
                {
                  "id": "0193b2a0-0003-7b00-8a00-0000000000a3",
                  "line_no": 1,
                  "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b33",
                  "variant_id": null,
                  "item_type": "stock",
                  "description": "Raf ayağı 200 cm",
                  "quantity": "25.000000",
                  "unit_id": "0193a000-0000-7000-8000-0000000000b1",
                  "base_quantity": "25.000000",
                  "estimated_price": "150.000000",
                  "estimated_total": "3750.0000",
                  "suggested_supplier_id": null,
                  "needed_by": "2026-11-05",
                  "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
                  "ordered_quantity": "0.0000"
                }
              ]
            },
            "choices": [
              "keep_mine",
              "take_server"
            ]
          }
        },
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000007",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c41",
          "status": "applied",
          "replayed": false,
          "version": 8,
          "merged_fields": [
            "notes"
          ],
          "data": {
            "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c41",
            "document_type": "sales_order",
            "number": "ORD2026000000043",
            "status": "draft",
            "document_date": "2026-10-24",
            "party_id": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10",
            "party_name": "Anadolu Yapı Market",
            "party_tax_office": "Kadıköy",
            "party_tax_number": "1234567890",
            "billing_address": {
              "line1": "Bağdat Cad. 120",
              "city": "İstanbul",
              "country": "TR"
            },
            "currency_code": "TRY",
            "fx_rate": "1.000000",
            "payment_term_id": null,
            "due_date": null,
            "price_list_id": null,
            "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
            "cost_center_id": null,
            "project_id": null,
            "notes": "Teslimat cuma öğleden sonra.",
            "internal_notes": "Depo ekibi bilgilendirildi.",
            "source_type": null,
            "source_id": null,
            "subtotal": "4497.0000",
            "discount_total": "0.0000",
            "tax_total": "899.4000",
            "total": "5396.4000",
            "subtotal_local": "4497.0000",
            "discount_total_local": "0.0000",
            "tax_total_local": "899.4000",
            "total_local": "5396.4000",
            "requested_delivery_date": "2026-10-30",
            "quote_id": null,
            "revision": 1,
            "credit_override_reason": null,
            "credit_override_by": null,
            "approval_request_id": null,
            "approval_comment": null,
            "confirmed_at": null,
            "confirmed_by": null,
            "cancelled_at": null,
            "closed_at": null,
            "version": 8,
            "created_by": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
            "created_at": "2026-10-24T11:20:00+03:00",
            "updated_at": "2026-10-26T09:15:03+03:00",
            "lines": [
              {
                "id": "0193b2a0-0002-7b00-8a00-0000000000a2",
                "line_no": 1,
                "item_id": "0193b1e3-77aa-7b10-8c20-1d2e3f4a5b30",
                "variant_id": null,
                "item_type": "stock",
                "description": "Vida seti 4x40",
                "quantity": "30.000000",
                "unit_id": "0193a000-0000-7000-8000-0000000000b1",
                "base_quantity": "30.000000",
                "unit_price": "149.900000",
                "tax_inclusive": false,
                "discount_percent": "0.0000",
                "discount_amount": "0.0000",
                "gross_amount": "4497.0000",
                "line_discount": "0.0000",
                "net_amount": "4497.0000",
                "tax_code_id": "0193a000-0000-7000-8000-00000000c020",
                "tax_rate": "20.0000",
                "tax_amount": "899.4000",
                "line_total": "5396.4000",
                "warehouse_id": "0193a000-0000-7000-8000-0000000000d1",
                "source_line_id": null,
                "price_source": "manual",
                "delivered_quantity": "0.000000",
                "invoiced_quantity": "0.000000",
                "reservation_id": null
              }
            ]
          }
        }
      ]
    },
    "meta": {}
  } satisfies PushResponse,
  'tombstone.out-of-scope.json': {
    "resource": "sales-quotes",
    "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a23",
    "sync_txid": "48213990",
    "deleted_at": "2026-10-26T09:01:12+03:00",
    "reason": "out_of_scope"
  } satisfies Tombstone,
  'tombstone.soft-deleted.json': {
    "resource": "parties",
    "id": "0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d11",
    "parent_id": null,
    "sync_txid": "48213950",
    "deleted_at": "2026-10-25T16:42:10+03:00",
    "reason": "soft_deleted"
  } satisfies Tombstone,
}

/** contracts/sync/fixtures/invalid/*.json: each one breaks its schema. */
export const INVALID_FIXTURES: Readonly<Record<string, unknown>> = {
  'invalid/device-refresh.request.with-fingerprint.json': {
    "refresh_token": "rt_9f2c4e7a1b8d3f6e0a5c9b2d7e4f1a8c3b6d9e2f5a8c1b4d",
    "fingerprint": "b3f1c9e2a7d64f0e9a51c2d8e4b7a6f3"
  },
  'invalid/device-token.response.missing-refresh-token.json': {
    "data": {
      "token": "7|Qm9yQ2xvdWRzQXJlTm90RGF0YQ0123456789abcdef",
      "expires_at": "2026-10-26T10:15:00+03:00",
      "refresh_expires_at": "2026-11-25T09:15:00+03:00"
    },
    "meta": {}
  },
  'invalid/manifest.response.missing-visibility-generation.json': {
    "data": {
      "schema_version": 1,
      "min_schema_version": 1,
      "offline_manifest_version": 1,
      "server_time": "2026-10-26T09:15:00+03:00",
      "company_id": "01937a2c-5b10-7a3e-9f21-6c0d4e8b1a01",
      "user_id": "01937a2c-5b10-7c11-8d42-2a9e7f3c5b02",
      "device_id": "01937a2c-6f22-7e04-a1b3-9c8d7e6f5a03",
      "permissions": [
        "currencies.view",
        "items.view",
        "parties.create",
        "parties.view",
        "price_lists.view",
        "sales.orders.create",
        "sales.orders.update",
        "sales.orders.view",
        "sales.quotes.create",
        "sales.quotes.update",
        "sales.quotes.view",
        "tax_codes.view"
      ],
      "resources": [
        {
          "resource": "parties",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [
            "create"
          ]
        },
        {
          "resource": "items",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "items.variants",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 4
        },
        {
          "resource": "items.barcodes",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "price-lists",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "price-lists.lines",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "sales-quotes",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": 30,
          "writable": [
            "create",
            "update"
          ],
          "visibility_generation": 2
        },
        {
          "resource": "sales-orders",
          "scope": "company",
          "read": "local-first",
          "source": "pull",
          "window_days": 30,
          "writable": [
            "create",
            "update"
          ],
          "visibility_generation": 0
        },
        {
          "resource": "currencies",
          "scope": "global_with_company_activation",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        },
        {
          "resource": "tax-codes",
          "scope": "company_or_global",
          "read": "local-first",
          "source": "pull",
          "window_days": null,
          "writable": [],
          "visibility_generation": 0
        }
      ],
      "online_only": [
        "finalizeSalesQuote",
        "confirmSalesOrder",
        "serverCalculation"
      ],
      "limits": {
        "pull_resources_max": 20,
        "pull_page_default": 200,
        "pull_page_max": 1000,
        "push_batch_max": 100,
        "tombstone_retention_days": 90,
        "idempotency_retention_days": 7
      }
    },
    "meta": {}
  },
  'invalid/offline-manifest.delete-field-merge.json': {
    "manifest_version": 1,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "sales-quotes",
        "module": "Sales",
        "scope": "company",
        "path": "/api/v1/sales-quotes",
        "detail_path": "/api/v1/sales-quotes/{id}",
        "api_resource": "App\\Modules\\Sales\\Http\\Resources\\DocumentResource",
        "requires": {
          "all_of": [
            "sales.quotes.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "write": {
          "mode": "draft-outbox",
          "ops": [
            {
              "op": "delete",
              "route": "DELETE /api/v1/sales-quotes/{id}",
              "requires": {
                "all_of": [
                  "sales.quotes.delete"
                ]
              },
              "version_check": "field-merge"
            }
          ],
          "draft_only": {
            "field": "status",
            "value": "draft"
          },
          "conflict": "field-merge"
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.field-merge-without-derived-fields.json': {
    "manifest_version": 1,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "sales-quotes",
        "module": "Sales",
        "scope": "company",
        "path": "/api/v1/sales-quotes",
        "detail_path": "/api/v1/sales-quotes/{id}",
        "api_resource": "App\\Modules\\Sales\\Http\\Resources\\DocumentResource",
        "requires": {
          "all_of": [
            "sales.quotes.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "write": {
          "mode": "draft-outbox",
          "ops": [
            {
              "op": "update",
              "route": "PATCH /api/v1/sales-quotes/{id}",
              "requires": {
                "all_of": [
                  "sales.quotes.update"
                ]
              },
              "version_check": "field-merge"
            }
          ],
          "draft_only": {
            "field": "status",
            "value": "draft"
          },
          "conflict": "field-merge"
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.global-scope-without-activation.json': {
    "manifest_version": 1,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "currencies",
        "module": "Reference",
        "scope": "global_with_company_activation",
        "path": "/api/v1/currencies",
        "detail_path": "/api/v1/currencies/{id}",
        "api_resource": "App\\Modules\\Reference\\Http\\Resources\\ReferenceResource",
        "requires": {
          "all_of": [
            "currencies.view"
          ]
        },
        "read": "local-first",
        "source": "pull"
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-bool-any-of.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "filters": {
            "is_active": {
              "match": "any_of",
              "type": "bool"
            }
          }
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-contains-on-uuid.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            },
            "x": {
              "match": "contains",
              "type": "uuid"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-default-sort-with-semicolon.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ],
          "default_sort": [
            "-code; drop"
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-element-field-with-eq.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "filters": {
            "item_id": {
              "field": "lines",
              "element_field": "item_id",
              "match": "eq",
              "type": "uuid"
            }
          }
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-empty-search-fields.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": []
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-field-dotted-path.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text",
              "field": "roles.0"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-filter-name-with-space.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            },
            "is active": {
              "match": "eq",
              "type": "bool"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-max-values-zero.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 0
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-on-snapshot.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "stock-balances",
        "module": "Inventory",
        "scope": "company",
        "path": "/api/v1/stock-balances",
        "requires": {
          "all_of": [
            "inventory.stock.view"
          ]
        },
        "read": "offline-fallback",
        "source": "snapshot",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            }
          }
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-online-only-free-text-param.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[x]' or 1=1",
              "reason": "r"
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-online-only-without-reason.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "online_only": [
            {
              "param": "filter[category]"
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-range-on-string.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "sales-invoices",
        "module": "Sales",
        "scope": "company",
        "path": "/api/v1/sales-invoices",
        "detail_path": "/api/v1/sales-invoices/{id}",
        "api_resource": "App\\Modules\\Sales\\Http\\Resources\\DocumentResource",
        "requires": {
          "all_of": [
            "sales.invoices.view"
          ]
        },
        "read": "online-first",
        "source": "pull",
        "window_days": 30,
        "window_field": "document_date",
        "query": {
          "filters": {
            "date_from": {
              "field": "document_date",
              "match": "gte",
              "type": "string"
            }
          }
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-search-field-json-path.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "$.name"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-sort-name-with-injection.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            },
            "a') OR 1=1 --": {
              "type": "text"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-sort-spec-unknown-key.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text",
              "collate": "C"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-sort-without-type.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "name": {
              "field": "name"
            }
          }
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-unknown-key.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ],
          "extra": true
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/offline-manifest.query-uppercase-name.json': {
    "manifest_version": 3,
    "sync_schema_version": 1,
    "api_prefix": "/api/v1",
    "defaults": {
      "recent_window_days": 30,
      "snapshot_refresh_minutes": 15
    },
    "resources": [
      {
        "resource": "parties",
        "module": "Parties",
        "scope": "company",
        "path": "/api/v1/parties",
        "detail_path": "/api/v1/parties/{id}",
        "api_resource": "App\\Modules\\Parties\\Http\\Resources\\PartyResource",
        "requires": {
          "all_of": [
            "parties.view"
          ]
        },
        "read": "local-first",
        "source": "pull",
        "query": {
          "sort": {
            "code": {
              "type": "text"
            },
            "name": {
              "type": "text"
            },
            "created_at": {
              "type": "datetime"
            },
            "Name": {
              "type": "text"
            }
          },
          "filters": {
            "is_active": {
              "match": "eq",
              "type": "bool"
            },
            "id": {
              "match": "eq",
              "type": "uuid",
              "max_values": 100
            },
            "role": {
              "field": "roles",
              "match": "any_of",
              "type": "string"
            }
          },
          "search": {
            "fields": [
              "name",
              "legal_name",
              "code",
              "tax_number"
            ]
          },
          "online_only": [
            {
              "param": "filter[category]",
              "reason": "Alt kategoriler sunucuda ağaçtan hesaplanır."
            }
          ]
        }
      }
    ],
    "online_only": [
      {
        "action": "decideApproval",
        "i18n_key": "desktop.onlineOnly.decideApproval",
        "category": "approve",
        "routes": [
          "POST /api/v1/approvals/{id}/decisions"
        ]
      }
    ]
  },
  'invalid/pull.request.cursor-without-gen.json': {
    "schema_version": 1,
    "resources": [
      {
        "resource": "parties",
        "cursor": {
          "txid": "48213907",
          "after_id": null,
          "session": null
        }
      }
    ]
  },
  'invalid/pull.request.numeric-txid.json': {
    "schema_version": 1,
    "resources": [
      {
        "resource": "parties",
        "cursor": {
          "txid": 48213907,
          "after_id": null,
          "gen": 0,
          "session": null
        }
      }
    ]
  },
  'invalid/pull.response.reset-without-reason.json': {
    "data": {
      "horizon": "48214001",
      "server_time": "2026-10-26T09:15:02+03:00",
      "resources": [
        {
          "resource": "parties",
          "rows": [],
          "tombstones": [],
          "next_cursor": {
            "txid": "48214001",
            "after_id": null,
            "gen": 1,
            "session": null
          },
          "has_more": false,
          "reset": true
        }
      ]
    },
    "meta": {}
  },
  'invalid/push.request.create-with-base-version.json': {
    "schema_version": 1,
    "mutations": [
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000009",
        "op": "create",
        "resource": "sales-quotes",
        "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a29",
        "base_version": 3,
        "changed_fields": [],
        "occurred_at": "2026-10-25T18:02:11+03:00",
        "payload": {}
      }
    ]
  },
  'invalid/push.request.delete-with-changed-fields.json': {
    "schema_version": 1,
    "mutations": [
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-0000000000f1",
        "resource": "sales-quotes",
        "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a30",
        "occurred_at": "2026-10-25T18:02:11+03:00",
        "op": "delete",
        "base_version": 3,
        "changed_fields": [
          "notes"
        ],
        "payload": {}
      }
    ]
  },
  'invalid/push.request.duplicate-resolution-merge.json': {
    "schema_version": 1,
    "mutations": [
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-0000000000f1",
        "resource": "parties",
        "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a30",
        "occurred_at": "2026-10-25T18:02:11+03:00",
        "op": "create",
        "base_version": null,
        "changed_fields": [],
        "payload": {
          "name": "X",
          "type": "company",
          "roles": [
            "customer"
          ]
        },
        "resolution": {
          "resolves": "0193b1f0-1111-7aaa-8bbb-000000000009",
          "code": "DUPLICATE_RECORD",
          "choice": "merge"
        }
      }
    ]
  },
  'invalid/push.request.payload-with-version.json': {
    "schema_version": 1,
    "mutations": [
      {
        "idempotency_key": "0193b1f0-1111-7aaa-8bbb-0000000000f1",
        "resource": "sales-quotes",
        "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a30",
        "occurred_at": "2026-10-25T18:02:11+03:00",
        "op": "update",
        "base_version": 3,
        "changed_fields": [
          "notes",
          "version"
        ],
        "payload": {
          "notes": "x",
          "version": 3
        }
      }
    ]
  },
  'invalid/push.response.applied-without-version.json': {
    "data": {
      "results": [
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-0000000000f2",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
          "status": "applied",
          "replayed": false,
          "data": {
            "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
            "status": "draft",
            "version": 5
          }
        }
      ]
    },
    "meta": {}
  },
  'invalid/push.response.conflict-without-detail.json': {
    "data": {
      "results": [
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-000000000002",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
          "status": "conflict",
          "replayed": false
        }
      ]
    },
    "meta": {}
  },
  'invalid/push.response.duplicate-not-replayed.json': {
    "data": {
      "results": [
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-0000000000f2",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
          "status": "duplicate",
          "replayed": false,
          "version": 5,
          "data": {
            "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
            "status": "draft",
            "version": 5
          }
        }
      ]
    },
    "meta": {}
  },
  'invalid/push.response.locked-with-keep-mine.json': {
    "data": {
      "results": [
        {
          "idempotency_key": "0193b1f0-1111-7aaa-8bbb-0000000000f2",
          "resource": "sales-orders",
          "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
          "status": "conflict",
          "replayed": false,
          "conflict": {
            "code": "DOCUMENT_LOCKED",
            "base_version": 4,
            "server_version": 6,
            "conflicting_fields": [],
            "server_data": {
              "id": "0193b1e6-4d00-7f10-a111-5e6f7a8b9c40",
              "status": "confirmed",
              "version": 6
            },
            "choices": [
              "keep_mine",
              "discard"
            ]
          }
        }
      ]
    },
    "meta": {}
  },
  'invalid/tombstone.unknown-reason.json': {
    "resource": "sales-quotes",
    "id": "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a23",
    "sync_txid": "48213990",
    "deleted_at": "2026-10-26T09:01:12+03:00",
    "reason": "archived"
  },
}

/** Fixture path (under contracts/sync/fixtures) to its schema (under contracts/sync). */
export const FIXTURE_SCHEMAS: Readonly<Record<string, string>> = {
  'common.sample.json': 'common.schema.json',
  'device-login.request.with-2fa.json': 'device-login.request.schema.json',
  'device-refresh.request.rotate.json': 'device-refresh.request.schema.json',
  'device-token.response.login.json': 'device-token.response.schema.json',
  'error-codes.document-locked.json': 'error-codes.schema.json',
  'error-codes.version-conflict.json': 'error-codes.schema.json',
  'error.response.schema-mismatch.json': 'error.response.schema.json',
  'error.response.validation.json': 'error.response.schema.json',
  'manifest.response.sales-user.json': 'manifest.response.schema.json',
  'offline-manifest.query-fields.json': '../offline-manifest.schema.json',
  'pull.request.initial-and-incremental.json': 'pull.request.schema.json',
  'pull.response.page.json': 'pull.response.schema.json',
  'push.request.outbox-batch.json': 'push.request.schema.json',
  'push.response.mixed.json': 'push.response.schema.json',
  'push.response.rejected-and-merged.json': 'push.response.schema.json',
  'tombstone.out-of-scope.json': 'tombstone.schema.json',
  'tombstone.soft-deleted.json': 'tombstone.schema.json',
  'invalid/device-refresh.request.with-fingerprint.json': 'device-refresh.request.schema.json',
  'invalid/device-token.response.missing-refresh-token.json': 'device-token.response.schema.json',
  'invalid/manifest.response.missing-visibility-generation.json': 'manifest.response.schema.json',
  'invalid/offline-manifest.delete-field-merge.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.field-merge-without-derived-fields.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.global-scope-without-activation.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-bool-any-of.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-contains-on-uuid.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-default-sort-with-semicolon.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-element-field-with-eq.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-empty-search-fields.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-field-dotted-path.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-filter-name-with-space.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-max-values-zero.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-on-snapshot.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-online-only-free-text-param.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-online-only-without-reason.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-range-on-string.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-search-field-json-path.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-sort-name-with-injection.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-sort-spec-unknown-key.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-sort-without-type.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-unknown-key.json': '../offline-manifest.schema.json',
  'invalid/offline-manifest.query-uppercase-name.json': '../offline-manifest.schema.json',
  'invalid/pull.request.cursor-without-gen.json': 'pull.request.schema.json',
  'invalid/pull.request.numeric-txid.json': 'pull.request.schema.json',
  'invalid/pull.response.reset-without-reason.json': 'pull.response.schema.json',
  'invalid/push.request.create-with-base-version.json': 'push.request.schema.json',
  'invalid/push.request.delete-with-changed-fields.json': 'push.request.schema.json',
  'invalid/push.request.duplicate-resolution-merge.json': 'push.request.schema.json',
  'invalid/push.request.payload-with-version.json': 'push.request.schema.json',
  'invalid/push.response.applied-without-version.json': 'push.response.schema.json',
  'invalid/push.response.conflict-without-detail.json': 'push.response.schema.json',
  'invalid/push.response.duplicate-not-replayed.json': 'push.response.schema.json',
  'invalid/push.response.locked-with-keep-mine.json': 'push.response.schema.json',
  'invalid/tombstone.unknown-reason.json': 'tombstone.schema.json',
}
