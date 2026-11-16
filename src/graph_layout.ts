/**
 * v0.4.4+ 人物关系图（图表模式）的纯几何与纯排序：节点排序 + 力导向布局 + 弧线连线。
 * 纯计算、无 DOM、无 vault 访问，供 relationship_view 调用并单独回归（`src/graph_layout.test.ts`）。
 *
 * 为什么这样排：节点原先按《人物关系.md》里出现的先后落位、等分在一个圆环上——等于随机排布：
 * 连线交叉一团、主次不分、主角也不知道在哪。现在分两步：
 * ①`chainOrder` 先给一个**贪心邻接链**顺序（连线最多的人物＝枢纽≈主角排第一），既做力导向的初始位置
 *   （比纯随机收敛快、结果确定可复现），也保证互相有关系的角色在初始环上彼此相邻；
 * ②`forceLayout` 跑**力导向**（斥力 + 沿边引力 + 往中心的引力，枢纽引力更大）→ 枢纽与其至亲聚在中心、
 *   次要人物被推到外圈，这正是参考图那种「枢纽居中、按重要性分层」的观感；收尾 bbox 归一化填满画布，
 *   再把枢纽**整体平移到偏上的高度**（`hubUp`）——就是「把主角向上提」，只平移、不改相对结构。
 * `ringLayout`（椭圆环）留作退路/对照，不再是默认布局。
 *
 * 连线一律画**向上拱的二次贝塞尔弧**而不是直弦：直弦全穿过中心区域、容易糊成一团；
 * 每条边往上方兜一圈后走向一眼可追。
 */

/** 图上一点：圆心坐标 + 半径（节点圆本身的大小，弧线端点按它裁切，不从圆心里画出来） */
export interface GraphPoint {
	x: number;
	y: number;
	r: number;
}

/** 端点相对节点圆周的额外留白（避免线头压在圆点上） */
const ENDPOINT_PAD = 2;

/** 力导向的横向额外留白：角色名挂在节点**左右**，光让出圆点会裁掉名字，故内框左右各再多让这一截 */
const LABEL_ROOM = 62;

/** 两轴铺满画布时长宽比最多放大到几倍（再大就把图拽歪了） */
const ASPECT_CAP = 2;

/** 退火后的硬碰撞消解：轮数上限与「两个圆点之间至少留的空隙」（这点空隙也是给角色名的呼吸位） */
const COLLIDE_PASSES = 24;
const COLLIDE_GAP = 20;

/** 度数→节点圆半径：连线越多（＝越像主角）点越大，幅度放得比较开，一眼能看出主次（上下限固定，最大不超过小图里一个角色名的宽度） */
export function nodeRadius(degree: number): number {
	return 6 + Math.min(14, degree * 2);
}

/** 度数→角色名字号（跟着重要度分级；面板窄，字号跨度克制，倍率靠滚轮缩放解决） */
export function labelFontSize(degree: number): number {
	return 12 + Math.min(6, degree * 0.8);
}

/**
 * 椭圆环布局：`count` 个点均分在以 (cx,cy) 为心、半轴 (rx,ry) 的椭圆上，起点在正上方（−90°）顺时针。
 * `degrees[i]` 给出第 i 个点的度数（决定圆点大小）；长度不足按 0 度补。rx≠ry 时不再是正圆：
 * 面板本身是横的，横向铺得更开比等高正圆更透气、也不容易把连线挤在中心。
 */
export function ringLayout(count: number, cx: number, cy: number, rx: number, ry: number, degrees: number[]): GraphPoint[] {
	const out: GraphPoint[] = [];
	if (count <= 0) return out;
	for (let i = 0; i < count; i++) {
		const ang = (i / count) * Math.PI * 2 - Math.PI / 2;
		out.push({
			x: cx + rx * Math.cos(ang),
			y: cy + ry * Math.sin(ang),
			r: nodeRadius(degrees[i] ?? 0),
		});
	}
	return out;
}

/** 排序输入：人物名与它的连线数（＝中心度，用来认「谁最像主角」） */
export interface GraphRankNode {
	name: string;
	degree: number;
}

