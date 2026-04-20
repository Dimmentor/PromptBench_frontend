export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export async function http<T>(
  path: string,
  options?: {
    method?: HttpMethod
    body?: unknown
    signal?: AbortSignal
  },
): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`)
  }

  // FastAPI often returns JSON; keep it simple for now.
  return (await res.json()) as T
}

