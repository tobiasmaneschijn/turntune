import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import { AdminDashboard } from "../../src/components/AdminDashboard";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";

function Harness() {
  const [account, setAccount] = useState("admin-one");
  const [destination, setDestination] = useState("");
  useEffect(() => {
    Object.assign(window, { adminReviewTest: { changeAccount: (id: string) => setAccount(id) } });
  }, []);
  if (destination) return <main><h1>{destination}</h1></main>;
  return <AdminDashboard accessToken={`token-${account}`} currentUser={{ id: account, name: account, avatarSeed: account, isAppAdmin: true }} onBack={() => setDestination("Room directory")} onOpenRoom={(slug) => setDestination(`Room ${slug}`)} />;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
