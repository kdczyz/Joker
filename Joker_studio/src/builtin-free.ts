/**
 * 内置免费 AI 接口配置 (OpenCode Zen)。
 * 直接从手机端调用上游 API，不经过 Cloudflare Worker 中转，
 * 让每个设备拥有独立的速率限制配额。
 */

export const BUILTIN_FREE_PROVIDER_ID = "__joker_builtin_free__";

export const BUILTIN_FREE_BASE_URL = "https://opencode.ai/zen/v1";
export const BUILTIN_FREE_CHAT_PATH = "/chat/completions";

export const BUILTIN_FREE_MODELS = [
  "big-pickle",
  "hy3-free",
  "ling-3.0-flash-fin-free",
  "mimo-v2.5-free",
  "muse-spark-1.2-contributor-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free"
];

export const BUILTIN_FREE_DEFAULT_MODEL = "big-pickle";

/**
 * 上游 OpenCode Zen 用于区分客户端配额桶的请求头。
 * 使用 "desktop" 标识以获取更宽松的免费额度。
 */
export const BUILTIN_FREE_HEADERS: Record<string, string> = {
  "user-agent": "opencode/1.2.0",
  "x-opencode-client": "desktop"
};

export function isBuiltinFreeProvider(providerId: string | undefined): boolean {
  return providerId === BUILTIN_FREE_PROVIDER_ID;
}