/** 两个名字之间有没有边（无向、按名查；缺项算无） */
function linkedTo(linked: Map<string, Set<string>>, name: string, other: string): boolean {
	return linked.get(name)?.has(other) === true;
}

/** 与集合内已有名字相连的条数 */
function linksInto(linked: Map<string, Set<string>>, name: string, pool: Set<string>): number {
	const nb = linked.get(name);
	if (!nb) return 0;
	let n = 0;
	for (const other of nb) if (pool.has(other)) n++;
	return n;
}

/** 「谁最像主角」＝连线最多的人物（度数并列时取先出现的，保证结果确定可复现）；空图返回空串 */
export function hubOf(nodes: GraphRankNode[]): string {
	let best = -1;
	for (let i = 0; i < nodes.length; i++) if (best < 0 || nodes[i].degree > nodes[best].degree) best = i;
	return best < 0 ? "" : nodes[best].name;
}

/**
 * 贪心邻接链（**环形摆放顺序**，返回值第一个＝枢纽）：
 * ①起点取连线最多的人物（`hubOf`）；
 * ②每轮挑「与已排位人物连边最多」的未排人物（并列按度数、再按原顺序），贴到链的**前端或后端**：
 *   谁离链头/链尾有直接关系就贴哪边，都没有则左右交替（保持对称好看）——贴的过程中枢纽可能被顶到链中间，
 *   故收尾把链**旋转**到枢纽在第一位（链按环首尾相接使用，旋转不改变环序）；
 * ③于是枢纽两侧（返回值第 2 个与最后一个）就是它最亲的人物，互相有关系的角色在环上彼此相邻。
 */
export function chainOrder(nodes: GraphRankNode[], linked: Map<string, Set<string>>): GraphRankNode[] {
	if (!nodes.length) return [];
	const hubName = hubOf(nodes);
	let first = 0;
	for (let i = 0; i < nodes.length; i++) if (nodes[i].name === hubName) first = i;
	const chain: GraphRankNode[] = [nodes[first]];
	const placed = new Set<string>([nodes[first].name]);
	const rest: GraphRankNode[] = [];
	for (let i = 0; i < nodes.length; i++) if (i !== first) rest.push(nodes[i]);
	let preferTail = true;
	while (rest.length) {
		let best = 0;
		let bestLinks = linksInto(linked, rest[0].name, placed);
		for (let i = 1; i < rest.length; i++) {
			const links = linksInto(linked, rest[i].name, placed);
			if (links > bestLinks || (links === bestLinks && rest[i].degree > rest[best].degree)) {
				best = i;
				bestLinks = links;
			}
		}
		const pick = rest[best];
		const toHead = linkedTo(linked, pick.name, chain[0].name);
		const toTail = linkedTo(linked, pick.name, chain[chain.length - 1].name);
		const atTail: boolean = toTail === toHead ? preferTail : toTail; // 标注：否则 tsc 认为它经 `preferTail = !atTail` 自引用（TS7022）
		if (atTail) chain.push(pick);
		else chain.unshift(pick);
		preferTail = !atTail;
		placed.add(pick.name);
		rest.splice(best, 1);
	}
	const at = chain.findIndex((node) => node.name === hubName); // 链按环使用：转一下让枢纽排第一（环序不变）
	return at > 0 ? chain.slice(at).concat(chain.slice(0, at)) : chain;
}

/** 边表 → 邻接表（无向；`chainOrder`／悬停高亮共用同一份口径） */
export function adjacencyMap(edges: Array<{ a: string; b: string }>): Map<string, Set<string>> {
	const m = new Map<string, Set<string>>();
	const touch = (from: string, to: string): void => {
		let s = m.get(from);
		if (!s) {
			s = new Set<string>();
			m.set(from, s);
		}
		s.add(to);
	};
	for (const e of edges) {
		touch(e.a, e.b);
		touch(e.b, e.a);
	}
	return m;
}

/** 力导向输出：一个节点（名字 + 坐标 + 圆点半径） */
export interface GraphLayoutNode extends GraphPoint {
	name: string;
}

