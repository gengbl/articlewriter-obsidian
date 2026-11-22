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

/** 压平后的一行：节点＋深度（根＝0），深度决定缩进/圆点所在列 */
export interface OutlineRow<T> {
	node: OutlineNode<T>;
	depth: number;
}

/** `flattenOutlineOrdered` 的可选过滤：keep＝false 时整支（自身＋后代）不进序列；descend＝false 时保留自身但不下钻（折叠） */
export interface FlattenOutlineOptions<T> {
	keep?: (node: OutlineNode<T>) => boolean;
	descend?: (node: OutlineNode<T>) => boolean;
}

/** 把轮廓森林压平成**按条目时间全局升序**的行序列（时间线树挂视图的 Y 序，v0.4.11+）：
 *  深度优先先序收集（父在子前）→ 稳定排序（同刻条目保持先序＝父先于子）；
 *  与「逐层各自排序、子树整块输出」不同——父事件与子事件参与同一个时间序，任一事件都不会排在时间更早的事件上面
 *  （例如一级事件 A 的子事件时间晚于一级事件 B 时，B 会插到 A 与该子事件之间）。 */
export function flattenOutlineOrdered<T>(
	nodes: OutlineNode<T>[],
	cmp: (a: T, b: T) => number,
	opts?: FlattenOutlineOptions<T>,
): OutlineRow<T>[] {
	const rows: Array<OutlineRow<T> & { seq: number }> = [];
	let seq = 0;
	const walk = (list: OutlineNode<T>[], depth: number): void => {
		for (const node of list) {
			if (opts?.keep && !opts.keep(node)) continue;
			rows.push({ node, depth, seq: seq++ });
			if (opts?.descend && !opts.descend(node)) continue;
			walk(node.children, depth + 1);
		}
	};
	walk(nodes, 0);
	rows.sort((a, b) => cmp(a.node.item, b.node.item) || a.seq - b.seq);
	return rows.map((r) => ({ node: r.node, depth: r.depth }));
}
