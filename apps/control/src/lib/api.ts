/** JSON 请求；非 2xx 时抛出服务端返回的错误信息 */
export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  return data as T;
}
