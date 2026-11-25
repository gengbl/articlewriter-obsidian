// v0.4.11+：场景「树形候选」纯算法（无 DOM、无 vault，node 可测）。
// 场景编辑弹窗的**父场景选择**与**关联场景补选**共用同一套建树/展平口径（两处不再各写一遍）。

/** 建树输入＝候选场景（`parent`＝写盘的 `- 父场景：` 值；空串/缺省/指不到存在的 id＝顶层） */
export interface SceneTreeInput {
	id: string;
	label: string;
	parent?: string;
}

/** 树节点（children 保持传入顺序） */
export interface SceneTreeNode {
	id: string;
	label: string;
	parent: string;
	children: SceneTreeNode[];
}

/** 展平后的树形一行＝弹窗下拉列表里的一条（depth 驱动缩进、path 为祖先显示名链） */
export interface SceneTreeRow {
	id: string;
	label: string;
	depth: number;
	/** 祖先显示名链（不含自身）＝行 tooltip「黑石城 / 城门」用 */
	path: string[];
	/** 祖先 id 链（不含自身）＝调用方把「当前值所在的支」默认展开用 */
	ancIds: string[];
	/** 整条子树（不含自身）的场景数＝行尾「N 个子场景」徽标 */
	kidCount: number;
	/** 候选数据里有环（`- 父场景：` 手写自引用/互指）＝该行标红（选它只会写出成环的父链） */
	cyclic: boolean;
	/** 是否有子场景＝渲染 ▸/▾ 展开三角 */
	hasKids: boolean;
}

/**
 * 由 `{id,label,parent}` 候选建森林（**不改动入参节点**）：
 * ① 同 id 重复只留首个（跨层文档同名场景由调用方先去重，这里兜一层）；
 * ② `parent` 空／等于自身／指向不存在的 id＝当作根（孤儿不丢，仍可选）；
 * ③ **数据成环**（A→B→A、自指）不死循环：沿父链上溯，遇到「绕回自己」或「走进已知的环」＝
 *    该 id 记进 `cyclicIds`（展平时连同其后代标红禁点＝选它只会写出成环的父链）；
 * ④ 根的顺序＝传入顺序，子＝该父在候选中的出现顺序（与场景面板文档顺序一致）。
 */
export function buildSceneTree(nodes: readonly SceneTreeInput[]): { roots: SceneTreeNode[]; cyclicIds: Set<string> } {
	const byId = new Map<string, SceneTreeNode>();
	for (const n of nodes) {
		if (!n.id || byId.has(n.id)) continue;
		byId.set(n.id, { id: n.id, label: n.label || n.id, parent: (n.parent ?? "").trim(), children: [] });
	}
	const cyclicIds = new Set<string>(); // 环上（或父链通向环）的节点＝展平时连同后代标红禁点
	const cutEdges = new Set<string>(); // 为破环断掉的 `- 父场景：` 边（key＝子 id）＝每圈只断一条
	/**
	 * 沿父链走一遍（迭代＝不怕几千层）。每步只看**当前节点的出边**：
	 * ① 出边指到「本链上已有的节点」＝回边＝找到环：环＝`path[at..]`，断掉**环内最后那条入边**（末个成员的父边）并标记整圈；
	 * ② 出边指到「别的链已走完的节点」＝直接借用它的结论（它不在环上则本链也不在）；
	 * ③ 出边已被断掉＝本链通向那条环；④ 无父／指不到／自指＝断链收尾（不是环）。
	 * 走完把走到的节点全部标 done＝后面再走到就只取结论，不重复上溯。
	 */
	const done = new Set<string>();
	for (const node of byId.values()) {
		if (done.has(node.id)) continue;
		const path: string[] = [];
		const pos = new Map<string, number>();
		let upCyclic = false;
		let curId: string | undefined = node.id;
		while (curId) {
			done.add(curId);
			pos.set(curId, path.length);
			path.push(curId);
			if (cutEdges.has(curId)) {
				upCyclic = true;
				break; // 它的入边已被别的链断掉＝整条链都通向那条环
			}
			const p: string = byId.get(curId)?.parent ?? "";
			const parent: SceneTreeNode | undefined = p && p !== curId ? byId.get(p) : undefined; // 显式标注＝打断 `curId ← parent.id` 的循环推论
			if (!parent) {
				if (p === curId) cyclicIds.add(curId); // 自指（`- 父场景：` 写了自己）＝它本身就是环、不可选（其子树连带标红）
				break; // 无父／指不到／自指＝链到此为止＝正常顶层（不是环、不牵连别的祖先）
			}
			const at = pos.get(parent.id); // 回边：父已在本链上＝环就是 path[at..]
			if (at !== undefined) {
				const loop = path.slice(at);
				for (const id of loop) cyclicIds.add(id);
				cutEdges.add(curId); // 断掉**回边**本身（链上最后一个节点的入边）＝环入口层级照旧、其余成员顺着挂
				break;
			}
			if (done.has(parent.id)) {
				if (cyclicIds.has(parent.id)) upCyclic = true; // 接在已判定的环上＝本链也不可选
				break; // 接在已判定的正常节点上＝本链正常
			}
			curId = parent.id;
		}
		if (upCyclic) for (const id of path) cyclicIds.add(id);
	}
	const roots: SceneTreeNode[] = [];
	for (const node of byId.values()) {
		const p = (node.parent ?? "").trim();
		if (p && p !== node.id && byId.has(p) && !cutEdges.has(node.id)) byId.get(p)?.children.push(node);
		else roots.push(node); // 无父／指不到／自指／断掉的环边＝按根处理（孤儿不丢）
	}
	return { roots, cyclicIds };
}

