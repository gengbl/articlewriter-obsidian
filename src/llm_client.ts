import OpenAI from "openai";
import type { LlmConfigDoc } from "./plugin_config";

export type Message = OpenAI.ChatCompletionMessageParam;

/** 对齐 Python config.DEFAULT_SYSTEM_PROMPT */
export const DEFAULT_SYSTEM_PROMPT =
	"你是一个网络小说作者，写的是给人看的故事，不是范文。文风自然平实，多用常见词，避免华丽形容词堆砌。请根据用户的需求创作小说章节。注意：1.保持故事连贯性 2.人物性格一致 3.情节合理推进4.适当使用描写和对话 5.每章结尾自然收束";

/**
 * LLM 调用层（OpenAI 兼容标准接口）——对齐 Python articlewriter 的 llm_client.py。
 * 用官方 openai SDK；baseURL 指向任意 OpenAI 兼容端点即可适配 DeepSeek / DashScope(千问) / Ollama / LM Studio / llama.cpp 等。
 */

/** 拼接 base_url：已含 /vN 时避免重复（对齐 Python `_openai_endpoint`，如千问 DashScope 自带 /compatible-mode/v1） */
export function normalizeBaseURL(base_url?: string): string | undefined {
	if (!base_url || !base_url.trim()) return undefined;
	const base = base_url.trim().replace(/\/+$/, "");
	if (/\/v\d+$/.test(base)) return base;
	return `${base}/v1`;
}

export function createClient(cfg: LlmConfigDoc, timeoutMs = 60000): OpenAI {
	return new OpenAI({
		// 未配置密钥时用占位值通过 SDK 的必填校验（对齐 Python：无 key 则不发 Authorization；本地 llama.cpp/Ollama/LM Studio 均忽略该头）
		apiKey: cfg.api_key || "local-no-auth",
		baseURL: normalizeBaseURL(cfg.base_url),
		timeout: timeoutMs,
		dangerouslyAllowBrowser: true, // Obsidian 为 Electron 渲染进程环境
	});
}

/**
 * 清洗字符串里的**孤立代理码元**（lone surrogate，如残缺 emoji 的 `\uD83D` 单独出现）。
 * 这类字符无法编码成 UTF-8：`fetch` 在把字符串 body 转成 USVString 时会**当场**抛 `TypeError: Failed to fetch`，
 * 表现为「一发出请求就失败、没有任何 HTTP 状态」，且只有携带该坏字符的那次请求（某些从网页/Word 粘贴进大纲、人物的脏文本）才出现——
 * 同一个 chatStream 在别处（如 LLM 对话框）正常，极易被误判为网络/代理问题。
 */
export function sanitizeText(s: string): string {
	if (!/[\uD800-\uDFFF]/.test(s)) return s; // 快速通道：绝大多数文本不含代理码元
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const n = s.charCodeAt(i + 1);
			if (n >= 0xdc00 && n <= 0xdfff) {
				out += s[i] + s[i + 1]; // 合法代理对（正常 emoji）——保留
				i++;
			} else out += "\uFFFD"; // 孤立高位代理
		} else if (c >= 0xdc00 && c <= 0xdfff) {
			out += "\uFFFD"; // 孤立低位代理
		} else {
			out += s[i];
		}
	}
	return out;
}

/** 首个孤立代理码元的下标（无则 -1）：用于报出脏文本片段，帮用户定位是哪份来源文档带进了坏字符 */
function firstLoneSurrogateIndex(s: string): number {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const n = s.charCodeAt(i + 1);
			if (!(n >= 0xdc00 && n <= 0xdfff)) return i;
		} else if (c >= 0xdc00 && c <= 0xdfff) return i;
	}
	return -1;
}

