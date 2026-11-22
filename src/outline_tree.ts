// v0.3.1+：轮廓树（outline tree）通用算法——时间线面板与事件树面板共用（原 timeline_view.buildTree 抽出）。

/** 轮廓节点：条目 + 子节点。父子关系按 level 数值（越小层级越高）由序列顺序决定——父＝其前最近一条级别更小的条目；无更小级别前驱者为根。不要求序列全局有序（同级并列、跳级嵌套均可） */
export interface OutlineNode<T> {
	item: T;
	children: OutlineNode<T>[];
}

/** 由带 level 字段的条目序列构建轮廓森林（数组异构兼容：调用方的行类型自带 level 即可） */
export function buildOutlineTree<T extends { level: number }>(items: T[]): OutlineNode<T>[] {
	const roots: OutlineNode<T>[] = [];
	const stack: OutlineNode<T>[] = [];
	for (const item of items) {
		const node: OutlineNode<T> = { item, children: [] };
		while (stack.length && stack[stack.length - 1].item.level >= item.level) stack.pop();
		if (stack.length) stack[stack.length - 1].children.push(node);
		else roots.push(node);
		stack.push(node);
	}
	return roots;
}

/** 统计节点子树的条目总数（含自身）——事件树面板删除确认「连同 N 个后代」用 */
export function countSubtree<T>(node: OutlineNode<T>): number {
	return 1 + node.children.reduce((sum, c) => sum + countSubtree(c), 0);
}

/** 子树（含自身）里是否有满足谓词的条目——树挂视图筛选时用来整支剪掉「自己与全部后代都不命中」的分支
 *  （否则一条不命中的父节点会带着空的侧向分支占一整屏） */
export function subtreeHas<T>(node: OutlineNode<T>, pred: (item: T) => boolean): boolean {
	if (pred(node.item)) return true;
	return node.children.some((c) => subtreeHas(c, pred));
}