/** 力导向输入边：两端名字 + 权重（＝同一对人物登记的处数，权重大的吸得更紧、线也画得更粗） */
export interface GraphEdgeLike {
	a: string;
	b: string;
	weight: number;
}

/** 力导向参数 */
export interface ForceLayoutParams {
	width: number;
	height: number;
	/** 四周留白（点集缩放后填满这个内框；横向自动再加 `LABEL_ROOM` 给角色名） */
	pad?: number;
	/** 降温迭代次数（默认 320；几十个人物时几百轮只是毫秒级） */
	iterations?: number;
	/** 枢纽（连线最多的人物≈主角）最终对齐的高度：相对画布中心往上提的比例，0＝正中、1＝上内框边。默认 0.34＝往上提一档 */
	hubUp?: number;
}

/** 确定性伪随机（同输入同输出：切筛选/重渲染不会跳位） */
function lcg(seed: number): () => number {
	let s = seed % 2147483648;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}

/**
 * 力导向布局（Fruchterman–Reingold 骨架 + 枢纽锚定 + 硬碰撞消解 + 收尾归一化）——比等分圆环好看的关键：
 * ①初始位置按 `chainOrder` 的邻接链铺在椭圆环上（比纯随机收敛快、不受登记顺序影响），再叠加固定种子的微抖动打破对称；
 * ②每轮：全对斥力 k²/d（大圆之间推得更开，避免大点压小点）、沿边引力 d²/k（登记处数多的关系吸得更近→主角与其至亲自然聚在中心）、
 *   所有人受往中心的引力（枢纽的引力明显更大：枢纽居中、次要人物被挤到外圈，正是「按重要性分层」的观感）；
 *   位移按温度 t 封顶并线性降温 → 结果稳定、每次重排一致；
 * ③退火后补几轮**硬碰撞**消解：任何两个圆点至少隔 `r_i + r_j + COLLIDE_GAP`（圆点不互相压着、名字有呼吸位）；
 * ④收尾以**枢纽为锚点**铺满画布：枢纽落到「画布中央偏上」（横向正中、纵向 `hubUp` 高度），其余人物按两轴各自
 *   「刚好不出内框」的最大比例摊开（横向内框已含 `LABEL_ROOM` 给角色名让位，长宽比最多拉 `ASPECT_CAP` 倍）；
 *   摊开后再消解一轮碰撞、把枢纽挪回锚点、最后逐点夹进画布——这就是「把主角提到画面中心」。
 * 纯计算：无 DOM、不读盘。
 */
