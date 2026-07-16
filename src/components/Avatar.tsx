import type { User } from "../types";

function hash(value: string) {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);
}

export function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const hue = hash(user.avatarSeed) % 360;
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
        background: `linear-gradient(135deg, hsl(${hue} 72% 62%), hsl(${(hue + 65) % 360} 78% 43%))`
      }}
    >
      {initials}
    </span>
  );
}
