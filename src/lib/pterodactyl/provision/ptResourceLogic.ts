export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const base = 1024;

  const unitIndex = Math.floor(Math.log(Math.abs(bytes)) / Math.log(base));
  const clampedIndex = Math.min(unitIndex, units.length - 1);

  const value = bytes / Math.pow(base, clampedIndex);

  const formatted = parseFloat(value.toFixed(1));

  return `${formatted} ${units[clampedIndex]}`;
}
