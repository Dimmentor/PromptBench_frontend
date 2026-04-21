import type { NodeProps } from 'reactflow'
import type { ResponseRead } from '../../api/tests'
import './nodes.css'

type ResponseNodeData = {
  response: ResponseRead
}

export function ResponseNode(props: NodeProps<ResponseNodeData>) {
  const { response } = props.data
  const durationMs = response.duration
  const durationText =
    typeof durationMs === 'number'
      ? `${(durationMs / 1000).toFixed(3)} s (${durationMs} ms)`
      : '—'
  return (
    <div className="node node-response">
      <div className="node-name">{response.id}</div>
      <div className="node-sub mono ellipsis" title={response.file_path}>
        {response.file_path}
      </div>
      <div className="node-sub">
        duration: {durationText}
      </div>
    </div>
  )
}

