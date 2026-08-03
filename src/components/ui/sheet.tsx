import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

function SheetContent({ className, children, side = "right", ...props }: SheetPrimitive.Popup.Props & { side?: "top" | "right" | "bottom" | "left" }) {
  return <SheetPrimitive.Portal><SheetPrimitive.Backdrop data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" /><SheetPrimitive.Popup data-slot="sheet-content" data-side={side} className={cn("fixed z-50 flex flex-col gap-4 border-border bg-popover text-popover-foreground shadow-xl transition duration-200 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:w-3/4 data-[side=right]:max-w-sm data-[side=right]:border-l data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:w-3/4 data-[side=left]:max-w-sm data-[side=left]:border-r data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[95dvh] data-[side=bottom]:rounded-t-xl data-[side=bottom]:border-t data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:border-b", className)} {...props}>{children}<SheetPrimitive.Close data-slot="sheet-close" render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Close" />}><X /></SheetPrimitive.Close></SheetPrimitive.Popup></SheetPrimitive.Portal>
}
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="sheet-header" className={cn("flex flex-col gap-1 p-4", className)} {...props} /> }
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 border-t p-4", className)} {...props} /> }
function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) { return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-base font-medium", className)} {...props} /> }
function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) { return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} /> }
export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
