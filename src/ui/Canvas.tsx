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

function computeExpandedBlockHeight(requestCount: number) {
  // A compact but stable formula:
  // - header spacing above children
  // - per-request row height
  // - bottom padding so last nodes don't touch boundary
  const header = 90
  const row = 110
  const bottom = 90
  const rows = Math.max(1, requestCount)
  return header + rows * row + bottom
}

function buildGraph(
  tests: TestRead[],
  handlers: Pick<TestNodeData, 'onCreateRequest' | 'onRun' | 'onToggleCollapsed' | 'onDeleteTest'>,
  collapsedByTestId: Record<string, boolean | undefined>,
  offsetsByTestId: Record<string, { x: number; y: number } | undefined>,
  progressByTestId: Record<string, { total: number; done: number; failed: number; pending: number } | null | undefined>,
): { nodes: FlowNode[]; edges: Edge[]; basePosByTestId: Record<string, { x: number; y: number }> } {
  const nodes: FlowNode[] = []
  const edges: Edge[] = []
  const basePosByTestId: Record<string, { x: number; y: number }> = {}

  const left = 60
  const top = 40
  const childGapY = 110

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
        progress: progressByTestId[test.id] ?? null,
      },
      style: { zIndex: 3 } as any,
    } as Node<TestNodeData>)

    // Push next tests down based on expanded/collapsed height (no overlap).
    const blockH = collapsed ? 170 : computeExpandedBlockHeight(test.requests.length)
    cursorY += blockH

    if (collapsed) return

    // Boundary around requests/responses area (expanded only).
    const reqCount = test.requests.length
    const boundaryH = Math.max(160, computeExpandedBlockHeight(reqCount) - 74)
    const boundaryNodeId = `boundary:${test.id}`
    nodes.push({
      id: boundaryNodeId,
      type: 'boundary',
      position: { x: testX + 16, y: testY + 74 },
      data: { label: 'requests / responses' },
      draggable: false,
      selectable: false,
      connectable: false,
      style: { width: 770, height: boundaryH, zIndex: 0 } as any,
    } as Node<BoundaryNodeData>)

    test.requests.forEach((req, rIdx) => {
      const reqNodeId = `req:${test.id}:${req.id}`
      const respNodeId = req.response ? `resp:${test.id}:${req.id}` : null

      const baseY = testY + 90 + rIdx * childGapY

      nodes.push({
        id: reqNodeId,
        type: 'request',
        position: { x: testX + 40, y: baseY },
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
          position: { x: testX + 420, y: baseY },
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
  const [collapsedByTestId, setCollapsedByTestId] = useState<Record<string, boolean | undefined>>({})
  const [offsetsByTestId, setOffsetsByTestId] = useState<Record<string, { x: number; y: number } | undefined>>({})

  const abortRef = useRef<AbortController | null>(null)
  const wsByTestIdRef = useRef<Record<string, WebSocket | undefined>>({})
  const lastProgressRef = useRef<Record<string, string | undefined>>({})
  const basePosByTestIdRef = useRef<Record<string, { x: number; y: number }>>({})

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setError(null)
    try {
      const testsList = await listTests(ac.signal)
      setList(testsList)
      const full = await Promise.all(testsList.map((t) => getTest(t.id, ac.signal)))
      setTests(full)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      await createRequest(testId, {})
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
          const key = JSON.stringify(msg)
          if (lastProgressRef.current[t.id] === key) return
          lastProgressRef.current[t.id] = key

          setProgressByTestId((prev) => ({ ...prev, [t.id]: msg }))

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
  }, [selected, tests])

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
      )
      basePosByTestIdRef.current = built.basePosByTestId
      return { nodes: built.nodes, edges: built.edges }
    },
    [tests, onCreateRequest, onRun, onToggleCollapsed, onDeleteTest, collapsedByTestId, offsetsByTestId, progressByTestId],
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
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="canvas">
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

        <div className="inspector">
          <div className="inspector-title">{inspector?.title ?? 'select a node'}</div>
          {selected.kind === 'request' ? (
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
            <pre className="inspector-pre">
              {inspector ? JSON.stringify({ body: inspector.body, meta: inspector.meta, error: inspector.error }, null, 2) : '—'}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

