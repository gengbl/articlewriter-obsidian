/** 错误对象 → 可读文本（Obsidian/vault API 可能抛 Error 也可能抛字符串/未知值；Notice/状态行统一用它）。
 *  v0.4.7+ 提取自 llm_chat_view.ts 里重复的 `e instanceof Error ? e.message : String(e)`。 */
export function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
