import { z } from 'zod'
import {
  JOKER_ATTACHMENT_CONTENT_TEMPLATE,
  JOKER_ATTACHMENT_DIAGNOSTICS_TEMPLATE,
  JOKER_ATTACHMENTS_TEMPLATE,
  JOKER_ATTACHMENT_TEMPLATE,
  JOKER_HEALTH_TEMPLATE,
  JOKER_MEMORY_DIAGNOSTICS_TEMPLATE,
  JOKER_MEMORY_RECORD_TEMPLATE,
  JOKER_MEMORY_TEMPLATE,
  JOKER_MCP_OAUTH_SERVER_TEMPLATE,
  JOKER_MCP_OAUTH_TEMPLATE,
  JOKER_RUNTIME_INFO_TEMPLATE,
  JOKER_RUNTIME_TOOLS_TEMPLATE,
  JOKER_SUPPLY_CHAIN_AUDIT_TEMPLATE,
  JOKER_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE,
  JOKER_SESSION_RESUME_TEMPLATE,
  JOKER_SKILLS_TEMPLATE,
  JOKER_THREADS_TEMPLATE,
  JOKER_THREAD_COMPACT_TEMPLATE,
  JOKER_THREAD_FORK_TEMPLATE,
  JOKER_THREAD_GOAL_TEMPLATE,
  JOKER_THREAD_REVIEW_TEMPLATE,
  JOKER_THREAD_REWIND_TEMPLATE,
  JOKER_THREAD_TODOS_TEMPLATE,
  JOKER_THREAD_TURN_TEMPLATE,
  JOKER_THREAD_TURNS_TEMPLATE,
  JOKER_THREAD_INTERRUPT_TEMPLATE,
  JOKER_THREAD_STEER_TEMPLATE,
  JOKER_THREAD_TEMPLATE,
  JOKER_USER_INPUT_TEMPLATE,
  JOKER_USAGE_TEMPLATE,
  JOKER_DEBUG_LLM_ROUNDS_TEMPLATE,
  JOKER_BACKGROUND_SHELLS_TEMPLATE,
  JOKER_BACKGROUND_SHELL_TEMPLATE
} from '../../../shared/Joker-endpoints'
import { MODEL_ENDPOINT_FORMATS } from '../../../shared/app-settings'
import { MAX_BODY_BYTES, MAX_URL_LENGTH, trimmedString } from './common'
export const providerProbePayloadSchema = z
  .object({
    baseUrl: trimmedString(MAX_URL_LENGTH),
    apiKey: z.string().max(8_192),
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS)
  })
  .strict()

export const promptOptimizationPayloadSchema = z
  .object({
    text: trimmedString(100_000),
    model: z.string().trim().optional(),
    providerId: z.string().trim().optional()
  })
  .strict()

interface EndpointTemplate {
  /** Compiled path matcher. */
  match(path: string): boolean
  allowedMethods: readonly string[]
}

function compileEndpoint(
  template: string,
  allowedMethods: readonly string[]
): EndpointTemplate {
  // Build a regex from the template by escaping the literal parts and
  // substituting the `{id}` / `{turn}` placeholders with `[^/]+`. The
  // template fragments are URL-encoded by the path helpers, so they
  // contain only characters that are safe to escape directly.
  const pattern = template.replace(/[.+*?^$()|[\]\\]/g, '\\$&').replace(/\{(?:id|turn)\}/g, '[^/]+')
  const regex = new RegExp(`^${pattern}$`)
  return {
    match: (path: string) => regex.test(path),
    allowedMethods
  }
}

const ENDPOINTS: readonly EndpointTemplate[] = [
  compileEndpoint(JOKER_HEALTH_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_RUNTIME_INFO_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_RUNTIME_TOOLS_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_SUPPLY_CHAIN_AUDIT_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_SKILLS_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_ATTACHMENTS_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_ATTACHMENT_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_ATTACHMENT_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_ATTACHMENT_CONTENT_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_MEMORY_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(JOKER_MEMORY_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_MEMORY_RECORD_TEMPLATE, ['PATCH', 'DELETE']),
  compileEndpoint(JOKER_MCP_OAUTH_TEMPLATE, ['GET', 'DELETE']),
  compileEndpoint(JOKER_MCP_OAUTH_SERVER_TEMPLATE, ['DELETE']),
  compileEndpoint(JOKER_THREADS_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(JOKER_THREAD_TEMPLATE, ['GET', 'PATCH', 'DELETE']),
  compileEndpoint(JOKER_THREAD_FORK_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_THREAD_GOAL_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(JOKER_THREAD_TODOS_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(JOKER_THREAD_COMPACT_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_THREAD_REVIEW_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_THREAD_REWIND_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_THREAD_TURNS_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_THREAD_TURN_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_THREAD_STEER_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_THREAD_INTERRUPT_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_USER_INPUT_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_SESSION_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(JOKER_USAGE_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_DEBUG_LLM_ROUNDS_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_BACKGROUND_SHELLS_TEMPLATE, ['GET']),
  compileEndpoint(JOKER_BACKGROUND_SHELL_TEMPLATE, ['GET']),
  compileEndpoint(`${JOKER_BACKGROUND_SHELL_TEMPLATE}/stop`, ['POST'])
]

function isAllowedRuntimeRequest(value: { path: string; method?: string }): boolean {
  try {
    const url = new URL(value.path, 'http://localhost')
    const path = url.pathname
    const method = value.method ?? 'GET'
    for (const endpoint of ENDPOINTS) {
      if (endpoint.match(path)) {
        return endpoint.allowedMethods.includes(method)
      }
    }
    return false
  } catch {
    return false
  }
}

export const runtimeRequestPayloadSchema = z
  .object({
    path: trimmedString(MAX_URL_LENGTH).transform((value) =>
      value.startsWith('/') ? value : `/${value}`
    ),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    body: z.string().max(MAX_BODY_BYTES).optional()
  })
  .refine((payload) => isAllowedRuntimeRequest(payload), {
    message: 'runtime request path is not allowed'
  })
  .strict()

export const JokerProtectedApprovalPayloadSchema = z
  .object({
    approvalId: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
    decision: z.enum(['allow', 'deny']),
    source: z.enum(['policy', 'user'])
  })
  .strict()
