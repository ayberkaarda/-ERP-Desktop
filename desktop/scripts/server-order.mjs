// Writes src-tauri/src/router/local_read/server_order.json: rows of two list
// streams and list requests on them, with the ids and total PostgreSQL gives
// for the SQL the server builds for each request (the expectations of
// `local_answers_give_the_server_rows_order_and_total`).
//
// Needs a PostgreSQL whose database collation is the server's (en_US.utf8).
// Connection, from the environment only:
// - KEYSTONE_PG_CONTAINER=<name>: runs `docker exec -i <name> psql`, with
//   PGUSER / PGDATABASE (and PGPASSWORD if the container needs one) passed on;
// - otherwise `psql` on PATH with the usual PGHOST, PGPORT, PGUSER,
//   PGPASSWORD, PGDATABASE.
// Everything runs in one transaction on temp tables and is rolled back.
// Usage (from desktop/): node scripts/server-order.mjs [out.json]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const id = (n) => `0192f5a0-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const A = id(0xa1), B = id(0xb2), C = id(0xc3);

const parties = [
  [id(0x109), { name: 'Çevrimdışı Cari A.Ş.', legal_name: null, code: 'P000007', tax_number: '1234567890', country: 'TR', roles: ['customer'], is_active: true }],
  [id(0x102), { name: 'Charlie Ortak', legal_name: 'Charlie Ortak Ltd', code: 'P-CHARLIE', tax_number: null, country: 'TR', roles: ['customer', 'supplier'], is_active: true }],
  [id(0x105), { name: 'Bravo Tedarik', legal_name: null, code: 'P-BRAVO', tax_number: '9999999999', country: 'DE', roles: ['supplier'], is_active: false }],
  [id(0x101), { name: 'acme', legal_name: null, code: 'p-acme', tax_number: '0000000001', country: null, roles: ['customer'], is_active: true }],
  [id(0x108), { name: 'Acme', legal_name: 'ACME A.Ş.', code: 'P-ACME', tax_number: '0000000001', country: 'TR', roles: [], is_active: true }],
  [id(0x103), { name: 'İstanbul Gıda', legal_name: 'İSTANBUL GIDA LTD', code: 'P-IST', tax_number: null, country: 'TR', roles: ['customer'], is_active: true }],
  [id(0x107), { name: 'Işık Ltd', legal_name: null, code: 'P-ISIK', tax_number: '5555555555', country: 'TR', roles: ['supplier'], is_active: false }],
  [id(0x104), { name: 'Ömer Usta', legal_name: null, code: 'P-OMER', tax_number: '4444444444', country: 'AZ', roles: ['customer'], is_active: true }],
  [id(0x106), { name: 'Cevrimdisi', legal_name: null, code: 'P-CEV', tax_number: '3333333333', country: 'TR', roles: ['customer'], is_active: true }],
];

const quotes = [
  [id(0x206), { document_date: '2027-06-12', number: 'SQ-0002', created_at: '2027-06-12T10:00:00.000000Z', party_id: A, party_name: 'Bravo Tedarik', total: '96.00', total_local: '96.00', status: 'draft', due_date: null, notes: 'ilk teklif', lines: [{ item_id: A }] }],
  [id(0x203), { document_date: '2027-06-12', number: 'SQ-0003', created_at: '2027-06-12T12:30:00+03:00', party_id: B, party_name: 'acme', total: '288.00', total_local: null, status: 'sent', due_date: '2027-07-01', notes: null, lines: [{ item_id: B }] }],
  [id(0x201), { document_date: '2027-06-01', number: 'SQ-0001', created_at: '2027-06-01T08:00:00.000000Z', party_id: A, party_name: 'Çağ Ltd', total: '1000000000000000000.01', total_local: '1000000000000000000.00', status: 'draft', due_date: '2027-06-30', notes: 'Büyük tutar', lines: [{ item_id: A }, { item_id: B }] }],
  [id(0x207), { document_date: '2027-06-05', number: 'sq-0010', created_at: '2027-06-05T08:00:00.000000Z', party_id: B, party_name: 'Cag', total: '9.5', total_local: '9.50', status: 'accepted', due_date: null, notes: null, lines: [] }],
  [id(0x202), { document_date: '2027-06-05', number: 'SQ-0004', created_at: '2027-06-05T08:00:00.000000Z', party_id: C, party_name: null, total: '-5.00', total_local: '-5.00', status: 'draft', due_date: null, notes: 'iade', lines: [{ item_id: C }] }],
  [id(0x205), { document_date: '2027-06-20', number: 'SQ-0005', created_at: '2027-06-20T23:30:00-02:00', party_id: C, party_name: 'Zeytin', total: '9007199254740993.00', total_local: '9007199254740993', status: 'sent', due_date: '2027-06-30', notes: null, lines: [{ item_id: C }] }],
  [id(0x204), { document_date: '2027-06-20', number: 'SQ-0006', created_at: '2027-06-21T01:00:00Z', party_id: B, party_name: 'zeytin', total: '9007199254740992.99', total_local: null, status: 'sent', due_date: '2027-06-30', notes: 'Zeytin bayi', lines: [{ item_id: B }] }],
];

