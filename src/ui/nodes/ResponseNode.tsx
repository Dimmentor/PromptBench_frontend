import type { NodeProps } from 'reactflow'
import type { ResponseRead } from '../../api/tests'
import './nodes.css'

type ResponseNodeData = {
  response: ResponseRead
}

export function ResponseNode(props: NodeProps<ResponseNodeData>) {
  const { response } = props.data
  return (
    <div className="node node-response">
      <div className="node-name">{response.id}</div>
      <div className="node-sub mono">{response.file_path}</div>
      <div className="node-sub">
        duration: {response.duration ?? '—'} ms
      </div>
    </div>
  )
}

