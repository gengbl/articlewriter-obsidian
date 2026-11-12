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
		// 显式 null 撤销 SDK 自动附加的 X-Stainless-* 指纹头（openai SDK 文档：defaultHeaders 传 null 即删除该头）。
		// 这些是自定义头，浏览器 CORS 预检会把它们列入 Access-Control-Request-Headers——凡返回固定白名单的本地服务
		// （如 Strata 服务端只允许 content-type/authorization/x-api-key/x-strata-client）预检即被 Chromium 拒绝，
		// 插件内所有请求表现为「Failed to fetch → 连接失败」，而 curl 连通正常（curl 不带这些头）——云端 API 允许任意头、不受影响。
		defaultHeaders: {
			"X-Stainless-Lang": null,
			"X-Stainless-Package-Version": null,
			"X-Stainless-OS": null,
			"X-Stainless-Arch": null,
			"X-Stainless-Runtime": null,
			"X-Stainless-Runtime-Version": null,
			"X-Stainless-Retry-Count": null,
			"X-Stainless-Timeout": null,
			"X-Stainless-Helper-Method": null,
		},
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
	thinking?: { type: "enabled" | "disabled" }; // DeepSeek 官方思考开关（仅对 deepseek 端点发送，见 buildParams）
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
	// 配置级采样参数（reasoning_effort / openai_extras）：先于 extra 合并，调用方显式传入的 extra 可覆盖。
	// 思考型本地模型（llama-server --reasoning-format deepseek 等）默认开思考，思考与正文共享 max_tokens 预算——
	// 不发送 reasoning_effort:"none" 时思考会耗尽预算、content 恒空（表现为「思考型模型正文为空」）。
	const ex = samplingExtras(cfg);
	if (ex) Object.assign(body, ex);
	if (extra) Object.assign(body, extra);
	// 已知端点上限保护：DeepSeek 官方（V4 时代，deepseek-flash / deepseek-v4-pro）最大输出 384K tokens，超限请求会被 400 拒绝。
	// 注意旧 V3/R1 时代上限是 8192——对思考型模型夹到那个值是致命的：思考与正文共享同一 max_tokens 预算，
	// 8192 会被 reasoning_content 全部耗尽、content 恒空（表现为「思考型模型正文为空」）。旧模型名已于 2026-07-24 停用，无需特判。
	if (body.max_tokens != null && body.max_tokens > 393216 && /api\.deepseek\.com/i.test(cfg.base_url || "")) {
		console.warn(`[articlewriter] max_tokens=${String(body.max_tokens)} 超过 DeepSeek 上限，已自动夹取为 393216（384K）`);
		body.max_tokens = 393216;
	}
	// 思考模式开关（DeepSeek 官方请求体字段 thinking:{type:"enabled"|"disabled"}）：仅当 base_url 或模型名含 deepseek 时发送——
	// OpenAI 官方及其他兼容端点对未知字段会 400，不能透传。留空=跟随服务端默认（deepseek-flash 默认开思考）。
	const t = (cfg.thinking || "").trim().toLowerCase();
	if (t && /deepseek/i.test(`${cfg.base_url ?? ""} ${cfg.model_name ?? ""}`)) {
		body.thinking = { type: /^(off|disabled|false|no|0)$/.test(t) ? "disabled" : "enabled" };
	}
	return body;
}

/**
 * 配置级采样参数透传，已接入 buildParams：所有 chatCompletion/chatStream 请求自动携带，调用方 extra 可覆盖。
 * - reasoning_effort：顶层字段随每次请求发送。各端点实况——DeepSeek V4 原生支持（none/low/high/max，
 *   minimal→low、medium/xhigh→high 兼容映射；与 thinking:{type} 同发时后者优先选模式，不冲突）；
 *   OpenAI o 系列原生支持；llama-server + Qwen jinja 模板实测 "none" 关思考、"high" 注入 xhigh 推理指令；
 *   vLLM 识别并自动转 enable_thinking；其余兼容端点忽略未知字段无副作用。
 *   思考型本地模型默认开思考且思考与正文共享 max_tokens 预算——不发 "none" 时思考耗尽预算、content 恒空
 *   （表现为「思考型模型正文为空」），这是本地端点大纲/长文生成失败的根因。
 * - openai_extras：声明式名单（对齐 Python llm_client.py 语义），"repeat_penalty" → 发送 cfg.repeat_penalty 数值
 *   （llamacpp 私有参数，仅显式声明才发，避免远程端点 400）；其余名字按布尔 true 透传（声明式开关兜底）。
 */
