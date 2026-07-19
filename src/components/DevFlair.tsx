import { cn } from "../lib/utils";

export function DevFlair({ className }: { className?: string }) {
  return <span className={cn("dev-flair", className)} title="SoundSpin developer">[DEV]</span>;
}
