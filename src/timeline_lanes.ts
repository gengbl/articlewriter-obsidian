/**
 * 时间线面板「子时间线轨道」的横向通道分配（纯函数，无 DOM/Obsidian 依赖；消费方＝`timeline_view.ts` 的 `layoutTlLanes`，单测＝`timeline_lanes.test.ts`）。
 *
 * 背景（v0.4.11+ 用户要求＝修掉「子时间轴的绘制和走向很难看」）：每个**有子事件的父事件独占一条连续子时间线轨道**，
 * 轨道 X＝父事件所在 X ＋ 列距。但面板 Y 序＝全局时间序（v0.4.11+ 硬规则），于是**不同一级事件的子事件会在时间上交错**——
 * 若两条轨道落在同一个 X，它们在纵向上就会糊成一条、分不清归属（用户明确要求处理的重叠问题）。
 * 本函数做的事：按传入顺序（**必须是先序＝父先于子，且 `parentX` 已解析**）为每个区间挑一个 X，
 * 规则＝先从 `parentX + step` 起试，若与**已放置轨道**在同一个 X 上纵向区间重叠（含 `vgap` 安全间距）就整体右移一个 `step`，直到不冲突。
 *
 * 口径说明：
 * - 区间＝`[top, bottom]`（＝父事件圆点圆心 → 其最后一个直接子事件圆点圆心，实测布局坐标）；
 * - `overlap` 判定含 `vgap`：两条轨道纵向相距不足 `vgap` 也算重叠（否则会看到两段几乎相接的同列线＝视觉上仍像一条）；
 * - `guard` 上限＝最多右移 32 个列距（防御极端：同一 X 上叠了几十条重叠轨道时不再无限循环，宁可末端重叠也不撑爆布局）；
 * - 返回 `Map<id, X>`；调用方按它写行的 `--tl-x` 与轨道元素坐标，并据最大值撑横向滚动区。
 */

/** 一条待分配通道的轨道区间：`id`＝宿主父事件的行标识；`parentId`＝其父事件行的 id（一级事件＝null ⇒ 基准取 `axisX` 主轴）。
 *  **传入顺序必须是先序（父先于子）**：`parentId` 的已分配 X 就是本区间的基准，先序保证它已解析。 */
export interface TlLaneInterval {
	id: string;
	parentId: string | null;
	top: number;
	bottom: number;
}

/** 已放置轨道（用于冲突检测） */
interface PlacedLane {
	x: number;
	top: number;
	bottom: number;
}

/** 纵向区间是否重叠（含 vgap 安全间距：相距不足 vgap 也算重叠）——两侧各留 vgap 的缓冲带相交即算 */
function tlLanesOverlap(a: PlacedLane, top: number, bottom: number, vgap: number): boolean {
	return a.top < bottom + vgap && top < a.bottom + vgap;
}

/**
 * 为一批轨道区间分配 X 通道（见文件头口径）：基准＝`parentId` 已分配的 X（一级事件＝`axisX`）＋ `step`，同 X 纵向重叠则依次再右移 `step`。
 * 返回 `Map<id, X>`（＝该父事件**给子女用的那条轨道**的 X；调用方按它写子行的 `--tl-x` 与轨道元素坐标，并据最大值撑横向滚动区）。
 * 纯确定性：输入相同 ⇒ 输出相同（无随机、无时钟、无 DOM）。
 */
export function assignTlLaneXs(items: TlLaneInterval[], axisX: number, step: number, vgap: number): Map<string, number> {
	const placed: PlacedLane[] = [];
	const out = new Map<string, number>();
	for (const it of items) {
		const px = it.parentId !== null ? out.get(it.parentId) : undefined; // 先序保证＝parentId 若存在则其 X 已分配（缺位＝结构异常＝回落主轴）
		const base = px === undefined ? axisX : px;
		let x = base + step;
		for (let guard = 0; guard < 32; guard++) {
			const clash = placed.some((l) => Math.abs(l.x - x) < 0.5 && tlLanesOverlap(l, it.top, it.bottom, vgap));
			if (!clash) break;
			x += step;
		}
		placed.push({ x, top: it.top, bottom: it.bottom });
		out.set(it.id, x);
	}
	return out;
}
