/**
 * Agent Profiles Generation API
 *
 * Generates agent profiles (teacher, assistant, student) for a course stage
 * based on stage info and scene outlines.
 */

import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { AGENT_COLOR_PALETTE } from '@/lib/constants/agent-defaults';

const log = createLogger('Agent Profiles API');

export const maxDuration = 120;

interface RequestBody {
  stageInfo: { name: string; description?: string };
  sceneOutlines?: { title: string; description?: string }[];
  language: string;
  availableAvatars: string[];
  avatarDescriptions?: Array<{ path: string; desc: string }>;
  availableVoices?: Array<{ providerId: string; voiceId: string; voiceName: string }>;
  selectedAgents?: SelectedAgentHint[];
}

interface SelectedAgentHint {
  id: string;
  name: string;
  role: string;
  persona?: string;
  avatar?: string;
  color?: string;
  voice?: string;
}

interface ParsedAgentProfile {
  name: string;
  role: string;
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  voice?: string;
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

function normalizeClassmateRole(role: string): 'assistant' | 'student' {
  return role === 'assistant' ? 'assistant' : 'student';
}

function buildSelectedClassmatePrompt(selectedAgents: SelectedAgentHint[]): string {
  if (selectedAgents.length === 0) return '';

  const promptPayload = selectedAgents.map((agent) => ({
    name: agent.name,
    role: normalizeClassmateRole(agent.role),
    persona: agent.persona || '',
    avatar: agent.avatar || '',
  }));

  return `
User-selected classmate archetypes (mandatory in auto-generation mode):
${JSON.stringify(promptPayload, null, 2)}

Requirements for selected classmates:
- Include one generated assistant/student agent for EACH selected archetype above.
- Keep each selected classmate's exact name and normalized role.
- Preserve the recognizable personality while adapting the persona to this course.
- These classmates should be suitable for asking questions or initiating discussions during playback.
`;
}

function buildFallbackPersona(agent: SelectedAgentHint, language: string): string {
  const persona = agent.persona?.trim();
  const personaReference = persona ? persona.slice(0, 500) : '';

  if (language.startsWith('zh')) {
    return personaReference
      ? `保留所选角色的性格，并结合本课程在恰当时提出简短问题或开启讨论。角色参考：${personaReference}`
      : '保留所选同学角色的课堂性格，并结合本课程在恰当时提出简短问题或开启讨论。';
  }

  return personaReference
    ? `Keeps the selected classmate persona and adapts it to this course. This agent asks concise questions or opens discussion when helpful. Persona reference: ${personaReference}`
    : 'Keeps the selected classmate persona and adapts it to this course, asking concise questions or opening discussion when helpful.';
}

function pickUnusedValue(values: readonly string[], used: Set<string>, preferred?: string): string {
  if (preferred && values.includes(preferred) && !used.has(preferred)) return preferred;
  return values.find((value) => !used.has(value)) || values[0] || preferred || '';
}

function appendMissingSelectedClassmates(
  agents: ParsedAgentProfile[],
  selectedAgents: SelectedAgentHint[],
  availableAvatars: string[],
  language: string,
): ParsedAgentProfile[] {
  if (selectedAgents.length === 0) return agents;

  const result = [...agents];
  const selectedByName = new Map(selectedAgents.map((agent) => [agent.name.trim(), agent]));
  for (const agent of result) {
    const selectedAgent = selectedByName.get(agent.name.trim());
    if (!selectedAgent) continue;
    agent.role = normalizeClassmateRole(selectedAgent.role);
    agent.priority = agent.role === 'assistant' ? 7 : 5;
  }

  const usedNames = new Set(result.map((agent) => agent.name.trim()));
  const usedAvatars = new Set(result.map((agent) => agent.avatar).filter(Boolean));
  const usedColors = new Set(result.map((agent) => agent.color).filter(Boolean));

  for (const selectedAgent of selectedAgents) {
    const selectedName = selectedAgent.name.trim();
    if (!selectedName || usedNames.has(selectedName)) continue;

    const role = normalizeClassmateRole(selectedAgent.role);
    const avatar = pickUnusedValue(availableAvatars, usedAvatars, selectedAgent.avatar);
    const color = pickUnusedValue(AGENT_COLOR_PALETTE, usedColors, selectedAgent.color);

    result.push({
      name: selectedName,
      role,
      persona: buildFallbackPersona(selectedAgent, language),
      avatar,
      color,
      priority: role === 'assistant' ? 7 : 5,
      ...(selectedAgent.voice ? { voice: selectedAgent.voice } : {}),
    });

    usedNames.add(selectedName);
    usedAvatars.add(avatar);
    usedColors.add(color);
  }

  return result;
}

export async function POST(req: NextRequest) {
  let stageName: string | undefined;
  let modelString: string | undefined;
  try {
    const body = (await req.json()) as RequestBody;
    const {
      stageInfo,
      sceneOutlines,
      language,
      availableAvatars,
      avatarDescriptions,
      availableVoices,
      selectedAgents: rawSelectedAgents,
    } = body;
    stageName = stageInfo?.name;

    // ── Validate required fields ──
    if (!stageInfo?.name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageInfo.name is required');
    }
    if (!language) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'language is required');
    }
    if (!availableAvatars || availableAvatars.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'availableAvatars is required and must not be empty',
      );
    }

    const selectedClassmateAgents = (rawSelectedAgents ?? [])
      .filter((agent) => agent.role !== 'teacher' && agent.name?.trim())
      .map((agent) => ({
        ...agent,
        role: normalizeClassmateRole(agent.role),
        name: agent.name.trim(),
      }));

    // ── Model resolution from request headers ──
    const { model: languageModel, modelString: _modelString } = await resolveModelFromHeaders(req);
    modelString = _modelString;

    // ── Build prompt ──
    const sceneSummary = sceneOutlines?.length
      ? sceneOutlines
          .map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`)
          .join('\n')
      : null;
    const selectedClassmatePrompt = buildSelectedClassmatePrompt(selectedClassmateAgents);

    const systemPrompt = `You are an expert instructional designer. Generate agent profiles for a multi-agent classroom simulation. Decide the appropriate number of agents (typically 3-5) based on the course content and complexity. Return ONLY valid JSON, no markdown or explanation.`;

    // Build voice list for prompt (if available)
    const voiceListStr =
      availableVoices && availableVoices.length > 0
        ? JSON.stringify(
            availableVoices.map((v) => ({
              id: `${v.providerId}::${v.voiceId}`,
              name: v.voiceName,
            })),
          )
        : '';

    const voicePrompt = voiceListStr
      ? `- Each agent should be assigned a voice that matches their persona from this list: ${voiceListStr}
  - Pick a voice that suits the agent's personality and role (e.g. authoritative voice for teacher, lively voice for energetic student)
  - Try to use different voices for each agent`
      : '';

    const voiceJsonField = voiceListStr
      ? ',\n      "voice": "string (voice id from available list, e.g. \'qwen-tts::Cherry\')"'
      : '';

    const userPrompt = `Generate agent profiles for the following course:

