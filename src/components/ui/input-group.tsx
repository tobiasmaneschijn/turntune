import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group" className={cn("flex min-w-0 items-center", className)} {...props} />
}

function InputGroupInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input data-slot="input-group-control" className={cn("min-w-0 flex-1", className)} {...props} />
}

function InputGroupAddon({ className, align = "inline-start", ...props }: React.ComponentProps<"div"> & { align?: "inline-start" | "inline-end" }) {
  return <div data-slot="input-group-addon" data-align={align} className={cn("flex shrink-0 items-center", className)} {...props} />
}

function InputGroupButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot="input-group-button" className={cn(className)} {...props} />
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput }
