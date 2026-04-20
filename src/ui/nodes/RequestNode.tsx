import type { NodeProps } from 'reactflow'
import type { RequestReadWithResponse } from '../../api/tests'
import './nodes.css'

type RequestNodeData = {
  request: RequestReadWithResponse
}

export function RequestNode(props: NodeProps<RequestNodeData>) {
  const { request } = props.data
  return (
    <div className="node node-request">
      <div className="node-name">{request.id}</div>
      <div className="node-sub">{request.status}</div>
      <div className="node-sub mono">{request.file_path}</div>
    </div>
  )
}

