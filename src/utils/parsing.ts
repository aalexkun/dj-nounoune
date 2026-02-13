export const parseInteger = (val: string | number | undefined): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? 0 : parsed;
};

export const parseBpm = (val: string | number | undefined): number => {
  if (val === 'Unknown BPM') return 0;
  return parseInteger(val);
};
