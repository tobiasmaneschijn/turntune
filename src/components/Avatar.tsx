import { approvedImageUrl } from "../lib/remote-images";
import type { User } from "../types";

const BUILT_IN_AVATARS = new Set(["pulse", "sunset", "orbit", "midnight", "prism", "voltage"]);

function hash(value: string) {
  return [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);
}

export function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  const hue = hash(user.avatarSeed) % 360;
  const avatarKey = user.avatarKey && BUILT_IN_AVATARS.has(user.avatarKey) ? user.avatarKey : "pulse";
  const imageUrl = approvedImageUrl(user.avatarUrl) || `/avatars/${avatarKey}.svg`;
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
        fontSize: Math.max(10, size * 0.3),
        background: `linear-gradient(135deg, hsl(${hue} 72% 62%), hsl(${(hue + 65) % 360} 78% 43%))`
      }}
    >
      <span className="avatar-initials" aria-hidden="true">{initials}</span>
      <img
        referrerPolicy="no-referrer"
        key={imageUrl}
        src={imageUrl}
        alt=""
        aria-hidden="true"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}