export function forceLayout(nodes: GraphRankNode[], edges: GraphEdgeLike[], params: ForceLayoutParams): GraphLayoutNode[] {
	const W = params.width;
	const H = params.height;
	const pad = params.pad ?? 56;
	const padX = pad + LABEL_ROOM; // 横向再多让一截：角色名挂在节点左右，光让出圆点不够
	const iterations = params.iterations ?? 320;
	const hubUp = params.hubUp ?? 0.34;
	if (!nodes.length) return [];
	const order = chainOrder(nodes, adjacencyMap(edges));
	const n = order.length;
	const idx = new Map<string, number>();
	order.forEach((node, i) => idx.set(node.name, i));
	const rad = order.map((node) => nodeRadius(node.degree));
	const x = new Array<number>(n).fill(0);
	const y = new Array<number>(n).fill(0);
	const rnd = lcg(0x5eed + n * 7919);
	for (let i = 0; i < n; i++) {
		const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
		x[i] = W / 2 + (W / 2 - padX) * 0.8 * Math.cos(ang) + (rnd() - 0.5) * 24;
		y[i] = H / 2 + (H / 2 - pad) * 0.8 * Math.sin(ang) + (rnd() - 0.5) * 24;
	}
	const springs = edges
		.map((e) => ({ a: idx.get(e.a) ?? -1, b: idx.get(e.b) ?? -1, w: Math.max(1, e.weight) }))
		.filter((e) => e.a >= 0 && e.b >= 0 && e.a !== e.b);
	const hub = Math.max(0, order.findIndex((node) => node.name === hubOf(nodes))); // chainOrder 已把枢纽旋到第一位
	const k = Math.sqrt(((W - 2 * padX) * (H - 2 * pad)) / Math.max(1, n));
	/** **硬碰撞**消解：斥力只保证「大致散开」，圆点互相压着、名字糊在一起还是难看。
	 * 每对若比 `r_i + r_j + COLLIDE_GAP` 更近就沿连线各推开一半（完全重合时按固定方向错开，保持确定性）。 */
	const relaxCollisions = (): void => {
		for (let pass = 0; pass < COLLIDE_PASSES; pass++) {
			let moved = false;
			for (let i = 0; i < n; i++) {
				for (let j = i + 1; j < n; j++) {
					const minSep = rad[i] + rad[j] + COLLIDE_GAP;
					let vx = x[j] - x[i];
					let vy = y[j] - y[i];
					let d = Math.sqrt(vx * vx + vy * vy);
					if (d >= minSep) continue;
					if (d < 0.01) {
						vx = 1;
						vy = 0;
						d = 1;
					}
					const push = (minSep - d) / 2;
					x[i] -= (vx / d) * push;
					y[i] -= (vy / d) * push;
					x[j] += (vx / d) * push;
					y[j] += (vy / d) * push;
					moved = true;
				}
			}
			if (!moved) break; // 已经谁也不压谁就提前收手
		}
	};
	for (let it = 0; it < iterations; it++) {
		const temp = (W / 12) * (1 - it / iterations);
		const dx = new Array<number>(n).fill(0);
		const dy = new Array<number>(n).fill(0);
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				let vx = x[i] - x[j];
				let vy = y[i] - y[j];
				let d = Math.sqrt(vx * vx + vy * vy);
				if (d < 0.01) {
					vx = rnd() - 0.5;
					vy = rnd() - 0.5;
					d = 0.01;
				}
				const size = 1 + (rad[i] + rad[j]) / 20; // 大圆之间多让位
				const f = ((k * k) / d) * size;
				dx[i] += (vx / d) * f;
				dy[i] += (vy / d) * f;
				dx[j] -= (vx / d) * f;
				dy[j] -= (vy / d) * f;
			}
		}
		for (const s of springs) {
			const vx = x[s.a] - x[s.b];
			const vy = y[s.a] - y[s.b];
			const d = Math.max(0.01, Math.sqrt(vx * vx + vy * vy));
			const f = ((d * d) / k) * (1 + 0.45 * Math.min(2, s.w - 1)); // 登记处数多＝关系重，拉近
			dx[s.a] -= (vx / d) * f;
			dy[s.a] -= (vy / d) * f;
			dx[s.b] += (vx / d) * f;
			dy[s.b] += (vy / d) * f;
		}
		for (let i = 0; i < n; i++) {
			const g = i === hub ? 1.1 : 0.22; // 枢纽往中心收得更狠：次要人物被推到外圈
			dx[i] -= (x[i] - W / 2) * g;
			dy[i] -= (y[i] - H / 2) * g;
			const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
			if (d > 0) {
				const step = Math.min(d, temp);
				x[i] += (dx[i] / d) * step;
				y[i] += (dy[i] / d) * step;
			}
		}
	}
	relaxCollisions(); // 退火后再消解几轮硬碰撞，圆点才有各自的呼吸位
	// 以枢纽为**锚点**铺满画布：枢纽落到 (画布中央, hubUp 高度)，其余人物按两轴各自「刚好不出内框」的比例摊开
	// （横向内框已含 LABEL_ROOM 给角色名让位；上下限按锚点分别算，所以「把主角提上去」不会把顶上的人挤出画布）。
	const anchorX = W / 2;
	const anchorY = H / 2 - hubUp * (H / 2 - pad); // hubUp＝相对画布中心往上提的比例（屏幕 −y 方向）
	const hubX = x[hub];
	const hubY = y[hub];
	let sx = Infinity;
	let sy = Infinity;
	for (let i = 0; i < n; i++) {
		const rx = x[i] - hubX;
		const ry = y[i] - hubY;
		if (rx > 0) sx = Math.min(sx, (W - padX - anchorX) / rx);
		else if (rx < 0) sx = Math.min(sx, (anchorX - padX) / -rx);
		if (ry > 0) sy = Math.min(sy, (H - pad - anchorY) / ry);
		else if (ry < 0) sy = Math.min(sy, (anchorY - pad) / -ry);
	}
	if (!Number.isFinite(sx)) sx = 1; // 全都重合在枢纽上（如只有一个角色）：没有展开的余地，保持原样
	if (!Number.isFinite(sy)) sy = 1;
	const tighter = Math.min(sx, sy); // 长宽比最多拉 ASPECT_CAP 倍，免得一条直线被拽成满屏
	sx = Math.min(sx, tighter * ASPECT_CAP);
	sy = Math.min(sy, tighter * ASPECT_CAP);
	for (let i = 0; i < n; i++) {
		x[i] = anchorX + (x[i] - hubX) * sx;
		y[i] = anchorY + (y[i] - hubY) * sy;
	}
	relaxCollisions(); // 摊开后可能又挤到一起，再消解一轮
	let topY = Infinity;
	let bottomY = -Infinity;
	let leftX = Infinity;
	let rightX = -Infinity;
	for (let i = 0; i < n; i++) {
		if (y[i] < topY) topY = y[i];
		if (y[i] > bottomY) bottomY = y[i];
		if (x[i] < leftX) leftX = x[i];
		if (x[i] > rightX) rightX = x[i];
	}
	const dxShift = alignShift(anchorX, x[hub], leftX, rightX, padX, W - padX); // 碰撞可能把枢纽挤离锚点：整体挪回去
	const dyShift = alignShift(anchorY, y[hub], topY, bottomY, pad, H - pad);
	const out: GraphLayoutNode[] = [];
	for (let i = 0; i < n; i++) {
		// 最后一道夹保：谁都出不了画布（名字挂在左右，故横向按 padX 夹）
		const px = Math.min(W - padX, Math.max(padX, x[i] + dxShift));
		const py = Math.min(H - pad, Math.max(pad, y[i] + dyShift));
		out.push({ name: order[i].name, x: px, y: py, r: rad[i] });
	}
	return out;
}

