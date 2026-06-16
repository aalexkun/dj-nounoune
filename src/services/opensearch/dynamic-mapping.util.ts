import { Schema } from 'mongoose';

function mapMongooseTypeToOpenSearch(mongooseType: string): any {
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

function setNestedMapping(properties: Record<string, any>, path: string, mapping: any) {
  const parts = path.split('.');
  let current = properties;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) {
      current[part] = { properties: {} };
    } else if (!current[part].properties) {
      current[part].properties = {};
    }
    current = current[part].properties;
  }

  const last = parts[parts.length - 1];
  if (!current[last]) {
    current[last] = mapping;
  }
}

export function generateDynamicMappings(
  baseMappings: { properties?: Record<string, unknown>; [key: string]: unknown },
  schemas: { prefix: string; schema: Schema }[],
) {
  // Deep clone properties to avoid mutating the original readonly mappings
  const dynamicProperties: Record<string, any> = JSON.parse(
    JSON.stringify(baseMappings.properties || {}),
  );

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
