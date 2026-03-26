export function generatePsv<T extends Record<string, any>>(data: T | T[]): string {
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

        // Handle null or undefined values
        if (value === null || value === undefined) {
          return '';
        }

        // Handle nested objects/arrays to avoid "[object Object]"
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }

        // Convert numbers, booleans, and strings safely
        return String(value);
      })
      .join('|');
  });

  // Combine header and rows
  psvString += rows.join('\n');

  return psvString;
}