/** 整体平移量：想把 `from` 挪到 `target`，但夹在「点集（现占 `lo..hi`）仍不出内框 [`loBound`,`hiBound`]」之内 */
function alignShift(target: number, from: number, lo: number, hi: number, loBound: number, hiBound: number): number {
	return Math.max(loBound - lo, Math.min(hiBound - hi, target - from));
}

/** 保留一位小数（path 字符串不必带 15 位浮点，也便于测试比对） */
const fmt = (n: number): string => String(Math.round(n * 10) / 10);

/** 画布上边界留白：弧顶不越过 y＝TOP_PAD（免得顶出 viewBox、也尽量不压最上一行角色名） */
const TOP_PAD = 26;

/** 弧度：控制点凸出量 = 弦长 × CURVE_RATIO，并夹在 [CURVE_MIN_BOW, CURVE_MAX_BOW] 之间。
 * 注意二次贝塞尔的**弧顶只到控制点偏移的一半**，故 ratio 要大于直觉值才看得出弯。
 * 向上拱时弧顶 y ＝ 弦中点 y − bow/2，故 `edgeCurvePath` 还会按上边界再夹一次（`bow ≤ 2·(my − TOP_PAD)`）——
 * 靠近画布顶部的边会自动变平，不会顶出 viewBox、也不大幅压到最上一行角色名。`CURVE_MAX_BOW` 防止超长弦兜得太高。
 * 力导向布局下连线方向本就四散，弯曲取**温和档**（看得出局是弧、又不至于满屏大弯互相压） */
const CURVE_RATIO = 0.18;
const CURVE_MIN_BOW = 12;
const CURVE_MAX_BOW = 50;

