import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) { return <fieldset data-slot="field-set" className={cn("flex flex-col gap-4", className)} {...props} /> }
function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) { return <legend data-slot="field-legend" className={cn("mb-1.5 text-base font-medium", className)} {...props} /> }
function FieldGroup({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="field-group" className={cn("group/field-group flex w-full flex-col gap-5", className)} {...props} /> }
const fieldVariants = cva("group/field flex w-full gap-2 data-[invalid=true]:text-destructive", { variants: { orientation: { vertical: "flex-col *:w-full", horizontal: "flex-row items-center", responsive: "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center" } }, defaultVariants: { orientation: "vertical" } })
function Field({ className, orientation = "vertical", ...props }: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) { return <div role="group" data-slot="field" data-orientation={orientation} className={cn(fieldVariants({ orientation }), className)} {...props} /> }
function FieldContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="field-content" className={cn("flex flex-1 flex-col gap-0.5", className)} {...props} /> }
function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) { return <Label data-slot="field-label" className={cn("flex w-fit gap-2", className)} {...props} /> }
function FieldTitle({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="field-title" className={cn("text-sm font-medium", className)} {...props} /> }
function FieldDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="field-description" className={cn("text-sm leading-normal text-muted-foreground", className)} {...props} /> }
function FieldError({ className, ...props }: React.ComponentProps<"div">) { return <div role="alert" data-slot="field-error" className={cn("text-sm text-destructive", className)} {...props} /> }
export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle }
