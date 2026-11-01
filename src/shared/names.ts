const COLORS = [
  '#e7cfb4',
  '#fbcfe8',
  '#d9e4b4',
  '#e5d3c3',
  '#fde68a',
  '#a5f3fc',
  '#fecaca',
  '#c7d2fe',
  '#d9f99d',
  '#fed7aa',
  '#e9d5ff',
  '#bae6fd',
  '#bbf7d0',
  '#fda4af',
  '#fef08a',
  '#e2e8f0',
  '#ddd6fe',
  '#a7f3d0',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Persona {
  name: string;
  avatarUrl: string;
  color: string;
}

export function persona(visitorId: string): Persona {
  const h = hash(visitorId);
  const seed = h.toString(36);
  const color = COLORS[h % COLORS.length];
  return {
    name: `Visitor ${seed}`,
    avatarUrl: `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=${color.slice(1)}`,
    color,
  };
}

/** A real name when we know it (identify() or a payment), otherwise a stable visitor label. */
export function displayName(visitorId: string, name?: string | null, email?: string | null): string {
  return name || email || persona(visitorId).name;
}