/** 逐条清洗消息正文（仅 string 型 content；多模态数组原样保留），命中时出警告并附坏字符上下文片段，便于定位脏文档 */
function sanitizeMessages(messages: Message[]): Message[] {
	let hit = 0;
	let sample = "";
	const out = messages.map((m) => {
		const content = (m as { content?: unknown }).content;
		if (typeof content !== "string") return m;
		const cleaned = sanitizeText(content);
		if (cleaned === content) return m;
		hit++;
		if (!sample) {
			const i = firstLoneSurrogateIndex(content);
			if (i >= 0) sample = JSON.stringify(content.slice(Math.max(0, i - 40), i + 40));
		}
		return { ...m, content: cleaned };
	});
	if (hit) {
		console.warn(`[articlewriter] 提示词含非法字符（孤立代理码元），已在发送前清洗 ${String(hit)} 条消息——这类字符会让 fetch 直接抛 "Failed to fetch"。附近片段：${sample || "(无法取样)"}`);
	}
	return out;
}

/** chat completions 请求体（兼容端点透传任意附加字段；model 为空时序列化自动省略） */
interface LlmChatBody {
	messages: Message[];
	model?: string;
	stream: boolean;
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	[k: string]: unknown;
}

function buildParams(cfg: LlmConfigDoc, messages: Message[], stream: boolean, extra?: Record<string, unknown>): LlmChatBody {
	const body: LlmChatBody = {
		model: cfg.model_name || undefined, // 本地服务常忽略/自取已加载模型；空则省略该字段
		messages: sanitizeMessages(messages),
		stream,
	};
	if (cfg.temperature != null) body.temperature = cfg.temperature;
	if (cfg.max_tokens != null) body.max_tokens = cfg.max_tokens;
	if (cfg.top_p != null) body.top_p = cfg.top_p;
	if (extra) Object.assign(body, extra);
	// 已知端点上限保护：DeepSeek 官方 max_tokens 上限 8192，超限请求会被 400 拒绝
	// （用户配置里常见直接填 65535，切到该端点后每条命令都失败）
	if (body.max_tokens != null && body.max_tokens > 8192 && /api\.deepseek\.com/i.test(cfg.base_url || "")) {
		console.warn(`[articlewriter] max_tokens=${String(body.max_tokens)} 超过 DeepSeek 上限，已自动夹取为 8192`);
		body.max_tokens = 8192;
	}
	return body;
}

/** 采样等参数透传（如 reasoning_effort / enable_thinking——OpenAI 官方无此字段，兼容端点接受） */
export function samplingExtras(cfg: LlmConfigDoc): Record<string, unknown> | undefined {
	const ex: Record<string, unknown> = {};
	if (cfg.reasoning_effort) ex.reasoning_effort = cfg.reasoning_effort;
	for (const k of cfg.openai_extras ?? []) if (k && !(k in ex)) ex[k] = true;
	return Object.keys(ex).length ? ex : undefined;
}

export interface LlmTestResult {
	ok: boolean;
	message: string;
	models?: string[];
}

/** 连接测试：GET /models（对齐 Python check_connection），200 即连通并返回模型清单 */
export async function testConnection(cfg: LlmConfigDoc): Promise<LlmTestResult> {
	try {
		const client = createClient(cfg, 20000);
		const r = await client.models.list();
		const ids = (r.data ?? []).map((m) => m.id).filter(Boolean).slice(0, 10);
		return { ok: true, message: `已连接${ids.length ? `（${ids.length} 个模型可用）` : ""}`, models: ids };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, message: msg.replace(/Bearer .+/g, "Bearer ***") };
	}
}

/**
 * 组装最终 system prompt（对齐 Python llm_client.generate 的解析链 + _apply_agents）：
 * customSp（编写类型格式块等命令级提示）> baseSp（设置文档全局 system_prompt）> DEFAULT_SYSTEM_PROMPT；
 * guideText（三层 WRITING_GUIDE 合并原文：故事级 > 用户级 > 系统级 data.json）存在时追加【创作规范】段。
 */
export function assembleSystemPrompt(customSp?: string, guideText = "", baseSp?: string): string {
	const b = (baseSp || "").trim();
	let sp = (customSp && customSp.trim()) || (b ? b : DEFAULT_SYSTEM_PROMPT);
	const g = (guideText || "").trim();
	if (g) {
		sp += "\n\n【创作规范】\n以下是本项目要求必须遵守的创作规范，请在生成时严格遵循；若与前面的【编写类型】格式要求冲突，以【编写类型】为准：\n" + g;
	}
	return sp;
}