Course name: ${stageInfo.name}
${stageInfo.description ? `Course description: ${stageInfo.description}` : ''}
${sceneSummary ? `\nScene outlines:\n${sceneSummary}\n` : ''}
${selectedClassmatePrompt}
Requirements:
- Decide the appropriate number of agents based on the course content (typically 3-5, or more if needed to include all user-selected classmates)
- Exactly 1 agent must have role "teacher", the rest can be "assistant" or "student"
- Priority values: teacher=10 (highest), assistant=7, student=4-6
- Each agent needs: name, role, persona (2-3 sentences describing personality and teaching/learning style)
- Names and personas must be in language: ${language}
- Each agent must be assigned one avatar from this list: ${JSON.stringify(avatarDescriptions && avatarDescriptions.length > 0 ? avatarDescriptions.map((a) => ({ path: a.path, description: a.desc })) : availableAvatars)}
  - Pick an avatar that visually matches the agent's personality and role
  - Try to use different avatars for each agent
  - Use the "path" value as the avatar field in the output
- Each agent must be assigned one color from this list: ${JSON.stringify(AGENT_COLOR_PALETTE)}
  - Each agent must have a different color
${voicePrompt}

Return a JSON object with this exact structure:
{
  "agents": [
    {
      "name": "string",
      "role": "teacher" | "assistant" | "student",
      "persona": "string (2-3 sentences)",
      "avatar": "string (from available list)",
      "color": "string (hex color from palette)",
      "priority": number (10 for teacher, 7 for assistant, 4-6 for student)${voiceJsonField}
    }
  ]
}`;

    log.info(`Generating agent profiles for "${stageInfo.name}" [model=${modelString}]`);

    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      'agent-profiles',
    );

    // ── Parse LLM response ──
    const rawText = stripCodeFences(result.text);
    let parsed: {
      agents: ParsedAgentProfile[];
    };

    try {
      parsed = JSON.parse(rawText);
    } catch {
      log.error('Failed to parse LLM response as JSON:', rawText.substring(0, 500));
      return apiError('PARSE_FAILED', 500, 'Failed to parse agent profiles from LLM response');
    }

    if (Array.isArray(parsed.agents)) {
      parsed.agents = appendMissingSelectedClassmates(
        parsed.agents,
        selectedClassmateAgents,
        availableAvatars,
        language,
      );
    }

    // ── Validate parsed structure ──
    if (!parsed.agents || !Array.isArray(parsed.agents) || parsed.agents.length < 2) {
      log.error(`Expected at least 2 agents, got ${parsed.agents?.length ?? 0}`);
      return apiError(
        'GENERATION_FAILED',
        500,
        `Expected at least 2 agents but LLM returned ${parsed.agents?.length ?? 0}`,
      );
    }

    const teacherCount = parsed.agents.filter((a) => a.role === 'teacher').length;
    if (teacherCount !== 1) {
      log.error(`Expected exactly 1 teacher, got ${teacherCount}`);
      return apiError(
        'GENERATION_FAILED',
        500,
        `Expected exactly 1 teacher but LLM returned ${teacherCount}`,
      );
    }

    // ── Build output with IDs ──
    const agents = parsed.agents.map((agent, index) => {
      // Parse voice "providerId::voiceId" format
      let voiceConfig: { providerId: string; voiceId: string } | undefined;
      if (agent.voice && agent.voice.includes('::')) {
        const [providerId, voiceId] = agent.voice.split('::');
        if (providerId && voiceId) {
          voiceConfig = { providerId, voiceId };
        }
      }

      return {
        id: `gen-${nanoid(8)}`,
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        avatar: agent.avatar || availableAvatars[index % availableAvatars.length],
        color: agent.color || AGENT_COLOR_PALETTE[index % AGENT_COLOR_PALETTE.length],
        priority:
          agent.priority ?? (agent.role === 'teacher' ? 10 : agent.role === 'assistant' ? 7 : 5),
        ...(voiceConfig ? { voiceConfig } : {}),
      };
    });

    log.info(`Successfully generated ${agents.length} agent profiles for "${stageInfo.name}"`);

    return apiSuccess({ agents });
  } catch (error) {
    log.error(
      `Agent profiles generation failed [stage="${stageName ?? 'unknown'}", model=${modelString ?? 'unknown'}]:`,
      error,
    );
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
