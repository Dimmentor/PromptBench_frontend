import type { NodeProps } from 'reactflow'
import './nodes.css'

type BoundaryNodeData = {
  label: string
}

export function BoundaryNode(props: NodeProps<BoundaryNodeData>) {
  return (
    <div className="boundary">
      <div className="boundary-label">{props.data.label}</div>
    </div>
  )
}

