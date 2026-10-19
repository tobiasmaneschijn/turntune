import { GripVertical } from "lucide-react"
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex size-full", className)}
      {...props}
    />
  )
}

function ResizablePanel(props: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({ className, withHandle = false, ...props }: SeparatorProps & { withHandle?: boolean }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn("relative flex items-center justify-center outline-none", className)}
      {...props}
    >
      {withHandle && (
        <span className="resize-handle-grip" aria-hidden="true">
          <GripVertical />
        </span>
      )}
    </Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, useGroupRef }
