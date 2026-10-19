import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FriendsPanel } from "../../src/features/friends/FriendsPanel";
import { SignUpForm } from "../../src/features/auth/components/sign-up-form";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { Button } from "../../src/components/ui/button";
import "@fontsource-variable/geist";
import "../../src/styles/shadcn.css";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const signupCalls: Array<{ email: string; password: string }> = [];
Object.assign(window, { socialSignupCalls: signupCalls });
const client = { auth: { signInWithPassword: async (credentials: { email: string; password: string }) => {
  signupCalls.push(credentials);
  return { error: params.get("signin") === "fail" ? new Error("Email confirmation required.") : null };
} } } as unknown as SupabaseClient;

function Harness() {
  const [userId, setUserId] = useState("me");
  const [token, setToken] = useState("token-one");
  const [room, setRoom] = useState("");
  const [person, setPerson] = useState("");
  const [route, setRoute] = useState("");
  return <main style={{ maxWidth: 736, margin: "0 auto", padding: 16 }}>
    {params.get("surface") === "signup" ? <SignUpForm client={params.get("signin") === "none" ? undefined : client} onNavigate={setRoute} /> : <>
      <div className="flex flex-wrap gap-2"><Button onClick={() => setToken("token-two")}>Rotate token</Button><Button onClick={() => { setUserId("other"); setToken("other-token"); }}>Switch account</Button></div>
      <FriendsPanel accessToken={token} currentUser={{ id: userId, name: userId === "me" ? "You" : "Other listener", avatarSeed: userId }} onOpenRoom={setRoom} onOpenPerson={setPerson} currentRoomSlug={params.get("inRoom") === "yes" ? "current-room" : undefined} />
      <output data-testid="room-entry">{room}</output><output data-testid="person-entry">{person}</output>
    </>}
    <output data-testid="route">{route}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
