import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills');

function parseSkill(file) {
  const text = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (match === null) return undefined;
  const fields = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const field = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/u.exec(line);
    if (field === null) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[field[1]] = value;
  }
  return {
    name: fields.name,
    description: fields.description,
    whenToUse: fields.whenToUse,
    content: match[2],
  };
}

function registerBundledSkills(skills) {
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const skill = parseSkill(file);
      if (skill === undefined || !skill.name || !skill.description) continue;
      skills.register({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        content: skill.content,
        source: 'bundled',
        provider: 'dev-modes',
      });
    } catch {
      // A malformed bundled skill must not break the bundle.
    }
  }
}

export function apply(ctx) {
  ctx.inject(['skills'], (scoped) => {
    try {
      registerBundledSkills(scoped.skills);
    } catch {
      // Registration is best effort; presets keep working without skills.
    }
  });
}
