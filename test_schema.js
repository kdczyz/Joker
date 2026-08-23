const CLOUDCODE_SCHEMA_DROPPED_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
  'title'
])

const NUMERIC_SCHEMA_KEYS = new Set([
  'maxLength',
  'minLength',
  'maxItems',
  'minItems',
  'maximum',
  'minimum'
])

function toCloudCodeSchema(value) {
  if (Array.isArray(value)) return value.map(toCloudCodeSchema)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$') || CLOUDCODE_SCHEMA_DROPPED_KEYS.has(key)) continue
    if (NUMERIC_SCHEMA_KEYS.has(key)) {
      if (typeof child === 'number' && Number.isFinite(child)) {
        out[key] = Math.floor(child)
        continue
      }
      if (typeof child === 'string') {
        const parsed = parseInt(child.trim(), 10)
        if (!Number.isNaN(parsed)) {
          out[key] = parsed
          continue
        }
      }
      continue
    }
    if (key === 'type' && typeof child === 'string') {
      out[key] = child.toUpperCase()
      continue
    }
    out[key] = toCloudCodeSchema(child)
  }
  if (Array.isArray(out.required)) {
    if (out.properties && typeof out.properties === 'object') {
      const validKeys = new Set(Object.keys(out.properties))
      out.required = out.required.filter(
        (r) => typeof r === 'string' && validKeys.has(r)
      )
      if (out.required.length === 0) delete out.required
    } else {
      delete out.required
    }
  }
  return out
}

const params = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  strict: true,
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      $schema: "foo"
    }
  }
}

console.log(JSON.stringify(toCloudCodeSchema(params), null, 2))
