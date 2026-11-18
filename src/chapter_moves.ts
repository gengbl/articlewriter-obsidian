/**
 * v0.4.6+（C10）：章节重排的**纯决策层**——从 story_manager 的 IO 流程中抽出的可测规划函数。
 * 只做「谁挪到哪、按什么顺序挪」的号码算术；文件搬移/快照断言/引用重写仍在 story_manager，
 * 其循环顺序必须与此处 plan 一致（升序单遍补洞 / 降序单遍顺延，目标位必空、无临时槽——中断只留断档、不留大号幽灵章）。
 * 本模块不 import obsidian，单测覆盖：src/chapter_moves.test.ts。
 */

export interface RenumberStep {
	key: string;
	from: number;
	to: number;
}

export interface RenumberPlan {
	/** 容器内旧局部号 → 新局部号（连续压缩 1..N） */
	map: Map<number, number>;
	/** 执行序列（升序单遍：只含真正变号的章；位置 i 的章目标位 i+1 此刻必空） */
	steps: RenumberStep[];
	/** 输入是否已 1..N 连续（true＝无需任何搬移） */
	alreadySequential: boolean;
}

/** 单容器补洞规划：按号升序把各章压缩为 1..N（与 renumberChapters 旧内联算术逐一对应） */
export function planRenumber<T extends { key: string; num: number }>(chapters: T[]): RenumberPlan {
	const sorted = [...chapters].sort((a, b) => a.num - b.num);
	const map = new Map<number, number>();
	const steps: RenumberStep[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const to = i + 1;
		map.set(sorted[i].num, to);
		if (sorted[i].num !== to) steps.push({ key: sorted[i].key, from: sorted[i].num, to }); // 升序单遍，只挪真正变号的
	}
	return { map, steps, alreadySequential: steps.length === 0 };
}

/** 单容器号集是否存在洞（≠ 1..N）——renumberChapters 的 anyGap 判定（调用方按容器分别传入） */
export function hasAnyGap(nums: number[]): boolean {
	const sorted = [...nums].sort((a, b) => a - b);
	for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i + 1) return true;
	return false;
}

export interface InsertPlan {
	/** 插入位是否被占（true＝需要顺延；false＝空位直插，不动任何人） */
	collision: boolean;
	/** 需 +1 的章（旧号→新号），**降序排列＝执行顺序**（最高号先移，其目标位必空） */
	shifts: Array<{ from: number; to: number }>;
}

/** 单容器插章顺延规划：nums=该容器现有号（未排序亦可），newNum=插入号 */
export function planInsert(nums: number[], newNum: number): InsertPlan {
	if (!nums.includes(newNum)) return { collision: false, shifts: [] };
	const affected = nums.filter((n) => n >= newNum).sort((a, b) => b - a); // 降序单遍
	return { collision: true, shifts: affected.map((n) => ({ from: n, to: n + 1 })) };
}
