export const TRACK_LIKED_XP = 10;

export function xpForLevel(level: number) {
  return 25 * Math.max(0, level - 1) ** 2;
}

export function levelForXp(xp: number) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 25)) + 1;
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const currentFloor = xpForLevel(level);
  const nextFloor = xpForLevel(level + 1);
  return {
    level,
    currentFloor,
    nextFloor,
    progress: nextFloor === currentFloor ? 1 : (xp - currentFloor) / (nextFloor - currentFloor)
  };
}
