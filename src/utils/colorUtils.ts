// --- START OF FILE src/utils/colorUtils.ts ---

export function stringToHslColor(str: string, saturation: number, lightness: number): string {
  if (!str) return `hsl(0, 0%, ${lightness}%)`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = hash % 360;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
// --- END OF FILE src/utils/colorUtils.ts ---