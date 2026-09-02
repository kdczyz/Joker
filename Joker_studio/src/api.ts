import { Preferences } from "@capacitor/preferences";
import { CapacitorHttp } from "@capacitor/core";
import type { HttpResponse } from "@capacitor/core";

export const API_BASE = (import.meta.env.VITE_AUTH_API_URL || "https://lxqandlzy.me").replace(/\/$/, "");
const TOKEN_KEY = "joker.auth.token.v1";
const USER_KEY = "joker.auth.user.v1";
const LOCAL_PREFIX = "joker.mobile.";
const REQUEST_TIMEOUT_MS = 15_000;
const WORK_REQUEST_TIMEOUT_MS = 65_000;
const WORK_STREAM_TIMEOUT_MS = 125_000;
const WORK_IMAGE_STREAM_TIMEOUT_MS = 195_000;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
}

export interface AuthResult {
  token: string;
  user: User;
  expiresAt: string;
}

export interface RemoteDevice {
  id: string;
  name: string;
  platform: string;
  appVersion?: string;
  projectName?: string;
  workspace?: RemoteWorkspace;
  ready: boolean;
  online: boolean;
  lastSeenAt: number;
}

export interface RemoteWorkspaceSession {
  id: string;
  title: string;
  updatedAt: string;
  conversationId?: string;
}

export interface RemoteWorkspaceProject {
  id: string;
  name: string;
  sessions: RemoteWorkspaceSession[];
}

export interface RemoteWorkspaceProvider {
  id: string;
  displayName: string;
  model: string;
  models: string[];
}

export interface RemoteWorkspace {
  projects: RemoteWorkspaceProject[];
  models: string[];
  defaultModel?: string;
  activeProjectId?: string;
  providers?: RemoteWorkspaceProvider[];
}

export type CommandStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed";

export interface RemoteCommand {
  id: string;
  requestId: string;
  deviceId: string;
  action: "agent.run" | "agent.approve";
  status: CommandStatus;
  summary?: string;
  projectId?: string;
  sessionId?: string;
  model?: string;
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteHistoryEvent {
  id: string;
  commandId: string;
  type: string;
  event: Record<string, unknown>;
  createdAt: number;
}

export interface RemoteSnapshot {
  devices: RemoteDevice[];
  commands: RemoteCommand[];
  events?: RemoteHistoryEvent[];
}

export async function readToken() {
  return (await Preferences.get({ key: TOKEN_KEY })).value ?? undefined;
}

export async function writeToken(token?: string) {
  if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
  else await Preferences.remove({ key: TOKEN_KEY });
}

export async function readCachedUser() {
  const value = (await Preferences.get({ key: USER_KEY })).value;
  if (!value) return undefined;
  try { return JSON.parse(value) as User; } catch { return undefined; }
}

export async function writeCachedUser(user?: User) {
  if (user) await Preferences.set({ key: USER_KEY, value: JSON.stringify(user) });
  else await Preferences.remove({ key: USER_KEY });
}

export async function readLocalState<T>(key: string, fallback: T): Promise<T> {
  const value = (await Preferences.get({ key: `${LOCAL_PREFIX}${key}` })).value;
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function writeLocalState(key: string, value: unknown) {
  await Preferences.set({ key: `${LOCAL_PREFIX}${key}`, value: JSON.stringify(value) });
}

export async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (authenticated) {
    const token = await readToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), path === "/v1/work/images" ? 190_000 : path === "/v1/work/chat" ? WORK_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
    const body = await response.json().catch(() => ({ error: "服务器返回格式不正确" }));
    if (!response.ok) {
      if (response.status === 401) {
        await writeToken();
        await writeCachedUser();
      }
      throw new ApiError(
        typeof body.error === "string" ? body.error : `请求失败 (${response.status})`,
        response.status,
        typeof body.code === "string" ? body.code : undefined
      );
    }
    return body as T;
  } catch (reason) {
    if (reason instanceof ApiError) throw reason;
    if (controller.signal.aborted && !init.signal?.aborted) throw new Error("连接超时，请检查网络后重试");
    if (reason instanceof TypeError) throw new Error("无法连接到 Joker 服务，请检查网络后重试");
    throw reason instanceof Error ? reason : new Error("网络请求失败，请稍后重试");
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

export type WorkStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "image"; model: string; images: GeneratedImage[] }
  | { type: "done"; model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: "error"; error: string };

export interface GeneratedImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  url?: string;
  revisedPrompt?: string;
}

