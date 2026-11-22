// v0.4.9+ 场景画布连线路径（从 scene_view.ts 抽出＝纯函数、无 DOM，node 侧可测；渲染与拖动实时重算共用同一口径）。
// 线型统一为**折线**（用户要求：两个场景之间的连线用直角拐角的折线连接）：只走水平段与垂直段，拐点取两段的中间点，
// 不用贝塞尔曲线；两端点同轴时退化为一条直线段。

/** 卡片几何（画布坐标：左上角＋宽高） */
export interface ScBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** 坐标规范到 0.1（拖动落位保留 2 位小数，路径里过长小数只让 d 属性变长、看不出来） */
function n(v: number): number {
	return Math.round(v * 10) / 10;
}

/** 折线 `M x y L …`：相邻同点段与**共线中间点**自动略过（中轴对齐时退化为一条直线段），首点＋去重后的拐点/终点 */
function polylineD(pts: Array<{ x: number; y: number }>): string {
	const kept: Array<{ x: number; y: number }> = [];
	const same = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
		Math.abs(p.x - q.x) < 0.05 && Math.abs(p.y - q.y) < 0.05;
	const collinear = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): boolean =>
		(same(p, q) || same(q, r)) || // 零长度段
		(Math.abs(p.x - q.x) < 0.05 && Math.abs(q.x - r.x) < 0.05) || // 三段同竖
		(Math.abs(p.y - q.y) < 0.05 && Math.abs(q.y - r.y) < 0.05); // 三段同横
	for (const p of pts) {
		while (kept.length >= 2 && collinear(kept[kept.length - 2], kept[kept.length - 1], p)) kept.pop();
		if (kept.length && same(kept[kept.length - 1], p)) continue;
		kept.push({ x: n(p.x), y: n(p.y) });
	}
	if (!kept.length) return "";
	return `M ${String(kept[0].x)} ${String(kept[0].y)}${kept.slice(1).map((p) => ` L ${String(p.x)} ${String(p.y)}`).join("")}`;
}

/** 上下走向的 Z 形折线：从 a 的出边中点垂直到中间线 → 水平移到 b 的中轴 → 垂直接入 b 的入边中点。
 *  `dir`＝行进方向（1＝向下、-1＝向上），中间线取「出边沿行进方向至少 12px、否则两轴间距的一半」＝两端贴得住，
 *  卡片上下轻微交叠（入边反而在出边内侧）时也不会把拐点塞进卡片里。 */
function verticalRoute(ax: number, fromY: number, bx: number, toY: number, dir: 1 | -1): string {
	const midY = fromY + dir * Math.max(12, Math.abs(toY - fromY) / 2);
	return polylineD([{ x: ax, y: fromY }, { x: ax, y: midY }, { x: bx, y: midY }, { x: bx, y: toY }]);
}

/** 左右走向的 Z 形折线（横向并排）：a 侧边中点水平到中间线 → 垂直移到 b 的中轴 → 水平接入 b 侧边中点（口径同 verticalRoute） */
function horizontalRoute(ay: number, fromX: number, by: number, toX: number, dir: 1 | -1): string {
	const midX = fromX + dir * Math.max(12, Math.abs(toX - fromX) / 2);
	return polylineD([{ x: fromX, y: ay }, { x: midX, y: ay }, { x: midX, y: by }, { x: toX, y: by }]);
}

/** 外框 `outer` 是否**完整包住**内块 `inner`（四边都 ≥ 且至少一边真有富余＝同尺寸不算包含） */
function containsBox(outer: ScBox, inner: ScBox): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.w <= outer.x + outer.w &&
		inner.y + inner.h <= outer.y + outer.h &&
		(inner.w < outer.w || inner.h < outer.h)
	);
}

/** **一端在另一端内部**（＝端点取的是「包含框」而另一端的卡片正落在这块框里＝关联的是本区域的子场景）：
 *  走**最短的正交一段**＝从内块某边中点直连外框对应边的中点（取四边间距最小的一侧），不绕到框外再兜回来。
 *  端点仍落在**外框边界上**（用户要求＝关联区域场景时接在包含框边界，不接到区域头卡片本身）。 */
