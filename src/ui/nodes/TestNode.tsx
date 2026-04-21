import type { NodeProps } from 'reactflow'
import type { TestRead } from '../../api/tests'
import './nodes.css'

type TestNodeData = {
  test: TestRead
  onCreateRequest: (testId: string) => void
  onRun: (testId: string) => void
  collapsed: boolean
  onToggleCollapsed: (testId: string) => void
  onDeleteTest: (testId: string) => void
  lastEvent?: string | null
  progress?: { total: number; done: number; failed: number; pending: number } | null
}

export function TestNode(props: NodeProps<TestNodeData>) {
  const { test, onCreateRequest, onRun, collapsed, onToggleCollapsed, onDeleteTest, lastEvent, progress } = props.data

  return (
    <div className="node node-test">
      <div className="node-title">
        <div className="node-title-left">
          <div className="node-name">{test.name}</div>
          <div className="node-sub">{test.status}</div>
          {lastEvent ? <div className="node-sub ellipsis" title={lastEvent}>{lastEvent}</div> : null}
        </div>
        <div className="node-actions">
          <button className="btn" onClick={() => onCreateRequest(test.id)}>
            create_request
          </button>
          <button className="btn btn-accent" onClick={() => onRun(test.id)}>
            run
          </button>
          <button className="btn" onClick={() => onToggleCollapsed(test.id)}>
            {collapsed ? 'expand' : 'collapse'}
          </button>
          {!collapsed ? (
            <button className="btn btn-danger" onClick={() => onDeleteTest(test.id)}>
              delete test
            </button>
          ) : null}
        </div>
      </div>
      {progress ? (
        <div className="node-footer">
          <span className="pill">total {progress.total}</span>
          <span className="pill">done {progress.done}</span>
          <span className="pill">failed {progress.failed}</span>
          <span className="pill">pending {progress.pending}</span>
        </div>
      ) : null}
    </div>
  )
}

