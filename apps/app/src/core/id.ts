export function newId(prefix: string): string {
  const random = `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  return `${prefix}_${random}`;
}