export async function generateWorkImage(payload: {
  prompt: string;
  providerId?: string;
  model?: string;
  size?: string;
  quality?: string;
  count?: number;
}) {
  return request<{ providerId: string; model: string; images: GeneratedImage[] }>("/v1/work/images", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function streamWorkChat(
  payload: { messages: Array<{ role: "user" | "assistant"; content: string }>; providerId?: string; model?: string; imageModel?: string; thinkingMode?: "fast" | "balanced" | "deep"; autoImage?: boolean },
  onEvent: (event: WorkStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const headers = new Headers({ "content-type": "application/json", accept: "text/event-stream" });
  const token = await readToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), payload.autoImage ? WORK_IMAGE_STREAM_TIMEOUT_MS : WORK_STREAM_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${API_BASE}/v1/work/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `请求失败 (${response.status})` })) as { error?: string; code?: string };
      if (response.status === 401) {
        await writeToken();
        await writeCachedUser();
      }
      throw new ApiError(body.error || `请求失败 (${response.status})`, response.status, body.code);
    }
    if (!response.body) throw new Error("服务器未返回实时响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    const processBlock = (block: string) => {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data) return;
      let event: WorkStreamEvent;
      try { event = JSON.parse(data) as WorkStreamEvent; } catch { return; }
      if (event.type === "error") throw new Error(event.error || "实时回复中断");
      if (event.type === "done") completed = true;
      onEvent(event);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) processBlock(block);
      // `done` is the protocol-level end marker. Close locally right away even
      // when an intermediary leaves the HTTP connection alive for a moment.
      if (completed) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    if (!completed) {
      buffer += decoder.decode();
      if (buffer.trim()) processBlock(buffer);
    }
    if (!completed) throw new Error("实时回复提前结束，请重试");
  } catch (reason) {
    if (reason instanceof ApiError) throw reason;
    if (signal?.aborted) throw new DOMException("对话已停止", "AbortError");
    if (controller.signal.aborted) throw new Error("实时回复超时，请稍后重试");
    if (reason instanceof TypeError) throw new Error("无法连接到 Joker 服务，请检查网络后重试");
    throw reason instanceof Error ? reason : new Error("实时回复失败，请稍后重试");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * 直连 OpenCode Zen API 的聊天，绕过 Cloudflare Worker 中转。
 * 使用 CapacitorHttp.post() 绕过 WebView CORS 限制。
 * 请求 stream: true 拿到完整 SSE 文本，然后逐条 delta 延迟 emit 模拟流式输出。
 */
export async function streamDirectChat(
  payload: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    model: string;
    thinkingMode?: "fast" | "balanced" | "deep";
  },
  onEvent: (event: WorkStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const {
    BUILTIN_FREE_BASE_URL,
    BUILTIN_FREE_CHAT_PATH,
    BUILTIN_FREE_HEADERS,
  } = await import("./builtin-free");

  const endpoint = `${BUILTIN_FREE_BASE_URL}${BUILTIN_FREE_CHAT_PATH}`;
  const messages = payload.messages.slice(-20);

  let aborted = false;
  const onAbort = () => { aborted = true; };
  signal?.addEventListener("abort", onAbort, { once: true });

  /** 延迟工具，用于逐条 emit 模拟逐字输出 */
  const delay = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  try {
    // 1) CapacitorHttp.post() 使用原生 HTTP 绕过 CORS，请求 stream: true 获取完整 SSE
    const response: HttpResponse = await CapacitorHttp.post({
      url: endpoint,
      headers: {
        "content-type": "application/json",
        ...BUILTIN_FREE_HEADERS
      },
      data: {
        model: payload.model,
        messages,
        stream: true,
        stream_options: { include_usage: true }
      },
      responseType: "text"
    });

    if (aborted) throw new DOMException("对话已停止", "AbortError");

    const status = response.status;
    if (status < 200 || status >= 300) {
      const errData = typeof response.data === "string" ? response.data : "";
      // 尝试解析 JSON 错误
      let errorMsg = `请求失败 (${status})`;
      let errorCode: string | undefined;
      try {
        const parsed = JSON.parse(errData) as Record<string, unknown>;
        const errObj = parsed?.error;
        if (typeof errObj === "object" && errObj !== null) {
          const nested = errObj as Record<string, unknown>;
          if (typeof nested.message === "string") errorMsg = nested.message;
          if (typeof nested.code === "string") errorCode = nested.code;
        } else if (typeof errObj === "string") {
          errorMsg = errObj;
        }
      } catch { /* non-JSON error */ }
      throw new ApiError(errorMsg, status, errorCode);
    }

    // 2) 解析完整 SSE 文本，收集所有 delta
    const sseText = typeof response.data === "string" ? response.data : "";
    const lines = sseText.split("\n");
    const deltas: string[] = [];
    let usageEvent: WorkStreamEvent | null = null;
    let totalLength = 0;
    const MAX_STREAM_TEXT = 32_000;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
        const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
        const first = typeof choices[0] === "object" && choices[0] !== null ? choices[0] as Record<string, unknown> : undefined;
        const delta = (first?.delta ?? first?.message) as Record<string, unknown> | undefined;
        if (!delta) continue;

        const content = typeof delta.content === "string" ? delta.content : undefined;
        if (content) {
          totalLength += content.length;
          if (totalLength > MAX_STREAM_TEXT) {
            onEvent({ type: "error", error: "AI 回复内容过长" });
            return;
          }
          deltas.push(content);
        }

        if (parsed.usage && typeof parsed.usage === "object") {
          const u = parsed.usage as Record<string, unknown>;
          usageEvent = {
            type: "done",
            model: payload.model,
            usage: {
              promptTokens: Number(u.prompt_tokens) || 0,
              completionTokens: Number(u.completion_tokens) || 0,
              totalTokens: Number(u.total_tokens) || 0
            }
          };
        }
      } catch { /* ignore unparseable lines */ }
    }

    // 3) 逐条 emit delta，模拟逐字输出效果
    for (const chunk of deltas) {
      if (aborted) throw new DOMException("对话已停止", "AbortError");
      onEvent({ type: "delta", delta: chunk });
      await delay(30);
    }

    // 4) 发送 done 事件
    if (aborted) throw new DOMException("对话已停止", "AbortError");
    if (usageEvent) {
      onEvent(usageEvent);
    } else {
      onEvent({ type: "done", model: payload.model });
    }
  } catch (reason) {
    if (reason instanceof ApiError) throw reason;
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
    if (aborted) throw new DOMException("对话已停止", "AbortError");
    if (reason instanceof TypeError) throw new Error("无法连接到 AI 服务，请检查网络后重试");
    throw reason instanceof Error ? reason : new Error("实时回复失败，请稍后重试");
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}