const tables = {
  parties: {
    rows: parties,
    cols: { name: 'text', legal_name: 'text', code: 'text', tax_number: 'text', country: 'text', roles: 'jsonb', is_active: 'boolean' },
  },
  'sales-quotes': {
    rows: quotes,
    cols: { document_date: 'date', number: 'text', created_at: 'timestamptz', party_id: 'uuid', party_name: 'text', total: 'numeric', total_local: 'numeric', status: 'text', due_date: 'date', notes: 'text', lines: 'jsonb' },
  },
};

// [resource, query pairs, server WHERE, server ORDER BY (before id)]
const cases = [];
const sorts = {
  parties: ['code', 'name', 'tax_number', 'country'],
  'sales-quotes': ['document_date', 'number', 'created_at', 'party_name', 'total', 'total_local', 'status', 'due_date'],
};
for (const [resource, names] of Object.entries(sorts)) {
  for (const n of names) {
    cases.push([resource, [['per_page', '100'], ['sort', n]], 'true', `${n} ASC`]);
    cases.push([resource, [['per_page', '100'], ['sort', `-${n}`]], 'true', `${n} DESC`]);
  }
}
cases.push(['parties', [], 'true', null]);
cases.push(['parties', [['page', '1'], ['per_page', '25'], ['sort', 'name']], 'true', 'name ASC']);
cases.push(['parties', [['sort', '-country,name']], 'true', 'country DESC, name ASC']);
cases.push(['parties', [['filter[role]', 'customer']], `roles ? 'customer'`, null]);
cases.push(['parties', [['sort', 'name'], ['filter[role]', 'supplier'], ['filter[is_active]', '1']], `roles ? 'supplier' AND is_active = true`, 'name ASC']);
cases.push(['parties', [['filter[is_active]', '0']], 'is_active = false', null]);
cases.push(['parties', [['filter[is_active]', 'true']], 'is_active = true', null]);
cases.push(['parties', [['filter[is_active]', 'FALSE']], 'is_active = false', null]);
cases.push(['parties', [['filter[country]', 'TR,DE'], ['sort', 'code']], `country IN ('TR','DE')`, 'code ASC']);
cases.push(['parties', [['filter[country]', 'tr']], `country = 'tr'`, null]);
cases.push(['parties', [['q', 'acme']], `(name ILIKE '%acme%' OR legal_name ILIKE '%acme%' OR code ILIKE '%acme%' OR tax_number ILIKE '%acme%')`, null]);
cases.push(['parties', [['q', 'p-ch'], ['sort', 'name']], `(name ILIKE '%p-ch%' OR legal_name ILIKE '%p-ch%' OR code ILIKE '%p-ch%' OR tax_number ILIKE '%p-ch%')`, 'name ASC']);
cases.push(['parties', [['q', '999']], `(name ILIKE '%999%' OR legal_name ILIKE '%999%' OR code ILIKE '%999%' OR tax_number ILIKE '%999%')`, null]);
cases.push(['parties', [['q', 'ltd'], ['sort', '-name']], `(name ILIKE '%ltd%' OR legal_name ILIKE '%ltd%' OR code ILIKE '%ltd%' OR tax_number ILIKE '%ltd%')`, 'name DESC']);
cases.push(['parties', [['filter[role]', 'nobody']], `roles ? 'nobody'`, null]);
// The server reads `q` only: `search` is no filter.
cases.push(['parties', [['search', 'acme']], 'true', null]);
cases.push(['parties', [['filter[country]', ' TR ']], `country = 'TR'`, null]);
cases.push(['sales-quotes', [], 'true', 'document_date DESC, created_at DESC']);
// The server refuses a blank sort= with 422 (measured over HTTP on every
// mirrored list: ConvertEmptyStringsToNull makes it null, ListQuery takes a
// string only): kept as a refusal, not as SQL.
cases.push(['sales-quotes', [['sort', '']], null, null, 422]);
cases.push(['sales-quotes', [['sort', 'status,-total']], 'true', 'status ASC, total DESC']);
cases.push(['sales-quotes', [['page', '2'], ['per_page', '2'], ['sort', '-total']], 'true', 'total DESC']);
cases.push(['sales-quotes', [['page', '4'], ['per_page', '2'], ['sort', '-total']], 'true', 'total DESC']);
cases.push(['sales-quotes', [['filter[status]', 'draft']], `status = 'draft'`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['filter[status]', 'draft,sent'], ['sort', 'number']], `status IN ('draft','sent')`, 'number ASC']);
cases.push(['sales-quotes', [['filter[party_id]', B.toUpperCase()]], `party_id = '${B}'`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['filter[date_from]', '2027-06-05'], ['filter[date_to]', '2027-06-12']], `document_date >= '2027-06-05' AND document_date <= '2027-06-12'`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['filter[number]', 'sq-00']], `number ILIKE '%sq-00%'`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['filter[number]', '0010']], `number ILIKE '%0010%'`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['filter[item_id]', A]], `EXISTS (SELECT 1 FROM jsonb_array_elements(lines) l WHERE (l->>'item_id')::uuid = '${A}')`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['q', 'zeytin'], ['sort', 'created_at']], `(number ILIKE '%zeytin%' OR party_name ILIKE '%zeytin%' OR notes ILIKE '%zeytin%')`, 'created_at ASC']);
cases.push(['sales-quotes', [['q', 'teklif']], `(number ILIKE '%teklif%' OR party_name ILIKE '%teklif%' OR notes ILIKE '%teklif%')`, 'document_date DESC, created_at DESC']);
cases.push(['sales-quotes', [['filter[status]', 'none']], `status = 'none'`, 'document_date DESC, created_at DESC']);