/**
 * 生成类请求（流式补全 / 非流式补全）的超时时长：整章生成常远超 SDK 默认 60s——生成写到一半被 SDK timeout 掐断
 * 会表现为连接类失败（「编写本章」失败、而对话框里的短问答正常，正是这个时长差异导致的典型现象）。
 * 给足 30 分钟兜底防挂死；正常中断一律靠流式面板的「停止生成」（AbortSignal），不依赖超时。
 */
export const GENERATE_TIMEOUT_MS = 30 * 60 * 1000;

/** LLM 异常 → 可读诊断串：SDK 的 APIConnectionError 只有 "Connection error."，必须把底层 cause/code 与 HTTP 状态一并带出，否则连接被拒 / 超时 / 4xx 全被同一句话盖住、无法定位 */
export function describeLlmError(e: unknown): string {
	const err = e as { message?: string; status?: number; code?: string; type?: string; cause?: { message?: string; code?: string } };
	const bits: string[] = [];
	if (err?.message) bits.push(err.message);
	if (err?.status) bits.push(`HTTP ${String(err.status)}`);
	if (err?.code) bits.push(`code=${String(err.code)}`);
	if (err?.type) bits.push(`type=${String(err.type)}`);
	if (err?.cause?.code) bits.push(`cause=${String(err.cause.code)}`);
	else if (err?.cause?.message) bits.push(`cause=${String(err.cause.message)}`);
	const out = bits.length ? bits.join(" · ") : String(e);
	return out.replace(/Bearer .+/g, "Bearer ***").replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "sk-***");
}

/**
 * 该异常是否值得自动重试：只放行「网络层瞬时故障 + 服务端 5xx / 限流 / 超时」。
 * 参数类 4xx（400/401/403/404/422——如超长上下文、密钥错误、模型名错）重试无意义，直接失败让用户看到原因。
 * 注意 fetch 把一切网络层失败归一为 `TypeError: Failed to fetch`（连接被拒/被重置/DNS/空闲被中间设备断），
 * 其 message 与 cause 都带不出更细的原因，故这类也纳入可重试（配合 main.ts 的退避重试）。
 */
export function isRetryableLlmError(e: unknown): boolean {
	const err = e as { status?: number; message?: string; cause?: { message?: string; code?: string } };
	const st = Number(err?.status ?? 0);
	if (st >= 500 || st === 408 || st === 429) return true;
	if (st >= 400) return false;
	const text = [err?.message, err?.cause?.message, err?.cause?.code].filter(Boolean).join(" ").toLowerCase();
	return /failed to fetch|connection error|etimedout|econnreset|econnrefused|econnaborted|socket hang up|network error|timed out|timeout|502|503|504/.test(text);
}

/** 非流式补全，返回完整文本 */
export async function chatCompletion(cfg: LlmConfigDoc, messages: Message[], extra?: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
	const client = createClient(cfg, GENERATE_TIMEOUT_MS); // 非流式也可能长（摘要/去AI味整段重写），同用放宽值
	const r = await client.chat.completions.create(buildParams(cfg, messages, false, extra) as OpenAI.ChatCompletionCreateParamsNonStreaming, { signal });
	const content = r.choices?.[0]?.message?.content;
	if (!content) throw new Error("LLM 未返回内容");
	return content;
}

/** 流式补全：逐块回调 onChunk，返回累积全文（供 UI 打字机效果 / 落盘前预览） */
export async function chatStream(cfg: LlmConfigDoc, messages: Message[], onChunk: (text: string) => void, extra?: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
	const client = createClient(cfg, GENERATE_TIMEOUT_MS); // 流式放宽超时（默认 60s 会掐断长章节生成）
	const stream = await client.chat.completions.create(buildParams(cfg, messages, true, extra) as OpenAI.ChatCompletionCreateParamsStreaming, { signal });
	let full = "";
	for await (const chunk of stream) {
		const delta = chunk.choices?.[0]?.delta?.content ?? "";
		if (delta) {
			full += delta;
			onChunk(delta);
		}
	}
	if (!full.trim()) throw new Error("LLM 流式输出为空");
	return full;
}
