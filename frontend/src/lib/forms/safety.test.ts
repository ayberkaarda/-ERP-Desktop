import { isSafeFieldPath, ownValue, partitionServerErrors, readServerError } from '.'

describe('server error paths', () => {
  it('never maps prototype-polluting or empty segments', () => {
    expect(isSafeFieldPath('lines.0.price')).toBe(true)
    for (const bad of ['__proto__', 'a.constructor', 'lines.prototype.x', 'a..b', ''])
      expect(isSafeFieldPath(bad)).toBe(false)

    const server = readServerError(
      JSON.parse(
        '{"errors":{"message":"m","fields":{"__proto__":["x"],"a.constructor":["y"],"name":["z"]}}}',
      ),
    )
    if (!server) throw new Error('expected error')
    expect(Object.getPrototypeOf(server.fields)).toBe(Object.prototype)
    expect(Object.hasOwn(server.fields, '__proto__')).toBe(true)
    const parts = partitionServerErrors(server)
    expect(parts.mapped).toEqual([{ field: 'name', message: 'z' }])
    expect(parts.unmapped.map((u) => u.field)).toEqual(['__proto__', 'a.constructor'])
  })

  it('maps descendants of known fields only when they are registered', () => {
    const server = {
      message: 'm',
      fields: { 'lines.0.price': ['a'], 'lines.7.price': ['b'], lines: ['c'], note: ['d'] },
    }
    const registered = new Set(['lines', 'lines.0.price'])
    const withCheck = partitionServerErrors(server, {
      knownFields: ['lines'],
      isRegistered: (p) => registered.has(p),
    })
    expect(withCheck.mapped.map((m) => m.field)).toEqual(['lines.0.price', 'lines'])
    expect(withCheck.unmapped.map((m) => m.field)).toEqual(['lines.7.price', 'note'])

    const noCheck = partitionServerErrors(server, { knownFields: ['lines'] })
    expect(noCheck.mapped.map((m) => m.field)).toEqual(['lines'])

    const onlyRegistry = partitionServerErrors(server, { isRegistered: (p) => p === 'note' })
    expect(onlyRegistry.mapped.map((m) => m.field)).toEqual(['note'])
  })

  it('reads own properties only', () => {
    const labels: Record<string, string> = { status: 'Durum' }
    expect(ownValue(labels, 'status')).toBe('Durum')
    expect(ownValue(labels, 'constructor')).toBeUndefined()
    expect(ownValue(labels, 'toString')).toBeUndefined()
    expect(ownValue(undefined, 'status')).toBeUndefined()
  })
})
