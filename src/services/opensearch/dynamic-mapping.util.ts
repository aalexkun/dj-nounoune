/** One node of an OpenSearch `mappings.properties` tree: a leaf field type, or an object with children. */
type MappingNode = {
  properties?: Record<string, MappingNode>;
  [key: string]: unknown;
};

/**
 * The one thing this module needs from a schema. Structural rather than mongoose's `Schema` so
 * the generically typed `SongSchema` / `ArtistSchema` / `AlbumSchema` fit without a cast.
 */
export interface PathSource {
  eachPath(fn: (path: string, schemaType: { instance?: string }) => void): unknown;
}

function mapMongooseTypeToOpenSearch(mongooseType: string): MappingNode | null {
  switch (mongooseType.toLowerCase()) {
    case 'string':
      return {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 512,
          },
        },
      };
    case 'number':
      return { type: 'float' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'date' };
    case 'objectid':
      return { type: 'keyword' };
    default:
      return null;
  }
}

function setNestedMapping(properties: Record<string, MappingNode>, path: string, mapping: MappingNode) {
  const parts = path.split('.');
  let current = properties;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const node = current[part] ?? (current[part] = { properties: {} });
    node.properties ??= {};
    current = node.properties;
  }

  const last = parts[parts.length - 1];
  if (!current[last]) {
    current[last] = mapping;
  }
}

export function generateDynamicMappings(
  baseMappings: { properties?: Record<string, unknown>; [key: string]: unknown },
  schemas: { prefix: string; schema: PathSource }[],
) {
  // Deep clone properties to avoid mutating the original readonly mappings
  const dynamicProperties = JSON.parse(JSON.stringify(baseMappings.properties || {})) as Record<string, MappingNode>;

  for (const { prefix, schema } of schemas) {
    schema.eachPath((path, schemaType) => {
      // Ignore internal mongoose fields
      if (path === '_id' || path === '__v') return;

      const fullPath = prefix ? `${prefix}.${path}` : path;
      const typeName = schemaType.instance;

      if (!typeName) return;

      const openSearchMapping = mapMongooseTypeToOpenSearch(typeName);

      if (openSearchMapping) {
        setNestedMapping(dynamicProperties, fullPath, openSearchMapping);
      }
    });
  }

  return {
    ...baseMappings,
    properties: dynamicProperties,
  };
}