/**
 * 一条边的 SVG path `d`＝**向上拱的二次贝塞尔弧** `M 起点 Q 控制点 终点`：
 * ①控制点＝弦中点沿「弦的两个法向里朝上（屏幕 −y）的那一侧」外推 bow——取的是「y 更小」那一支，
 *   所以侧向与端点顺序无关（交换 a/b 时法向反号但定支判据同翻，结果一致）。
 * ②竖直弦（dx≈0）的两个法向都不朝上、只能侧凸 → 固定向**右**拱，保证仍是弧而不是直线（同样与端点顺序无关）。
 * ③弧顶 y＝弦中点 y − bow/2（二次贝塞尔弧顶只到控制点偏移的一半），故再按上边界夹一次：`bow ≤ 2·(my − TOP_PAD)`。
 * ④起/终点沿「节点→控制点」方向推到各自圆周外 `r + ENDPOINT_PAD`，线头不压圆点（二次贝塞尔在端点的切线正指向控制点）；
 *   两个节点靠得太近甚至重叠时还会按**对方圆周**再夹一次，避免推过头画出扎进圆里的怪线头。
 */
export function edgeCurvePath(a: GraphPoint, b: GraphPoint): string {
	const mx = (a.x + b.x) / 2;
	const my = (a.y + b.y) / 2;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const chord = Math.sqrt(dx * dx + dy * dy);
	let ox: number;
	let oy: number;
	if (chord < 1e-6) {
		ox = 0;
		oy = -1; // 两端重合：没有弦可作垂线，默认向上（渲染出来是退化弧，几乎不可见）
	} else {
		const n1x = -dy / chord;
		const n1y = dx / chord;
		if (Math.abs(n1y) > 1e-9) {
			const up = n1y < 0 ? 1 : -1; // 两个法向里挑 y 更小（更朝上）的那一支
			ox = n1x * up;
			oy = n1y * up;
		} else {
			ox = 1; // 竖直弦：法向纯水平、朝不上去 → 固定向右拱
			oy = 0;
		}
	}
	const upCap = 2 * Math.max(0, my - TOP_PAD);
	const bow = Math.min(CURVE_MAX_BOW, upCap, Math.max(CURVE_MIN_BOW, chord * CURVE_RATIO));
	const qx = mx + ox * bow;
	const qy = my + oy * bow;
	const start = trimToRim(a, b, qx, qy);
	const end = trimToRim(b, a, qx, qy);
	return `M ${fmt(start.x)} ${fmt(start.y)} Q ${fmt(qx)} ${fmt(qy)} ${fmt(end.x)} ${fmt(end.y)}`;
}

/**
 * 把端点从节点圆心沿「指向控制点」的方向推到圆周外（控制点与圆心重合时退化为指向另一点的方向）。
 * 再按「对方的圆周」夹一次：两个节点挨得太近甚至重叠时，硬推 `r+pad` 会越过对方、画出一截扎进圆里的怪线头，
 * 此时推到 0（＝就落在圆心，线被圆本身盖住），视觉上不留垃圾。
 */
function trimToRim(p: GraphPoint, other: GraphPoint, qx: number, qy: number): { x: number; y: number } {
	let vx = qx - p.x;
	let vy = qy - p.y;
	let vl = Math.sqrt(vx * vx + vy * vy);
	if (vl < 1e-6) {
		vx = 1;
		vy = 0;
		vl = 1;
	}
	const gap = Math.sqrt((other.x - p.x) * (other.x - p.x) + (other.y - p.y) * (other.y - p.y)) - other.r - ENDPOINT_PAD;
	const dist = Math.max(0, Math.min(p.r + ENDPOINT_PAD, gap));
	return { x: p.x + (vx / vl) * dist, y: p.y + (vy / vl) * dist };
}

/**
 * 弧上参数 t 处的坐标（二次贝塞尔），供测试核验「弧比直弦更靠外」与调试用；
 * 端点已被 trimToRim 裁切，故此函数只描述整条理论弧（t 从 0 到 1 覆盖裁切后的段）。
 */
export function curvePoint(d: string, t: number): { x: number; y: number } | null {
	const nums = d.match(/-?\d+(?:\.\d+)?/g);
	if (!nums || nums.length < 6) return null;
	const [sx, sy, qx, qy, ex, ey] = nums.map((s) => Number(s));
	const u = 1 - t;
	return { x: u * u * sx + 2 * u * t * qx + t * t * ex, y: u * u * sy + 2 * u * t * qy + t * t * ey };
}
