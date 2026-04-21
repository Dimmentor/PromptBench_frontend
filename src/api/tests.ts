import { http } from './http'

export type TestCreate = {
  name: string
}

export type ResponseRead = {
  id: string
  request_id: string
  file_path: string
  duration: number | null
}

export type RequestReadWithResponse = {
  id: string
  test_id: string
  file_path: string
  status: string
  response: ResponseRead | null
}

export type TestReadSimple = {
  id: string
  name: string
  status: string
}

export type TestRead = {
  id: string
  name: string
  status: string
  requests: RequestReadWithResponse[]
}

export type ProgressResponse = {
  total: number
  done: number
  failed: number
  pending: number
}

export async function listTests(signal?: AbortSignal): Promise<TestReadSimple[]> {
  return http<TestReadSimple[]>('/tests', { signal })
}

export async function getTest(testId: string, signal?: AbortSignal): Promise<TestRead> {
  return http<TestRead>(`/tests/${encodeURIComponent(testId)}`, { signal })
}

export async function createTest(data: TestCreate): Promise<TestRead> {
  return http<TestRead>('/tests', { method: 'POST', body: data })
}

export async function createRequest(
  testId: string,
  payload: unknown,
  name?: string,
): Promise<{
  id: string
  test_id: string
  file_path: string
  status: string
}> {
  return http(`/tests/${encodeURIComponent(testId)}/requests`, {
    method: 'POST',
    body: { payload, name: name ?? null },
  })
}

export async function runTest(testId: string): Promise<{ status: string }> {
  return http(`/tests/${encodeURIComponent(testId)}/run`, { method: 'POST' })
}

export async function getProgress(
  testId: string,
  signal?: AbortSignal,
): Promise<ProgressResponse> {
  return http(`/tests/${encodeURIComponent(testId)}/progress`, { signal })
}

export async function getRequestPayload(
  testId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<{
  test_id: string
  request_id: string
  file_path: string
  payload: unknown
}> {
  return http(
    `/tests/${encodeURIComponent(testId)}/requests/${encodeURIComponent(requestId)}/payload`,
    { signal },
  )
}

export async function saveRequestPayload(
  testId: string,
  requestId: string,
  payload: unknown,
): Promise<{ status: string; test_id: string; request_id: string; file_path: string }> {
  return http(
    `/tests/${encodeURIComponent(testId)}/requests/${encodeURIComponent(requestId)}/payload`,
    { method: 'PUT', body: { payload } },
  )
}

export async function deleteRequestPayload(
  testId: string,
  requestId: string,
): Promise<{ status: string; test_id: string; request_id: string }> {
  return http(
    `/tests/${encodeURIComponent(testId)}/requests/${encodeURIComponent(requestId)}/payload`,
    { method: 'DELETE' },
  )
}

export async function deleteTest(testId: string): Promise<{ status: string }> {
  return http(`/tests/${encodeURIComponent(testId)}`, { method: 'DELETE' })
}

export async function getRequestResponse(
  testId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<{
  test_id: string
  request_id: string
  ok_file_path: string | null
  meta_file_path: string | null
  error_file_path: string | null
  response: unknown | null
  meta: unknown | null
  error: unknown | null
}> {
  return http(
    `/tests/${encodeURIComponent(testId)}/requests/${encodeURIComponent(requestId)}/response`,
    { signal },
  )
}

