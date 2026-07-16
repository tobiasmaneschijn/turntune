export const TRACK_LIKED_XP = 10;

export function levelForXp(xp: number) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 25)) + 1;
}
