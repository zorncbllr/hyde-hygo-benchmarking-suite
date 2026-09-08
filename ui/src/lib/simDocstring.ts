/**
 * Extracts the class docstring (the algorithms document their own design
 * intent) from the vendored source. Returns null when absent.
 */
export function extractClassDocstring(source: string): string | null {
  const classIdx = source.indexOf("class ");
  if (classIdx === -1) return null;
  const m = /"""([\s\S]*?)"""/.exec(source.slice(classIdx));
  return m ? m[1].trim() : null;
}
