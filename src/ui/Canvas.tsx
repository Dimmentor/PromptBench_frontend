import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeTypes,
} from 'reactflow'
import 'reactflow/dist/style.css'

import {
  createRequest,
  deleteRequestPayload,
  deleteTest,
  getTest,
  getRequestPayload,
  getRequestResponse,
  listTests,
  runTest,
  saveRequestPayload,
  createTest,
  type TestRead,
  type TestReadSimple,
} from '../api/tests'
import { TestNode } from './nodes/TestNode'
import { RequestNode } from './nodes/RequestNode'
import { ResponseNode } from './nodes/ResponseNode'
import { BoundaryNode } from './nodes/BoundaryNode'
import './canvas.css'

type TestNodeData = React.ComponentProps<typeof TestNode>['data']
type RequestNodeData = React.ComponentProps<typeof RequestNode>['data']
type ResponseNodeData = React.ComponentProps<typeof ResponseNode>['data']

type BoundaryNodeData = React.ComponentProps<typeof BoundaryNode>['data']

type FlowNode = Node<TestNodeData | RequestNodeData | ResponseNodeData | BoundaryNodeData>

type Selected =
  | { kind: 'none' }
  | { kind: 'test'; testId: string }
  | { kind: 'request'; testId: string; requestId: string }
  | { kind: 'response'; testId: string; requestId: string }

type InspectorMode = 'pretty' | 'raw'

function formatTime(tsMs: number) {
  const d = new Date(tsMs)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function computeExpandedBlockHeight() {
  // 2 rows: requests row + responses row
  const header = 90
  const row = 120
  const bottom = 90
  return header + row * 2 + bottom
}

function buildGraph(
  tests: TestRead[],
  handlers: Pick<TestNodeData, 'onCreateRequest' | 'onRun' | 'onToggleCollapsed' | 'onDeleteTest'>,
  collapsedByTestId: Record<string, boolean | undefined>,
  offsetsByTestId: Record<string, { x: number; y: number } | undefined>,
  progressByTestId: Record<string, { total: number; done: number; failed: number; pending: number } | null | undefined>,
  eventsByTestId: Record<string, Array<{ ts_ms: number; level: string; message: string }> | undefined>,
): { nodes: FlowNode[]; edges: Edge[]; basePosByTestId: Record<string, { x: number; y: number }> } {
  const nodes: FlowNode[] = []
  const edges: Edge[] = []
  const basePosByTestId: Record<string, { x: number; y: number }> = {}

  const left = 60
  const top = 40
  const colGapX = 380
  const boundaryTop = 150
  const reqRowY = 175
  const respRowY = 310

  let cursorY = top

  tests.forEach((test) => {
    const testNodeId = `test:${test.id}`
    const collapsed = Boolean(collapsedByTestId[test.id])
    const baseX = left
    const baseY = cursorY

    basePosByTestId[test.id] = { x: baseX, y: baseY }

    const offset = offsetsByTestId[test.id] ?? { x: 0, y: 0 }
    const testX = baseX + offset.x
    const testY = baseY + offset.y

    nodes.push({
      id: testNodeId,
      type: 'test',
      position: { x: testX, y: testY },
      data: {
        test,
        onCreateRequest: handlers.onCreateRequest,
        onRun: handlers.onRun,
        collapsed,
        onToggleCollapsed: handlers.onToggleCollapsed,
        onDeleteTest: handlers.onDeleteTest,
        lastEvent: (eventsByTestId[test.id]?.at(-1)?.message ?? null) as any,
        progress: progressByTestId[test.id] ?? null,
      },
      style: { zIndex: 3 } as any,
    } as Node<TestNodeData>)

    // Push next tests down based on expanded/collapsed height (no overlap).
    const blockH = collapsed ? 170 : computeExpandedBlockHeight()
    cursorY += blockH

    if (collapsed) return

    // Boundary around requests/responses area (expanded only).
    const reqCount = test.requests.length
    const boundaryW = Math.max(770, 80 + Math.max(1, reqCount) * colGapX)
    const boundaryH = Math.max(220, computeExpandedBlockHeight() - 74)
    const boundaryNodeId = `boundary:${test.id}`
    nodes.push({
      id: boundaryNodeId,
      type: 'boundary',
      position: { x: testX + 16, y: testY + boundaryTop },
      data: { label: 'requests / responses' },
      draggable: false,
      selectable: false,
      connectable: false,
      style: { width: boundaryW, height: boundaryH, zIndex: 0 } as any,
    } as Node<BoundaryNodeData>)

    test.requests.forEach((req, rIdx) => {
      const reqNodeId = `req:${test.id}:${req.id}`
      const respNodeId = req.response ? `resp:${test.id}:${req.id}` : null

      const x = testX + 40 + rIdx * colGapX
      const requestY = testY + reqRowY
      const responseY = testY + respRowY

      nodes.push({
        id: reqNodeId,
        type: 'request',
        position: { x, y: requestY },
        data: { request: req },
        style: { zIndex: 2 } as any,
      } as Node<RequestNodeData>)

      edges.push({
        id: `e:${testNodeId}->${reqNodeId}`,
        source: testNodeId,
        target: reqNodeId,
        animated: test.status.toLowerCase().includes('running'),
        style: { stroke: 'rgba(139, 92, 246, 0.9)', strokeWidth: 2 },
      })

      if (req.response && respNodeId) {
        nodes.push({
          id: respNodeId,
          type: 'response',
          position: { x, y: responseY },
          data: { response: req.response },
          style: { zIndex: 2 } as any,
        } as Node<ResponseNodeData>)

        edges.push({
          id: `e:${reqNodeId}->${respNodeId}`,
          source: reqNodeId,
          target: respNodeId,
          animated: false,
          style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 2 },
        })
      }
    })
  })

  return { nodes, edges, basePosByTestId }
}

