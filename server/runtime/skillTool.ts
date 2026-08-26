/**
 * Built-in `load_skill` tool backend (P1).
 *
 * Lets the model explicitly load a skill's full instructions on demand.
 * Complements the automatic prompt-keyword activation in contextManager:
 * low-scoring skills or explicit user references ($name) that auto-activation
 * misses can be pulled in by the model itself. The available skill catalog is
 * injected into the system prompt (stable, sorted) so the model knows which
 * ids are loadable — see skillCatalogPrompt().
 */

import { listSkills, loadSkillContent, type AgentSkill } from "../agent/skills.js";

export const LOAD_SKILL_MAX_CONTENT_CHARS = 12_000;

function skillLine(skill: AgentSkill): string {
  return `- ${skill.name}: ${skill.description}`;
}

/**
 * Byte-stable catalog block for the system prompt. Sorted by name so the
 * bytes don't churn when the filesystem readdir order changes.
 */
export async function skillCatalogPrompt(projectPath?: string): Promise<string> {
  let skills: AgentSkill[] = [];
  try {
    skills = await listSkills(projectPath);
  } catch {
    return "";
  }
  if (skills.length === 0) return "";
  const lines = [...skills].sort((a, b) => a.name.localeCompare(b.name)).map(skillLine);
  return [
    "Available skills (load full instructions with the load_skill tool when relevant):",
    ...lines,
    ""
  ].join("\n");
}

export interface LoadSkillResult {
  ok: boolean;
  content: string;
}

export async function runLoadSkillTool(input: { skill_id?: unknown }, projectPath?: string): Promise<LoadSkillResult> {
  const requested = typeof input.skill_id === "string" ? input.skill_id.trim() : "";
  if (!requested) {
    return { ok: false, content: "skill_id is required." };
  }

  const skills = await listSkills(projectPath);
  const match =
    skills.find((skill) => skill.name === requested) ??
    skills.find((skill) => skill.name.toLowerCase() === requested.toLowerCase());

  if (!match) {
    const names = skills.map((skill) => skill.name).sort((a, b) => a.localeCompare(b));
    return {
      ok: false,
      content: `Unknown skill "${requested}". Available skills:\n${names.map((name) => `- ${name}`).join("\n")}`
    };
  }

  const raw = await loadSkillContent(match.path, projectPath);
  const content = raw.slice(0, LOAD_SKILL_MAX_CONTENT_CHARS);
  const truncatedNote = raw.length > content.length ? `\n\n[truncated to ${LOAD_SKILL_MAX_CONTENT_CHARS} chars]` : "";
  return {
    ok: true,
    content: `# Skill: ${match.name} (${match.scope})\n\n${content}${truncatedNote}`
  };
}