/** 后代 id 集合（含自身）＝「父场景」候选去自身与全部子孙（防环）的唯一口径 */
export function sceneDescendantIds(nodes: readonly SceneTreeInput[], id: string): Set<string> {
	const { roots } = buildSceneTree(nodes);
	const out = new Set<string>();
	const walk = (n: SceneTreeNode): void => {
		if (out.has(n.id)) return;
		out.add(n.id);
		for (const c of n.children) walk(c);
	};
	for (const root of roots) {
		if (root.id !== id) continue;
		walk(root);
		break; // 森林里 id 唯一，命中即止
	}
	out.add(id); // 自身恒排除（哪怕它在数据里挂在别人下面）
	return out;
}

/** 节点子树规模（含自身） */
export function sceneSubtreeCount(node: SceneTreeNode): number {
	let n = 1;
	for (const c of node.children) n += sceneSubtreeCount(c);
	return n;
}

/** 是否命中搜索（id 或显示名，小写包含；空查询＝全命中） */
export function sceneRowMatches(row: { id: string; label: string }, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return row.id.toLowerCase().includes(q) || row.label.toLowerCase().includes(q);
}

/**
 * 把森林展平成「树形一行」列表（弹窗树形下拉用）：
 * ① `excludeIds`＝**整支剪掉**（父场景候选去自身与子孙）；
 * ② `query` 非空＝命中项＋其全部祖先＋命中项的全部后代保留（命中父下还能继续挑子），其余剪掉；
 * ③ 输出顺序＝DFS，`depth` 从 0 起＝驱动缩进；上限 4000 行（防御异常数据把弹窗撑爆）。
 */
export function flattenSceneTree(
	nodes: readonly SceneTreeInput[],
	opts: { excludeIds?: ReadonlySet<string>; query?: string } = {}
): SceneTreeRow[] {
	const excl = opts.excludeIds ?? new Set<string>();
	const { roots, cyclicIds } = buildSceneTree(nodes);
	const query = (opts.query ?? "").trim().toLowerCase();
	const out: SceneTreeRow[] = [];
	// 子树规模与「子树里是否有命中」＝**记忆化**（两者原本每次调用都重走一遍整支＝flatten 全程 O(n²)；
	// 大书几千场景时每次按键重渲染都会卡一下）。结论只与节点自身有关＝与走的这条链无关，可安全缓存。
	const sizeMemo = new Map<string, number>();
	const sizeOf = (n: SceneTreeNode): number => {
		const cached = sizeMemo.get(n.id);
		if (cached !== undefined) return cached;
		let s = 1;
		for (const c of n.children) s += sizeOf(c);
		sizeMemo.set(n.id, s);
		return s;
	};
	const hitMemo = new Map<string, boolean>();
	const subtreeHasQuery = (n: SceneTreeNode): boolean => {
		const cached = hitMemo.get(n.id);
		if (cached !== undefined) return cached;
		let r = false;
		for (const c of n.children) {
			if (sceneRowMatches(c, query) || subtreeHasQuery(c)) {
				r = true;
				break;
			}
		}
		hitMemo.set(n.id, r);
		return r;
	};
	const walk = (node: SceneTreeNode, depth: number, ancLabels: string[], ancIds: string[], cyclicAnc: boolean, insideHit: boolean): void => {
		if (out.length >= 4000) return;
		const cyclic = cyclicAnc || cyclicIds.has(node.id);
		const row: SceneTreeRow = {
			id: node.id,
			label: node.label,
			depth,
			path: [...ancLabels],
			ancIds: [...ancIds],
			kidCount: sizeOf(node) - 1,
			cyclic,
			hasKids: node.children.length > 0,
		};
		const hit = insideHit || sceneRowMatches(row, query); // 命中项的整条子树都留下（在命中的父下面继续挑子）
		if (query && !hit && !subtreeHasQuery(node)) return; // 自身与全部后代都不命中＝整支剪掉
		out.push(row);
		for (const c of node.children) {
			if (excl.has(c.id)) continue;
			walk(c, depth + 1, [...ancLabels, node.label], [...ancIds, node.id], cyclic, hit);
		}
	};
	for (const root of roots) {
		if (excl.has(root.id)) continue;
		walk(root, 0, [], [], false, false);
	}
	return out;
}

