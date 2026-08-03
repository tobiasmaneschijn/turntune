import type { MouseEvent } from "react";
import {
  ArrowRight,
  Headphones,
  Link2,
  ListMusic,
  MessageCircle,
  Music2,
  Radio,
  Share2,
  Sparkles,
  Users,
  Waves
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { User } from "@/types";
import { Avatar } from "@/components/Avatar";
import { Brand } from "@/components/Brand";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

const SAMPLE_USERS: User[] = [
  { id: "maya", name: "Maya", avatarSeed: "maya", avatarKey: "sunset", isAppAdmin: false },
  { id: "noah", name: "Noah", avatarSeed: "noah", avatarKey: "orbit", isAppAdmin: false },
  { id: "liv", name: "Liv", avatarSeed: "liv", avatarKey: "prism", isAppAdmin: false },
  { id: "leo", name: "Leo", avatarSeed: "leo", avatarKey: "voltage", isAppAdmin: false }
];

const BENEFITS = [
  {
    icon: Waves,
    title: "Stay on the same beat",
    description: "Playback stays aligned across the room, so the drop lands for everyone at once.",
    note: "Synchronized playback"
  },
  {
    icon: ListMusic,
    title: "Pass the aux, fairly",
    description: "Round-robin DJ turns give everyone a moment while private queues keep picks a surprise.",
    note: "One song per turn"
  },
  {
    icon: MessageCircle,
    title: "React in real time",
    description: "Chat, reply, and react without leaving the room or missing what is playing next.",
    note: "Conversation included"
  }
];

const STEPS = [
  {
    icon: Headphones,
    title: "Create your room",
    description: "Give your listening spot a name and set the vibe."
  },
  {
    icon: Share2,
    title: "Drop the link",
    description: "Invite the friends who always know the next song."
  },
  {
    icon: Radio,
    title: "Take turns",
    description: "Build private queues, rotate DJs, and listen in sync."
  }
];

function navigateInsideApp(
  event: MouseEvent<HTMLAnchorElement>,
  path: string,
  onNavigate: (path: string) => void
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) return;

  event.preventDefault();
  onNavigate(path);
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <main className="landing-page">
      <div className="landing-backdrop" aria-hidden="true">
        <span className="landing-glow landing-glow-violet" />
        <span className="landing-glow landing-glow-cyan" />
      </div>

      <header className="landing-header">
        <nav className="landing-nav" aria-label="Main navigation">
          <a
            className="landing-brand-link"
            href="/"
            aria-label="Lydman home"
            onClick={(event) => navigateInsideApp(event, "/", onNavigate)}
          >
            <Brand />
          </a>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </div>
          <div className="landing-nav-actions">
            <a
              href="/login"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "landing-nav-sign-in")}
              onClick={(event) => navigateInsideApp(event, "/login", onNavigate)}
            >
              Sign in
            </a>
            <a
              href="/sign-up"
              className={buttonVariants({ size: "sm" })}
              onClick={(event) => navigateInsideApp(event, "/sign-up", onNavigate)}
            >
              Sign up
            </a>
          </div>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <Badge variant="outline" className="landing-kicker">
            <Sparkles data-icon="inline-start" /> Your room. Your rotation.
          </Badge>
          <h1 id="landing-title">One room.<br /><em>Everyone&apos;s turn.</em></h1>
          <p>
            Bring your people, bring the music service you already use, and keep every play,
            queue, and reaction in sync.
          </p>
          <div className="landing-hero-actions">
            <a
              href="/sign-up"
              className={buttonVariants({ size: "lg" })}
              onClick={(event) => navigateInsideApp(event, "/sign-up", onNavigate)}
            >
              Create your room <ArrowRight data-icon="inline-end" />
            </a>
            <a
              href="/login"
              className={buttonVariants({ variant: "outline", size: "lg" })}
              onClick={(event) => navigateInsideApp(event, "/login", onNavigate)}
            >
              Sign in
            </a>
          </div>
          <p className="landing-invite-note"><Link2 aria-hidden="true" /> Invite required to create an account.</p>
        </div>

        <div className="landing-preview-stage">
          <span className="landing-reaction landing-reaction-heart" aria-hidden="true">♥</span>
          <span className="landing-reaction landing-reaction-fire" aria-hidden="true">🔥</span>
          <Card className="landing-preview" aria-label="Preview of a Lydman listening room">
            <CardHeader className="landing-preview-header">
              <div>
                <CardTitle>Friday night radio</CardTitle>
                <CardDescription><span className="landing-live-dot" /> 6 listening now</CardDescription>
              </div>
              <div className="landing-avatar-stack" aria-label="Maya, Noah, Liv, and Leo are listening">
                {SAMPLE_USERS.map((user) => <Avatar key={user.id} user={user} size={30} />)}
                <span className="landing-avatar-more" aria-hidden="true">+2</span>
              </div>
            </CardHeader>
            <CardContent className="landing-preview-content">
              <section className="landing-now-playing" aria-label="Now playing Afterglow by Night Drive">
                <div className="landing-album-art" aria-hidden="true">
                  <Music2 />
                  <span className="landing-album-orbit" />
                </div>
                <div className="landing-track-copy">
                  <span className="landing-preview-label">Now playing</span>
                  <strong>Afterglow</strong>
                  <small>Night Drive</small>
                  <div className="landing-track-progress" aria-hidden="true"><span /></div>
                  <div className="landing-track-time" aria-hidden="true"><span>1:48</span><span>3:36</span></div>
                </div>
                <div className="landing-equalizer" aria-label="Playing">
                  <i /><i /><i /><i />
                </div>
              </section>

              <div className="landing-preview-columns">
                <section className="landing-preview-panel" aria-labelledby="landing-queue-title">
                  <div className="landing-preview-panel-heading">
                    <span id="landing-queue-title">Up next</span>
                    <Badge variant="secondary">Maya&apos;s turn</Badge>
                  </div>
                  <ol className="landing-queue">
                    <li><span>01</span><div><strong>Velvet Sky</strong><small>Solar Echo</small></div><Avatar user={SAMPLE_USERS[0]} size={24} /></li>
                    <li><span>02</span><div><strong>City Lights</strong><small>June Arcade</small></div><Avatar user={SAMPLE_USERS[1]} size={24} /></li>
                  </ol>
                </section>

                <section className="landing-preview-panel" aria-labelledby="landing-chat-title">
                  <div className="landing-preview-panel-heading">
                    <span id="landing-chat-title">Room chat</span>
                    <MessageCircle aria-hidden="true" />
                  </div>
                  <div className="landing-chat-preview">
                    <div><Avatar user={SAMPLE_USERS[2]} size={24} /><p><strong>Liv</strong><span>This intro is everything ✨</span></p></div>
                    <div><Avatar user={SAMPLE_USERS[3]} size={24} /><p><strong>Leo</strong><span>Wait for the drop</span></p></div>
                  </div>
                </section>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="landing-providers" aria-labelledby="landing-providers-title">
        <div>
          <span className="landing-section-kicker">PLAY IT YOUR WAY</span>
          <h2 id="landing-providers-title">Your music, your service.</h2>
        </div>
        <div className="landing-provider-list" aria-label="Supported music services">
          {["YouTube", "SoundCloud", "Spotify", "Apple Music"].map((provider) => (
            <Badge variant="outline" key={provider}><Music2 data-icon="inline-start" /> {provider}</Badge>
          ))}
        </div>
      </section>

      <section className="landing-section landing-features" id="features" aria-labelledby="landing-features-title">
        <div className="landing-section-heading">
          <span className="landing-section-kicker">BUILT FOR THE GROUP CHAT</span>
          <h2 id="landing-features-title">Less fighting over the aux.<br />More finding the next favorite.</h2>
        </div>
        <div className="landing-feature-grid">
          {BENEFITS.map(({ icon: Icon, title, description, note }) => (
            <Card className="landing-feature-card" key={title}>
              <CardHeader>
                <span className="landing-feature-icon"><Icon aria-hidden="true" /></span>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent><Badge variant="secondary">{note}</Badge></CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="landing-section landing-how" id="how-it-works" aria-labelledby="landing-how-title">
        <div className="landing-section-heading">
          <span className="landing-section-kicker">THREE STEPS. ZERO AUX DRAMA.</span>
          <h2 id="landing-how-title">From link to listening in minutes.</h2>
        </div>
        <ol className="landing-step-grid">
          {STEPS.map(({ icon: Icon, title, description }, index) => (
            <li key={title}>
              <span className="landing-step-number">0{index + 1}</span>
              <span className="landing-step-icon"><Icon aria-hidden="true" /></span>
              <div><h3>{title}</h3><p>{description}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-cta" aria-labelledby="landing-cta-title">
        <div className="landing-cta-decoration" aria-hidden="true"><Users /><Music2 /><Sparkles /></div>
        <span className="landing-section-kicker">THE ROOM IS WAITING</span>
        <h2 id="landing-cta-title">Ready for your next listening night?</h2>
        <p>Bring the people. We&apos;ll keep the music together.</p>
        <div className="landing-cta-actions">
          <a
            href="/sign-up"
            className={buttonVariants({ size: "lg" })}
            onClick={(event) => navigateInsideApp(event, "/sign-up", onNavigate)}
          >
            Sign up <ArrowRight data-icon="inline-end" />
          </a>
          <a
            href="/login"
            className={buttonVariants({ variant: "outline", size: "lg" })}
            onClick={(event) => navigateInsideApp(event, "/login", onNavigate)}
          >
            Sign in
          </a>
        </div>
        <p className="landing-invite-note"><Link2 aria-hidden="true" /> Invite required to create an account.</p>
      </section>

      <footer className="landing-footer">
        <Brand />
        <p>Shared listening, kept simple.</p>
        <small>© {new Date().getFullYear()} Lydman</small>
      </footer>
    </main>
  );
}