function containmentRoute(inner: ScBox, outer: ScBox): string {
	const sides: Array<{ side: "left" | "right" | "top" | "bottom"; d: number }> = [
		{ side: "left", d: inner.x - outer.x },
		{ side: "right", d: outer.x + outer.w - (inner.x + inner.w) },
		{ side: "top", d: inner.y - outer.y },
		{ side: "bottom", d: outer.y + outer.h - (inner.y + inner.h) },
	];
	let best = sides[0];
	for (const s of sides) if (s.d < best.d) best = s;
	const midX = inner.x + inner.w / 2;
	const midY = inner.y + inner.h / 2;
	if (best.side === "left") return polylineD([{ x: inner.x, y: midY }, { x: outer.x, y: midY }]);
	if (best.side === "right") return polylineD([{ x: inner.x + inner.w, y: midY }, { x: outer.x + outer.w, y: midY }]);
	if (best.side === "top") return polylineD([{ x: midX, y: inner.y }, { x: midX, y: outer.y }]);
	return polylineD([{ x: midX, y: inner.y + inner.h }, { x: midX, y: outer.y + outer.h }]);
}

/**
 * 关联（`- 关联：`）连线路径——**折线**，按几何就近选边：
 * 一方完整落在另一方内部（＝端点之一是**包含框**、另一端的卡片就在框里）＝直连到框边界最近的那条边；
 * 否则竖向不交叠＝走顶/底边（同上下口径）；横向不交叠＝走左右边中点；两轴都交叠（近水平/重叠摆放）＝从两端**底边**下垂到同一水平线再横移。
 * （v0.4.9+：父子之间的层级连线**不再画**——包含关系由包含框＋框左上角的区域标签表达，
 *  所以原来那份父子连线口径 `edgePathD` 已随之下线，本模块只剩关联线一种。
 *  v0.4.9+ 端点几何由调用方决定＝**有子场景的场景用它的包含框矩形**（`scene_view.edgeBox`），所以这里可能收到「框」这种大矩形。）
 */
export function relEdgePathD(a: ScBox, b: ScBox): string {
	if (containsBox(a, b)) return containmentRoute(b, a); // b 在 a 里＝接在 a 的边界上（同一口径，不分调用序）
	if (containsBox(b, a)) return containmentRoute(a, b);
	if (b.y >= a.y + a.h || a.y >= b.y + b.h) { // 竖向不交叠：下方者的顶边 ← 上方者的底边
		const upper = b.y > a.y ? a : b; // 上行卡片（底边出）
		const lower = b.y > a.y ? b : a; // 下行卡片（顶边入）
		return verticalRoute(upper.x + upper.w / 2, upper.y + upper.h, lower.x + lower.w / 2, lower.y, 1);
	}
	if (b.x >= a.x + a.w || a.x >= b.x + a.w) { // 横向并排：右侧者的左边 ← 左侧者的右边
		const left = b.x > a.x ? a : b;
		const right = b.x > a.x ? b : a;
		return horizontalRoute(left.y + left.h / 2, left.x + left.w, right.y + right.h / 2, right.x, 1);
	}
	const below = Math.max(a.y + a.h, b.y + b.h) + 24; // 两轴都交叠：绕到两卡片下方再横移（折线，不画弧）
	return polylineD([
		{ x: a.x + a.w / 2, y: a.y + a.h },
		{ x: a.x + a.w / 2, y: below },
		{ x: b.x + b.w / 2, y: below },
		{ x: b.x + b.w / 2, y: b.y + b.h },
	]);
}

/** **区域（包含框）＝由子场景决定**（v0.4.9+ 用户要求：拖动子场景时，区域的计算**不能把父场景卡片的位置算进去**——
 *  先把全部子场景算出区域，再回头算父场景卡片的新位置）。故父卡片位置＝**纯派生**于子孙并集框 `kids`（与它自己原来摆在哪无关）：
 *  `x＝kids.minX`（与子场景左对齐）；`y＝kids.minY − h − gap`（整块排在子场景上方 gap 处＝区域顶部的那一行）。
 *  这样区域左/右/下三边恒贴着子场景包围盒，只有顶边为区域头让出一行；`kids` 缺几何＝null（调用方不画框也不挪卡）。
 *  不变量（`scene_geometry.test.ts` 断言）：结果 `x === kids.minX` 且 `y + h + gap === kids.minY`＝区域头在左上角、绝不压到子孙；
 *  且结果只由 `kids` 与卡片尺寸决定＝平移全部子孙时结果同样平移（拖动整组不会被弹回） */
