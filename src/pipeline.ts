/**
 * v0.3.0+ 全自动写书流水线（auto-book）的阶段定义与预检需求表。
 * 纯数据 + 纯函数（不 import obsidian），可被 tests/ 直接断言；编排与文件检查在 main.ts。
 *
 * 设计：
 * - 六个阶段映射到既有命令（worldview 为新增命令），流水线按序调用、不重复实现生成逻辑；
 * - 每个阶段声明「前置需求」（requirement）：id 供 main.ts 做文件检查，label 供预检失败提示；
 * - 流水线可从任意节点开始：起始节点之前的阶段不跑，但其文件需求仍由起始阶段的 requirements 检查——
 *   缺文件即拒绝开始（不静默补建）。
 */

export type StageId = "worldview" | "planning" | "book-outline" | "volumes" | "chapter-outlines" | "bodies";

/** 检查项适用范围：always=两种模式都查；volumes=仅分卷模式；flat=仅平铺模式（另一模式自动通过） */
export type RequirementWhen = "always" | "volumes" | "flat";

export interface StageRequirement {
	/** main.ts 按 id 做具体文件/标记检查（此处不掺 IO） */
	id: string;
	when: RequirementWhen;
	/** 预检失败时给用户的中文说明（缺什么、建议先跑哪个命令） */
	label: string;
}

export interface StageDef {
	id: StageId;
	/** 下拉与日志里的中文名 */
	name: string;
	/** 对应执行的插件命令 id（仅展示/对齐用；实际直接调用 cmd 方法） */
	command: string;
	/** 跑该阶段前必须满足的前置需求 */
	requirements: StageRequirement[];
}

export const PIPELINE_STAGES: StageDef[] = [
	{ id: "worldview", name: "生成世界观", command: "worldview-generate", requirements: [] },
	{
		id: "planning",
		name: "生成策划指南",
		command: "planning-guide-worldview",
		requirements: [{ id: "worldview", when: "always", label: "案头资料/世界观.md（非空）→ 可先单独运行「生成世界观」" }],
	},
	{
		id: "book-outline",
		name: "生成书级大纲",
		command: "book-outline-generate",
		requirements: [{ id: "worldview", when: "always", label: "案头资料/世界观.md（非空）→ 可先单独运行「生成世界观」" }],
	},
	{
		id: "volumes",
		name: "建卷并生成卷大纲",
		command: "book-outline-to-volumes",
		requirements: [
			{ id: "worldview", when: "always", label: "案头资料/世界观.md（非空）→ 可先单独运行「生成世界观」" },
			{ id: "book-outline", when: "always", label: "书级《大纲.md》（非空）→ 可先单独运行「生成书级大纲」" },
			{ id: "book-outline-volume-decls", when: "volumes", label: "书级《大纲.md》需含「## 卷：」卷声明（分卷模式）→ 可先运行「生成书级大纲」重新生成" },
		],
	},
	{
		id: "chapter-outlines",
		name: "生成章节大纲",
		command: "volume-outline-to-chapters",
		requirements: [
			{ id: "worldview", when: "always", label: "案头资料/世界观.md（非空）→ 可先单独运行「生成世界观」" },
			{ id: "volumes", when: "volumes", label: "各卷《卷大纲.md》需含「## 第N章」章条目 → 可先运行「从书级大纲生成卷」" },
			{ id: "book-outline-chapters", when: "flat", label: "书级《大纲.md》需含「第N章」章标记（平铺模式拆书级大纲）→ 可先运行「生成书级大纲」" },
		],
	},
	{
		id: "bodies",
		name: "连续编写正文",
		command: "write-chapters-consecutive",
		requirements: [
			{ id: "worldview", when: "always", label: "案头资料/世界观.md（非空）→ 可先单独运行「生成世界观」" },
			{ id: "chapter-outlines", when: "always", label: "各章《章节大纲.md》（非空）→ 可先运行「从卷大纲生成章节」" },
		],
	},
];

export function stageById(id: StageId): StageDef {
	const s = PIPELINE_STAGES.find((x) => x.id === id);
	if (!s) throw new Error(`未知流水线阶段：${String(id)}`);
	return s;
}

/** 从 startAt 起（含）到 stopAt（含）的阶段序列；stopAt 省略＝到末尾、startAt 默认 worldview 起跑完整流水线；
 *  stopAt 排在 startAt 之前＝空序列（调用方按「无可执行阶段」拒绝启动） */
export function stagesFrom(startAt: StageId, stopAt?: StageId): StageDef[] {
	const i = PIPELINE_STAGES.findIndex((s) => s.id === startAt);
	if (i < 0) return [];
	const end = stopAt ? PIPELINE_STAGES.findIndex((s) => s.id === stopAt) : PIPELINE_STAGES.length - 1;
	return end < i ? [] : PIPELINE_STAGES.slice(i, end + 1);
}

/** 起始阶段的前置需求（预检按模式过滤 when 后逐项检查） */
export function requirementsFor(startAt: StageId, flatMode: boolean): StageRequirement[] {
	return stageById(startAt).requirements.filter((r) =>
		r.when === "always" || (r.when === "flat" && flatMode) || (r.when === "volumes" && !flatMode)
	);
}
