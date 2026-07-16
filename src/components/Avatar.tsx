import type { User } from "../types";

function hash(value: string) {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);
}

export const AVATAR_STYLES: Record<string, { glyph: string; gradient: string }> = {
  pulse: { glyph: "◖◗", gradient: "linear-gradient(135deg,#d8ff57,#568d2f)" },
  sunset: { glyph: "☀", gradient: "linear-gradient(135deg,#ffb347,#e45368)" },
  orbit: { glyph: "✦", gradient: "linear-gradient(135deg,#65d8ff,#5c55cf)" },
  midnight: { glyph: "☾", gradient: "linear-gradient(135deg,#8476ff,#24203f)" },
  prism: { glyph: "◆", gradient: "linear-gradient(135deg,#ff69c8,#6c5cff,#55e6c1)" },
  voltage: { glyph: "⚡", gradient: "linear-gradient(135deg,#faff72,#10a7a1)" }
};

export function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const hue = hash(user.avatarSeed) % 360;
  const unlockedStyle = user.avatarKey ? AVATAR_STYLES[user.avatarKey] : undefined;
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className="avatar"
      title={user.name}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.34),
        background: unlockedStyle?.gradient || `linear-gradient(135deg, hsl(${hue} 72% 62%), hsl(${(hue + 65) % 360} 78% 43%))`
      }}
    >
      {unlockedStyle?.glyph || initials}
    </span>
  );
}