export function regionHeadFor(
	head: { w: number; h: number },
	kids: { minX: number; minY: number; maxX: number; maxY: number } | null,
	gap: number,
): { x: number; y: number } | null {
	if (!kids || ![kids.minX, kids.minY, kids.maxX, kids.maxY, head.w, head.h].every((v) => Number.isFinite(v))) return null;
	const g = Math.max(0, gap);
	return { x: n(kids.minX), y: n(kids.minY - head.h - g) };
}

/** 自动布局给「新增场景」算出的落点**能不能直接用**（v0.4.9+ 用户要求＝先自动布局，看不见或压到旧卡片才改放视口左上角）：
 *  ① 新卡（落点＋估算尺寸 `est`）整块落在当前视口 `vp` 内（四边各让出 `pad`＝刚压边不算看得见）；且
 *  ② 该矩形不与任何现有卡片相交（压到旧卡＝看不见）。两者都满足＝true（调用方保持自动布局、不写 `- 位置：`） */
export function autoSlotUsable(
	slot: { x: number; y: number },
	est: { w: number; h: number },
	vp: { minX: number; minY: number; maxX: number; maxY: number },
	occupied: readonly ScBox[],
	pad: number = 8,
): boolean {
	const w = Math.max(0, est.w);
	const h = Math.max(0, est.h);
	const p = Math.max(0, pad);
	if (![slot.x, slot.y, w, h, vp.minX, vp.minY, vp.maxX, vp.maxY].every((v) => Number.isFinite(v))) return false;
	if (slot.x < vp.minX + p || slot.y < vp.minY + p || slot.x + w > vp.maxX - p || slot.y + h > vp.maxY - p) return false;
	return !occupied.some((b) => slot.x < b.x + b.w && slot.x + w > b.x && slot.y < b.y + b.h && slot.y + h > b.y);
}

/** 新建场景的落点**避让**（v0.4.9+）：候选点若已被现有卡片占住（点落在卡片矩形内＝新卡会完全盖住那张），
 *  就按 `step` 阶梯往右下逐级再试，最多 `tries` 级；全被占＝返回最后一级候选（宁可叠上也保持「在视口左上角附近」这个语义）。
 *  不变量：返回点要么不被任何卡片占据，要么是第 `tries` 级候选；且每次结果都 ≥ 原候选（只往右下走，不会跑回视口外） */
export function freeAnchorFor(point: { x: number; y: number }, occupied: readonly ScBox[], step: number, tries: number = 24): { x: number; y: number } {
	let p = { x: n(point.x), y: n(point.y) };
	const s = Math.max(1, Math.round(step));
	for (let i = 0; i < Math.max(1, tries); i++) {
		if (!occupied.some((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h)) return p;
		p = { x: n(p.x + s), y: n(p.y + s) };
	}
	return p;
}

/** **包含框＝父场景的有效区域矩形**＝该区域全部成员当前几何的包围盒四边外扩 `pad`（v0.4.9+ 用户要求：
 *  区域大小一律**由子场景现算**＝任一子场景挪动后宽高都跟着长或缩，绝不保留旧尺寸；
 *  调用方传的「成员」＝**全部子场景** ＋ **已按 `regionHeadFor` 派生出位置的父卡片**（＝区域头只贡献顶部那一行，
 *  它原来摆在哪儿绝不参与区域计算）。区域头与子场景左对齐、排在子场景上方 ⇒ 左/右/下三边仍由子场景说了算）。
 *  成员为空（该区域本次没有可见卡片）＝`null`；坐标取整（直接写进 SVG 属性）；`pad` 负数按 0。
 *  不变量：`x ≤ min(成员 x) − pad`、`y ≤ min(成员 y) − pad`、`x+w ≥ max(成员 x+w) + pad`、`y+h ≥ max(成员 y+h) + pad`（＝每个成员恒在框内）。 */
export function frameBoxFor(members: readonly ScBox[], pad: number): { x: number; y: number; w: number; h: number } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const m of members) {
		if (![m.x, m.y, m.w, m.h].every((v) => Number.isFinite(v))) continue; // 缺几何（未布局/被筛掉）＝不进包围盒
		if (m.x < minX) minX = m.x;
		if (m.y < minY) minY = m.y;
		if (m.x + m.w > maxX) maxX = m.x + m.w;
		if (m.y + m.h > maxY) maxY = m.y + m.h;
	}
	if (!Number.isFinite(minX)) return null;
	const p = Math.max(0, Math.round(pad));
	const left = Math.round(minX);
	const top = Math.round(minY);
	const right = Math.round(maxX);
	const bottom = Math.round(maxY);
	return { x: left - p, y: top - p, w: right - left + p * 2, h: bottom - top + p * 2 };
}

