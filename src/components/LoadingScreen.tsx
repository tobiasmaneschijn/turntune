import { Brand } from "./app-primitives";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen" role="status">
      <Brand />
      <div className="equalizer" aria-hidden="true"><i /><i /><i /><i /></div>
      <p>{label}</p>
    </div>
  );
}