export function samplingExtras(cfg: LlmConfigDoc): Record<string, unknown> | undefined {
	const ex: Record<string, unknown> = {};
	if (cfg.reasoning_effort) ex.reasoning_effort = cfg.reasoning_effort;
	for (const k of cfg.openai_extras ?? []) {
		if (!k || k in ex) continue;
		if (k === "repeat_penalty") { if (cfg.repeat_penalty != null) ex.repeat_penalty = cfg.repeat_penalty; }
		else ex[k] = true;
	}
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
 * customSp（编写类型格式块等命令级提示）> baseSp（设置文档全局 system_prompt）> DEFAULT_SYSTEM_PROMPT。
 * v0.3.5+：旧第 2 参 guideText（三层 WRITING_GUIDE 合并原文、追加【创作规范】段）已随写作指南体系废弃。
 */
export function assembleSystemPrompt(customSp?: string, baseSp?: string): string {
	const b = (baseSp || "").trim();
	const sp = (customSp && customSp.trim()) || (b ? b : DEFAULT_SYSTEM_PROMPT);
	// v0.3.4+：原第 4 参 identityBoost（末尾附【身份加强】块）已移除——身份加强 Skill 化，经技能通道（【技能 · 身份加强·<阶段名>】）注入
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
	let out = bits.length ? bits.join(" · ") : String(e);
	// 上下文窗口溢出（llama-server / vLLM / OpenAI 等直接 4xx 拒绝）：追加可操作诊断。注意文案不得含「输出为空」「未返回内容」——streamOnce 依赖这两个串判定空结果重试
	if (/exceeds the available context size|maximum context length|context length exceeded|prompt is too long|too many tokens/i.test(out)) {
		out += " · 提示词超出模型上下文窗口（服务端直接拒绝）：① 换上下文窗口更大的端点/模型 ② 调大服务端上下文（如 llama-server --ctx-size 131072，内存代价随之增长）③ 减少注入内容（降低目标章数 / 用「继续生成」而非完整生成 / 精简策划指南与引用文档）";
	}
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

/** 「正文为空但思考非空」的诊断文案：finish_reason=length 说明思考与正文共享的输出预算被思考耗尽；否则按思考块未闭合/模型异常处理 */
function emptyBodyReason(finishReason: string | null | undefined): string {
	if (finishReason === "length")
		return "输出已达 max_tokens 上限（finish_reason=length）：思考与正文共享同一输出预算，思考把预算全部用尽。可尝试：调大该请求 max_tokens、降低思考强度（设置页 reasoning_effort 改为 low/medium），或关闭思考（设置页 reasoning_effort=none；DeepSeek 端点：thinking=off）";
	return "思考未结束即达到 max_tokens 上限，或思考块未正常闭合。可尝试：调大该请求 max_tokens、换非思考模型，或在设置页将 reasoning_effort 设为 none 关闭思考（本地 llama-server + Qwen 模板实测有效）";
}

/** 非流式补全，返回完整文本 */
export async function chatCompletion(cfg: LlmConfigDoc, messages: Message[], extra?: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
	const client = createClient(cfg, GENERATE_TIMEOUT_MS); // 非流式也可能长（摘要/去AI味整段重写），同用放宽值
	const r = await client.chat.completions.create(buildParams(cfg, messages, false, extra) as OpenAI.ChatCompletionCreateParamsNonStreaming, { signal });
	const choice = r.choices?.[0];
	const msg = choice?.message as { content?: string | null; reasoning_content?: string } | undefined;
	const content = msg?.content;
	if (!content) {
		// 思考型模型（llama-server --reasoning-format deepseek 等）非流式响应把思考放 message.reasoning_content、正文放 content——
		// max_tokens 预算被思考耗尽时 content 恒空，通用报错无从诊断（对齐 chatStream 的针对性错误）；
		// finish_reason=length 可区分「预算耗尽」与「思考块未闭合」两种成因
		const reasoning = (msg?.reasoning_content ?? "").trim();
		throw new Error(
			reasoning
				? `思考型模型正文为空（已产生 ${String(reasoning.length)} 字思考）：${emptyBodyReason(choice?.finish_reason)}`
				: "LLM 未返回内容"
		);
	}
	return content;
}

/** 流式补全：逐块回调 onChunk，返回累积全文（供 UI 打字机效果 / 落盘前预览）。
 * 思考型模型（llama-server --reasoning-format deepseek 等）的思考过程走 delta.reasoning_content、
 * 正文在思考结束后才进 delta.content——只收 content 时「思考挤占 max_tokens」或「思考块未闭合」
 * 都会表现为空结果且无从诊断。故并行经 onReasoning（可选）透出思考增量；流结束正文为空但思考非空时
 * 抛针对性错误（消息刻意不含「输出为空/未返回内容」，避免被调用方按普通空结果重试白等）。
 * onFinish（可选）在流正常结束后回调一次，携带最后一个 finish_reason（"length"＝被 max_tokens 截断、
 * "stop"＝自然结束、null＝端点未给出）——供调用方判断是否需要自动续写，不改变返回值语义。 */
export async function chatStream(
	cfg: LlmConfigDoc,
	messages: Message[],
	onChunk: (text: string) => void,
	extra?: Record<string, unknown>,
	signal?: AbortSignal,
	onReasoning?: (text: string) => void,
	onFinish?: (reason: string | null) => void
): Promise<string> {
	const client = createClient(cfg, GENERATE_TIMEOUT_MS); // 流式放宽超时（默认 60s 会掐断长章节生成）
	const stream = await client.chat.completions.create(buildParams(cfg, messages, true, extra) as OpenAI.ChatCompletionCreateParamsStreaming, { signal });
	let full = "";
	let reasoning = "";
	let finishReason: string | null | undefined;
	for await (const chunk of stream) {
		const choice = chunk.choices?.[0];
		if (choice?.finish_reason) finishReason = choice.finish_reason; // 记录最后一个非空值：正文为空时区分「预算耗尽」与「思考未闭合」
		const delta = choice?.delta?.content ?? "";
		if (delta) {
			full += delta;
			onChunk(delta);
		}
		const rDelta = (choice?.delta as { reasoning_content?: string } | undefined)?.reasoning_content ?? "";
		if (rDelta) {
			reasoning += rDelta;
			onReasoning?.(rDelta);
		}
	}
	onFinish?.(finishReason ?? null); // 流正常结束（含空正文）时透出 finish_reason，供截断检测/自动续写
	if (!full.trim()) {
		if (reasoning.trim()) throw new Error(`思考型模型正文为空（已产生 ${String(reasoning.length)} 字思考）：${emptyBodyReason(finishReason)}`);
		throw new Error("LLM 流式输出为空");
	}
	return full;
}