export function Canvas() {
  const [tests, setTests] = useState<TestRead[]>([])
  const [list, setList] = useState<TestReadSimple[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressByTestId, setProgressByTestId] = useState<Record<string, { total: number; done: number; failed: number; pending: number } | null | undefined>>({})
  const [eventsByTestId, setEventsByTestId] = useState<Record<string, Array<{ ts_ms: number; level: string; message: string }>>>({})
  const [selected, setSelected] = useState<Selected>({ kind: 'none' })
  const [inspector, setInspector] = useState<{
    title: string
    body: unknown
    meta?: unknown
    error?: unknown
  } | null>(null)
  const [editorText, setEditorText] = useState<string>('')
  const [editorError, setEditorError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [inspectorVisible, setInspectorVisible] = useState(true)
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('pretty')
  const [collapsedByTestId, setCollapsedByTestId] = useState<Record<string, boolean | undefined>>({})
  const [offsetsByTestId, setOffsetsByTestId] = useState<Record<string, { x: number; y: number } | undefined>>({})

  const abortRef = useRef<AbortController | null>(null)
  const wsByTestIdRef = useRef<Record<string, WebSocket | undefined>>({})
  const lastProgressRef = useRef<Record<string, string | undefined>>({})
  const basePosByTestIdRef = useRef<Record<string, { x: number; y: number }>>({})
  const eventsScrollRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    // Don't clear previous canvas content while loading (prevents "everything disappears").
    setError(null)
    try {
      const testsList = await listTests(ac.signal)
      setList(testsList)
      const full = await Promise.all(testsList.map((t) => getTest(t.id, ac.signal)))
      setTests(full)
    } catch (e) {
      // React StrictMode runs effects twice -> AbortController will often cancel the first run.
      // Ignore abort errors to avoid noisy UI ("signal is aborted...").
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('aborterror')) {
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const onCreateTest = useCallback(async () => {
    const name = window.prompt('Test name', `test_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}`)
    if (!name) return
    await createTest({ name })
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    return () => abortRef.current?.abort()
  }, [refresh])

  const onCreateRequest = useCallback(
    async (testId: string) => {
      // Пустой шаблон payload (как договорились).
      const name = window.prompt('Request name', `request_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}`)
      if (!name) return
      await createRequest(testId, {}, name)
      await refresh()
    },
    [refresh],
  )

  const onRun = useCallback(
    async (testId: string) => {
      await runTest(testId)
      await refresh()
    },
    [refresh],
  )

  const onToggleCollapsed = useCallback((testId: string) => {
    setCollapsedByTestId((prev) => ({ ...prev, [testId]: !prev[testId] }))
  }, [])

  const onDeleteTest = useCallback(
    async (testId: string) => {
      await deleteTest(testId)
      setSelected({ kind: 'none' })
      setInspector(null)
      setOffsetsByTestId((prev) => {
        const { [testId]: _, ...rest } = prev
        return rest
      })
      setCollapsedByTestId((prev) => {
        const { [testId]: _, ...rest } = prev
        return rest
      })
      await refresh()
    },
    [refresh],
  )

  const allCollapsed = useMemo(() => {
    if (list.length === 0) return false
    return list.every((t) => Boolean(collapsedByTestId[t.id]))
  }, [list, collapsedByTestId])

  const toggleAll = useCallback(() => {
    const next = !allCollapsed
    setCollapsedByTestId((prev) => {
      const out: Record<string, boolean | undefined> = { ...prev }
      for (const t of list) out[t.id] = next
      return out
    })
  }, [allCollapsed, list])

  // Close all sockets on unmount only.
  useEffect(() => {
    return () => {
      for (const ws of Object.values(wsByTestIdRef.current)) {
        ws?.close()
      }
      wsByTestIdRef.current = {}
      lastProgressRef.current = {}
    }
  }, [])

  // WebSocket progress for each test on the canvas.
  useEffect(() => {
    const ids = new Set(list.map((t) => t.id))

    // Close WS for removed tests.
    for (const [testId, ws] of Object.entries(wsByTestIdRef.current)) {
      if (!ids.has(testId) && ws) {
        ws.close()
        delete wsByTestIdRef.current[testId]
        delete lastProgressRef.current[testId]
      }
    }

    // Open WS for new tests.
    for (const t of list) {
      if (wsByTestIdRef.current[t.id]) continue

      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/tests/ws/${encodeURIComponent(t.id)}`,
      )
      wsByTestIdRef.current[t.id] = ws

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as any
          if (msg?.error) return
          // New protocol: { type: "progress", progress: {...}, events: [...] }
          const progress = msg?.progress ?? msg
          const events = Array.isArray(msg?.events) ? msg.events : []

          const key = JSON.stringify(progress)
          if (lastProgressRef.current[t.id] === key && events.length === 0) return
          lastProgressRef.current[t.id] = key

          if (progress?.total !== undefined) {
            setProgressByTestId((prev) => ({ ...prev, [t.id]: progress }))
          }
          if (events.length > 0) {
            setEventsByTestId((prev) => {
              const cur = prev[t.id] ?? []
              const next = cur.concat(events)
              return { ...prev, [t.id]: next.slice(-300) }
            })
          }

          // When progress changes, refresh that specific test so new responses appear.
          void getTest(t.id).then((fresh) => {
            setTests((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)))
          })
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        // keep last known progress; manual refresh can recover
      }
      ws.onclose = () => {
        // allow re-open on next list update/refresh
        if (wsByTestIdRef.current[t.id] === ws) {
          delete wsByTestIdRef.current[t.id]
        }
      }
    }
  }, [list])

  // Inspector loader.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (selected.kind === 'none') {
        setInspector(null)
        return
      }
      if (selected.kind === 'test') {
        const t = tests.find((x) => x.id === selected.testId)
        setInspector(t ? { title: `test ${t.id}`, body: t } : { title: `test ${selected.testId}`, body: null })
        return
      }
      if (selected.kind === 'request') {
        const r = await getRequestPayload(selected.testId, selected.requestId)
        if (!cancelled) {
          setInspector({ title: `request ${selected.requestId} payload`, body: r.payload })
          setEditorText(JSON.stringify(r.payload ?? {}, null, 2))
          setEditorError(null)
        }
        return
      }
      if (selected.kind === 'response') {
        const rr = await getRequestResponse(selected.testId, selected.requestId)
        if (!cancelled) {
          setInspector({ title: `response for ${selected.requestId}`, body: rr.response, meta: rr.meta, error: rr.error })
          setEditorText('')
          setEditorError(null)
        }
      }
    }
    void run().catch((e) => {
      if (!cancelled) setInspector({ title: 'error', body: e instanceof Error ? e.message : String(e) })
    })
    return () => {
      cancelled = true
    }
  }, [selected, tests, eventsByTestId])

  // Auto-scroll events when viewing a test.
  useEffect(() => {
    if (selected.kind !== 'test') return
    const el = eventsScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [selected, eventsByTestId])

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      test: TestNode,
      request: RequestNode,
      response: ResponseNode,
      boundary: BoundaryNode,
    }),
    [],
  )

  const { nodes, edges } = useMemo(
    () => {
      const built = buildGraph(
        tests,
        { onCreateRequest, onRun, onToggleCollapsed, onDeleteTest },
        collapsedByTestId,
        offsetsByTestId,
        progressByTestId,
        eventsByTestId,
      )
      basePosByTestIdRef.current = built.basePosByTestId
      return { nodes: built.nodes, edges: built.edges }
    },
    [tests, onCreateRequest, onRun, onToggleCollapsed, onDeleteTest, collapsedByTestId, offsetsByTestId, progressByTestId, eventsByTestId],
  )

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">PromptBench</div>
          <div className="brand-sub">tests → requests → responses</div>
        </div>
        <div className="topbar-right">
          <div className="meta">{loading ? 'loading…' : `${list.length} tests`}</div>
          <button className="btn btn-accent" onClick={() => void onCreateTest()}>
            create test
          </button>
          <button className="btn" onClick={toggleAll}>
            {allCollapsed ? 'expand all' : 'collapse all'}
          </button>
          <button className="btn" onClick={() => void refresh()}>
            refresh
          </button>
          <button className="btn" onClick={() => setInspectorVisible((v) => !v)}>
            {inspectorVisible ? 'hide panel' : 'show panel'}
          </button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className={inspectorVisible ? 'canvas' : 'canvas canvas--no-inspector'}>
        <div className="canvas-main">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            onNodeDragStop={(_, n) => {
              if (n.type !== 'test') return
              const testId = String(n.id).split(':')[1] ?? ''
              const base = basePosByTestIdRef.current[testId]
              if (!base) return
              setOffsetsByTestId((prev) => ({
                ...prev,
                [testId]: { x: n.position.x - base.x, y: n.position.y - base.y },
              }))
            }}
            onNodeClick={(_, n) => {
              if (n.type === 'test') {
                const testId = String(n.id).split(':')[1] ?? ''
                setSelected({ kind: 'test', testId })
              } else if (n.type === 'request') {
                const parts = String(n.id).split(':') // req:testId:reqId
                setSelected({ kind: 'request', testId: parts[1], requestId: parts[2] })
              } else if (n.type === 'response') {
                const parts = String(n.id).split(':') // resp:testId:reqId
                setSelected({ kind: 'response', testId: parts[1], requestId: parts[2] })
              }
            }}
          >
          <Background gap={18} size={1} color="rgba(255,255,255,0.07)" />
          <Controls />
          </ReactFlow>
        </div>

        {inspectorVisible ? (
        <div className="inspector">
          <div className="inspector-title">{inspector?.title ?? 'select a node'}</div>
          <div className="inspector-actions" style={{ borderBottom: '1px solid var(--border)' }}>
            <button className="btn" onClick={() => setInspectorMode('pretty')}>
              pretty
            </button>
            <button className="btn" onClick={() => setInspectorMode('raw')}>
              raw
            </button>
          </div>
          {selected.kind === 'test' ? (
            inspectorMode === 'raw' ? (
              <pre className="inspector-pre">
                {JSON.stringify(
                  {
                    progress: progressByTestId[selected.testId] ?? null,
                    events: eventsByTestId[selected.testId] ?? [],
                  },
                  null,
                  2,
                )}
              </pre>
            ) : (
              <div className="events">
                <div className="events-head">
                  <div className="pretty-title">events</div>
                  <div className="events-count">{(eventsByTestId[selected.testId] ?? []).length}</div>
                </div>
                <div className="events-list" ref={eventsScrollRef}>
                  {(eventsByTestId[selected.testId] ?? []).map((e, idx) => (
                    <div key={`${e.ts_ms}-${idx}`} className={`event event-${String(e.level).toLowerCase()}`}>
                      <div className="event-ts">{formatTime(e.ts_ms)}</div>
                      <div className="event-msg" title={e.message}>
                        {e.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : selected.kind === 'request' ? (
            <div className="inspector-editor">
              <div className="inspector-actions">
                <button
                  className="btn btn-accent"
                  disabled={saving}
                  onClick={() => {
                    setSaving(true)
                    setEditorError(null)
                    let parsed: unknown
                    try {
                      parsed = JSON.parse(editorText || '{}')
                    } catch (e) {
                      setEditorError(e instanceof Error ? e.message : String(e))
                      setSaving(false)
                      return
                    }
                    void saveRequestPayload(selected.testId, selected.requestId, parsed)
                      .then(async () => {
                        await refresh()
                        const r = await getRequestPayload(selected.testId, selected.requestId)
                        setInspector({ title: `request ${selected.requestId} payload`, body: r.payload })
                        setEditorText(JSON.stringify(r.payload ?? {}, null, 2))
                      })
                      .catch((e) => setEditorError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setSaving(false))
                  }}
                >
                  {saving ? 'saving…' : 'save'}
                </button>
                <button
                  className="btn btn-danger"
                  disabled={saving}
                  onClick={() => {
                    setSaving(true)
                    setEditorError(null)
                    void deleteRequestPayload(selected.testId, selected.requestId)
                      .then(async () => {
                        setSelected({ kind: 'none' })
                        setInspector(null)
                        await refresh()
                      })
                      .catch((e) => setEditorError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setSaving(false))
                  }}
                >
                  delete
                </button>
              </div>
              {editorError ? <div className="inspector-error">{editorError}</div> : null}
              <textarea
                className="inspector-textarea"
                id={`payload-editor-${selected.testId}-${selected.requestId}`}
                name="payload"
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="inspector-view">
              {(() => {
                if (!inspector) return <pre className="inspector-pre">—</pre>
                const raw = { body: inspector.body, meta: inspector.meta, error: inspector.error }
                if (inspectorMode === 'raw') {
                  return <pre className="inspector-pre">{JSON.stringify(raw, null, 2)}</pre>
                }

                const b: any = inspector.body
                const content =
                  b?.choices?.[0]?.message?.content ??
                  b?.choices?.[0]?.delta?.content ??
                  null

                if (!content) {
                  return <pre className="inspector-pre">{JSON.stringify(raw, null, 2)}</pre>
                }

                const meta = {
                  model: b?.model,
                  id: b?.id,
                  thread_id: b?.thread_id ?? b?.conversation_id,
                  usage: b?.usage,
                }

                return (
                  <div className="pretty">
                    <div className="pretty-head">
                      <div className="pretty-title">assistant content</div>
                      <button
                        className="btn"
                        onClick={() => {
                          void navigator.clipboard?.writeText(String(content))
                        }}
                      >
                        copy
                      </button>
                    </div>
                    <pre className="pretty-content">{String(content)}</pre>
                    <div className="pretty-title">meta</div>
                    <pre className="inspector-pre">{JSON.stringify(meta, null, 2)}</pre>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
        ) : null}
      </div>
    </div>
  )
}

