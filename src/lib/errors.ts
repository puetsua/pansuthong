/**
 * Normalize an unknown thrown/rejected value into a readable message.
 *
 * Tauri `invoke` rejections, plugin failures and thrown values can be `Error`
 * instances, strings (our `AppError` serializes to its `Display` string), or
 * plain objects. `String(obj)` yields the useless `"[object Object]"`; this
 * helper produces something legible in every case.
 */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through to String() for non-serializable objects */
    }
  }
  return String(e);
}
