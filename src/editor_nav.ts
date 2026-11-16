import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

/**
 * v0.4.3+ 编辑器定位共用件（写字台/时间线/灵感工具包等多处「跳到文档里某一处」的同一套动作）：
 * 打开 vault 内文档并把光标放到指定行、把该行滚到视口中央。
 * 首次尝试可能早于编辑器装载完成 → 默认 0ms/250ms 各试一次（移动端编辑器装载更慢）。
 */

/** 在已打开的 leaf 里定位到某行（0-based）；编辑器未就绪或行号越界则本次静默跳过、下一个延迟再试 */
export function revealEditorLine(leaf: WorkspaceLeaf, line: number, retryDelays: number[] = [0, 250]): void {
	for (const delay of retryDelays) {
		window.setTimeout(() => {
			const ed = (leaf.view as MarkdownView | null)?.editor;
			if (!ed) return;
			const pos = { line, ch: 0 };
			try {
				ed.setCursor(pos);
				ed.scrollIntoView({ from: pos, to: pos }, true); // center=true：定位行滚到视口中央
			} catch { /* 编辑器未就绪/行号越界：本次不定位，交给下一个延迟 */ }
		}, delay);
	}
}

/** 在编辑器打开文档并定位到指定行（0-based）；文件不存在/打不开返回 false（调用方决定提示口径） */
export async function openFileAtLine(app: App, path: string, line: number): Promise<boolean> {
	const f = app.vault.getAbstractFileByPath(path);
	if (!(f instanceof TFile)) return false;
	const leaf = app.workspace.getLeaf(false); // 复用当前叶子打开（getLeaf(false) 同步返回，await 非 Promise 会触发 lint）
	await leaf.openFile(f);
	revealEditorLine(leaf, line);
	return true;
}
