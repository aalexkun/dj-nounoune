export function generatePsv<T extends Record<string, unknown>>(data: T | T[]): string {
  // If the data is empty or null, return an empty string
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return '';
  }

  // Normalize data to an array
  const records = Array.isArray(data) ? data : [data];

  // Extract headers from the first object
  const headers = Object.keys(records[0]);

  // Format the header row
  let psvString = headers.join('|') + '\n';

  // Map each record to a PSV row
  const rows = records.map((record) => {
    return headers
      .map((header) => {
        const value = record[header];

        switch (typeof value) {
          case 'string':
            return value;
          case 'number':
          case 'boolean':
          case 'bigint':
            return String(value);
          case 'object':
            // Nested objects/arrays, and `null`: JSON rather than "[object Object]"
            return value === null ? '' : JSON.stringify(value);
          default:
            // undefined, functions and symbols have no PSV rendering
            return '';
        }
      })
      .join('|');
  });

  // Combine header and rows
  psvString += rows.join('\n');

  return psvString;
}
