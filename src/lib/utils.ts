export function lower_cmp(a: string, b: string): number {
  const a_lower = a.toLowerCase()
  const b_lower = b.toLowerCase()
  if (a_lower === b_lower) return 0
  if (a_lower < b_lower) return -1
  return 1
}