/** **一个区域（有子场景的父场景）的完整口径**（v0.4.9+ 用户要求＝顺序不能反）：
 *  ① 先按**全部子场景**的当前几何取包围盒（`kidsBox`＝区域真正的骨架）；
 *  ② 由它派生**父卡片的新位置**（`regionHeadFor`＝与子场景左对齐、排在子场景上方 `gap` 处）；
 *  ③ 区域矩形＝`frameBoxFor(子场景们 + 派生后的父卡片, pad)`。
 *  ⇒ 父卡片**原来的坐标不参与区域计算**：拖动任一子场景，区域跟着子场景长/缩，父卡片再被搬到区域左上角。
 *  返回 `null`＝本次没有可见子场景（不画框、不挪卡）。不变量：`box` 覆盖每个子场景与派生后的父卡片（四边含 `pad`）；
 *  `box.x === kidsBox.x − pad`（左边恒由最左子场景决定）、`box.y + box.h === kidsBox.y + kidsBox.h + pad`（下边恒由最下子场景决定）、
 *  `box.y === kidsBox.y − head.h − gap − pad`（顶边为区域头让出一行）、`box.w ≥ kidsBox.w + 2pad`（区域头比子场景更宽时才会更宽）；
 *  平移全部子场景 ⇒ `box` 与 `head` 同步平移 */
export function regionFor(
	head: { w: number; h: number },
	kids: readonly ScBox[],
	gap: number,
	pad: number,
): { box: { x: number; y: number; w: number; h: number }; head: { x: number; y: number } } | null {
	const kidsBox = frameBoxFor(kids, 0); // 子场景包围盒（不外扩）
	if (!kidsBox) return null;
	const h = regionHeadFor(head, { minX: kidsBox.x, minY: kidsBox.y, maxX: kidsBox.x + kidsBox.w, maxY: kidsBox.y + kidsBox.h }, gap);
	if (!h) return null;
	const box = frameBoxFor([...kids, { x: h.x, y: h.y, w: head.w, h: head.h }], pad);
	return box ? { box, head: h } : null;
}

/** 连线中点（联通性说明文字的挂靠点）——纯计算版：折线按**总段长**取半长点位（与 SVG `getPointAtLength` 同口径；
 *  面板里实际用 DOM 测距，本函数给 node 侧核验/兜底用） */
export function polylineMidpoint(d: string): { x: number; y: number } | null {
	const nums = d.split(/[ML,\s]+/).filter((s) => s.length > 0).map(Number);
	if (nums.length < 4) return null;
	const pts: Array<{ x: number; y: number }> = [];
	for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
	let total = 0;
	const segs: number[] = [];
	for (let i = 1; i < pts.length; i++) {
		const len = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
		segs.push(len);
		total += len;
	}
	if (!total) return null;
	let target = total / 2;
	for (let i = 0; i < segs.length; i++) {
		if (target > segs[i]) {
			target -= segs[i];
			continue;
		}
		const ratio = segs[i] === 0 ? 0 : target / segs[i];
		return {
			x: pts[i].x + (pts[i + 1].x - pts[i].x) * ratio,
			y: pts[i].y + (pts[i + 1].y - pts[i].y) * ratio,
		};
	}
	return null;
}
