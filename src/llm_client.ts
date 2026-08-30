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

function buildParams(cfg: LlmConfigDoc, messages: Message[], stream: boolean, extra?: Record<string, unknown>) {
	const body: Record<string, unknown> = {
		model: cfg.model_name || undefined, // 本地服务常忽略/自取已加载模型；空则省略该字段
		messages,
		stream,
	};
	if (cfg.temperature != null) body.temperature = cfg.temperature;
	if (cfg.max_tokens != null) body.max_tokens = cfg.max_tokens;
	if (cfg.top_p != null) body.top_p = cfg.top_p;
	if (extra) Object.assign(body, extra);
	return body as any;
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

/** 非流式补全，返回完整文本 */
export async function chatCompletion(cfg: LlmConfigDoc, messages: Message[], extra?: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
	const client = createClient(cfg);
	const r = await client.chat.completions.create(buildParams(cfg, messages, false, extra) as OpenAI.ChatCompletionCreateParamsNonStreaming, { signal });
	const content = r.choices?.[0]?.message?.content;
	if (!content) throw new Error("LLM 未返回内容");
	return content;
}

/** 流式补全：逐块回调 onChunk，返回累积全文（供 UI 打字机效果 / 落盘前预览） */
export async function chatStream(cfg: LlmConfigDoc, messages: Message[], onChunk: (text: string) => void, extra?: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
	const client = createClient(cfg);
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
