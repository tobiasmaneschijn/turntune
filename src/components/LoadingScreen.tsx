import { AppHeader } from "../app/components/AppHeader";

export function LoadingScreen({ label }: { label: string }) {
  return (
    <><AppHeader publicActions={null} />
    <main className="loading-screen" id="main-content" tabIndex={-1} role="status">
      <div className="equalizer" aria-hidden="true"><i /><i /><i /><i /></div>
      <p>{label}</p>
    </main></>
  );
}
