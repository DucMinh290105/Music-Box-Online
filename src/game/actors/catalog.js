/** MusicBox default roster, 20 shipped assets. Pass URL prefix for deployment sub-paths. */
export const AVATAR_COUNT = 20;
export const ACTIONS = Object.freeze([
  'idle', 'walk', 'run', 'jump', 'sit', 'sing', 'dance', 'wave',
  'clap', 'cheer', 'laugh', 'shy', 'heart', 'interact'
]);
export const EMOTIONS = Object.freeze(['neutral','happy','sing','shy','surprised']);

export function isValidAvatarId(id) {
  return /^chibi-(0[1-9]|1[0-9]|20)$/.test(String(id));
}
export async function fetchRoster(baseUrl = '') {
  const response = await fetch(`${baseUrl}/catalog/characters.json`);
  if (!response.ok) throw new Error(`Cannot load character roster: ${response.status}`);
  const roster = await response.json();
  if (!Array.isArray(roster) || roster.length !== 20) throw new Error('Roster must contain exactly 20 avatars');
  return roster;
}
export function assetUrl(data, baseUrl = '') {
  return `${baseUrl}${data.asset}`;
}