function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

let sql = 'BEGIN;\n';
for (const [resource, t] of Object.entries(tables)) {
  const name = 't_' + resource.replace('-', '_');
  const cols = Object.entries(t.cols);
  sql += `CREATE TEMP TABLE ${name} (id uuid PRIMARY KEY, ${cols.map(([c, ty]) => `${c} ${ty}`).join(', ')});\n`;
  for (const [rid, row] of t.rows) {
    sql += `INSERT INTO ${name} VALUES ('${rid}', ${cols.map(([c, ty]) => `${sqlLiteral(row[c])}::${ty}`).join(', ')});\n`;
  }
}
const pageOf = (pairs) => {
  const get = (k, d) => Number((pairs.find(([n]) => n === k) || [k, d])[1]);
  return [get('page', 1), get('per_page', 25)];
};
cases.forEach(([resource, pairs, where, order, status], i) => {
  if (status) return
  const name = 't_' + resource.replace('-', '_');
  const [page, per] = pageOf(pairs);
  const by = (order ? order + ', ' : '') + 'id ASC';
  sql += `SELECT ${i} || '|' || coalesce((SELECT string_agg(id::text, ',' ORDER BY n) FROM (SELECT id, row_number() OVER (ORDER BY ${by}) n FROM ${name} WHERE ${where} ORDER BY ${by} LIMIT ${per} OFFSET ${(page - 1) * per}) s), '') || '|' || (SELECT count(*) FROM ${name} WHERE ${where});\n`;
});
sql += 'ROLLBACK;\n';

const psqlArgs = ['-At', '-v', 'ON_ERROR_STOP=1']
const container = process.env.KEYSTONE_PG_CONTAINER
const out = (container
  ? execFileSync('docker', [
      'exec', '-i',
      ...['PGUSER', 'PGDATABASE', 'PGPASSWORD'].filter((k) => process.env[k]).flatMap((k) => ['-e', `${k}=${process.env[k]}`]),
      container, 'psql', ...psqlArgs,
    ], { input: sql })
  : execFileSync('psql', psqlArgs, { input: sql })
).toString();
const results = {};
for (const line of out.split('\n')) {
  const m = line.match(/^(\d+)\|([^|]*)\|(\d+)$/);
  if (m) results[m[1]] = { ids: m[2] ? m[2].split(',') : [], total: Number(m[3]) };
}
const fixture = {
  description: 'Rows of two list streams and list requests on them, with the ids and total PostgreSQL 18 (en_US.utf8, the server database) gives for the SQL the server builds for each request (server_sql: WHERE and ORDER BY before the final id). Text columns are text, totals numeric, created_at timestamptz, roles and lines jsonb. A request with server_status instead of ids is one the server refuses with that status (measured over HTTP).',
  rows: Object.fromEntries(Object.entries(tables).map(([r, t]) => [r, t.rows.map(([rid, row]) => ({ id: rid, version: 1, ...row }))])),
  requests: cases.map(([resource, pairs, where, order, status], i) => {
    if (status) return { resource, query: pairs, server_status: status }
    if (!results[i]) throw new Error('no result for case ' + i);
    return { resource, query: pairs, server_sql: `WHERE ${where} ORDER BY ${(order ? order + ', ' : '') + 'id'}`, ids: results[i].ids, total: results[i].total };
  }),
};
const target = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'src', 'router', 'local_read', 'server_order.json');
fs.writeFileSync(target, JSON.stringify(fixture, null, 2) + '\n');
console.log('cases', cases.length);