/* ================= 树形面板摆位（v0.4.11+ 平板/窄弹窗＝「面板被裁到看不境」修复的纯算法侧） ================= */

/** 面板期望总高（搜索框＋列表＋内边距）＝上限，够放就用这个 */
export const TREE_PANEL_MAX_H = 300;
/** 列表默认封顶（＝styles.css `.aw-tree-list{max-height:240px}` 的默认值，两处口径要一致） */
export const TREE_PANEL_LIST_MAX = 240;
/** 列表封顶下限（再挤也留这么多＝否则面板只剩搜索框＝用户看不到任何候选） */
export const TREE_PANEL_LIST_MIN = 96;
/** 面板固定开销＝搜索框＋内边距＋间隙（列表封顶＝可用高 − 这一截） */
export const TREE_PANEL_CHROME = 46;
/** 这一侧可用高不足此值＝不值得往这侧放（低于它翻到另一侧，另一侧也没有＝照样放但列表压到下限） */
export const TREE_PANEL_MIN_SPACE = 150;

/** 矩形竖直方向的两个边（宿主按钮与裁切边界各给一个即可，纯函数＝node 可测） */
export interface TreePanelEdges {
	top: number;
	bottom: number;
}

/**
 * **树形面板往哪侧放、列表封到多高**（v0.4.11+，用户报告口径＝平板上弹窗里的「父场景/关联场景」面板被裁掉＝下面的行看不见也滚不到）：
 * 裁切边界＝最近的 `.modal-content`（核心 `.modal-content{overflow:hidden}`＋`.modal{overflow:auto;max-height:85vh}`），**不是视口**＝
 * 面板是宿主里的 `position:absolute` 子元素，超出 modal-content 就被切＝按视口算会误判。
 * 口径＝① 下方够放（≥`TREE_PANEL_MIN_SPACE`）＝放下方；下方不够且上方更宽裕＝翻上方（`.is-up`）；
 * ② 列表封顶＝min(240, 可用高 − 固定开销) 再夹到 `[96, 240]`＝绝不把行裁进不可达区域，也绝不比默认更高。
 * 尺寸异常（NaN/上下颠倒）＝按「放下方＋默认封顶」兜底，不把面板搞没 */
export function treePanelPlacement(host: TreePanelEdges, bound: TreePanelEdges): { flipUp: boolean; listMaxH: number } {
	const ok = [host.top, host.bottom, bound.top, bound.bottom].every((n) => Number.isFinite(n));
	if (!ok) return { flipUp: false, listMaxH: TREE_PANEL_LIST_MAX };
	const spaceBelow = Math.max(0, bound.bottom - host.bottom);
	const spaceAbove = Math.max(0, host.top - bound.top);
	const flipUp = spaceBelow < TREE_PANEL_MIN_SPACE && spaceAbove > spaceBelow;
	const room = flipUp ? spaceAbove : spaceBelow;
	const capped = Math.min(TREE_PANEL_MAX_H, Math.max(room, TREE_PANEL_LIST_MIN + TREE_PANEL_CHROME)) - TREE_PANEL_CHROME;
	return { flipUp, listMaxH: Math.min(TREE_PANEL_LIST_MAX, Math.max(TREE_PANEL_LIST_MIN, capped)) };
}
