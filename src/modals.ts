import { App, Component, MarkdownRenderer, Modal, Notice, SuggestModal, Setting, TFile, TFolder, ToggleComponent } from "obsidian";
import { PIPELINE_STAGES, type StageId } from "./pipeline"; // v0.3.0+：AutoBookModal 起始节点下拉（pipeline.ts 纯数据、不 import obsidian，无循环依赖）
import { parseTimelineTime } from "./md_docs"; // v0.3.3+：EventEditModal 时间点校验（md_docs 纯数据模块，无循环依赖）

/** 单行文本输入框；提交回调收到值（空串视为取消）。可选 hint：渲染在标题与输入框之间的说明文字（支持 \n 多行，样式 .aw-prompt-hint）；可选 initial：预填初始值（光标置于末尾） */
export class TextInputModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private placeholderText: string,
		private onSubmit: (value: string) => void | Promise<void>,
		private onCancel?: () => void,
		private hintText?: string,
		private initialText?: string
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		if (this.hintText) this.contentEl.createDiv({ text: this.hintText, cls: "aw-prompt-hint" }); // v0.1.6+：详细说明放输入框上方（原仅占位符提示、易被忽略）
		new Setting(this.contentEl).addText((text) => {
			text.setPlaceholder(this.placeholderText);
			if (this.initialText) text.inputEl.value = this.initialText; // 预填（可选；回车即按预填值提交）
			text.inputEl.focus();
			window.setTimeout(() => { const n = text.inputEl.value.length; text.inputEl.setSelectionRange(n, n); }, 0); // 光标置末尾，避免选中态误删预填内容
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					const value = text.inputEl.value.trim();
					this.submitted = true;
					this.close();
					void this.onSubmit(value);
				} else if (e.key === "Escape") {
					this.close(); // onClose 触发 onCancel
				}
			});
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 新建文档单弹窗（v0.1.8+）：单一视图——顶部全宽输入框（内部占位提示「自定义文件名…」），中部为该容器标准模板文档行（均可点击选中：名称回填进输入框并标记 is-selected；已存在项保留置灰样式仅作提示、同样可选中），**CTA「确定」按钮位于整个弹窗最底部**（手机端可点按确认、回车同效）。全程只弹一次窗 */
export class NewFilePickerModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private options: Array<{ name: string; exists: boolean }>,
		private onSubmit: (result: { kind: "custom"; name: string } | { kind: "std"; name: string }) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const inputEl = this.contentEl.createEl("input", { cls: "text-input aw-newdoc-input", type: "text" }); // 原生 input 保证占满整行（Setting 布局在部分主题下会右对齐缩窄、与下方列表错列）
		inputEl.setAttr("placeholder", "自定义文件名…"); // 原前置标签改为输入框内部提示
		inputEl.focus();
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit(inputEl.value.trim());
			} else if (e.key === "Escape") {
				this.close();
			}
		});
		const rows: Record<string, HTMLElement> = {};
		for (const opt of this.options) {
			const row = this.contentEl.createDiv({ cls: `aw-newdoc-opt${opt.exists ? " aw-newdoc-off" : ""}` });
			row.createSpan({ text: opt.name });
			if (opt.exists) row.createSpan({ text: "已存在", cls: "aw-newdoc-sub" });
			rows[opt.name] = row;
			row.addEventListener("click", () => { // 点选=回填名称+标记选中（含已存在项）；创建动作统一由底部「确定」触发
				inputEl.value = opt.name;
				for (const r of Object.values(rows)) r.removeClass("is-selected");
				row.addClass("is-selected");
			});
		}
		new Setting(this.contentEl).addButton((b) => b.setCta().setButtonText("确定").onClick(() => this.submit(inputEl.value.trim()))); // 「确定」置于弹窗最底部：标准名→std 路径（main.ts 按存在性分支），自定义名直接建空文件
	}

	private submit(value: string): void {
		if (!value) return; // 空输入不提交，防误触建出无效文件
		this.submitted = true;
		this.close();
		const std = this.options.find((o) => o.name === value); // 与任一标准模板文档同名（不论是否已存在）→std 路径，否则自定义空文件
		void this.onSubmit(std ? { kind: "std", name: value } : { kind: "custom", name: value });
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel(); // 未提交即关闭（Esc/点外部）视为取消
	}
}
export interface NewStoryInput {
	title: string;
	genre: string;
	style: string;
}

const PRESET_STYLES = ["网文小说", "剧本", "普通小说", "散文随笔"];

/** 新书创建：标题 / 题材类型 / 编写类型（对齐 Python /new 三项询问） */
export class NewStoryModal extends Modal {
	private submitted = false;

	constructor(app: App, private onSubmit: (input: NewStoryInput) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "创建新小说" });
		let title = "";
		let genre = "网文小说";
		let style = "网文小说";

		new Setting(this.contentEl).setName("标题").addText((text) => {
			text.setPlaceholder("书名");
			text.onChange((v) => (title = v));
			text.inputEl.focus();
		});
		new Setting(this.contentEl).setName("题材类型").addText((text) => {
			text.setValue(genre);
			text.onChange((v) => (genre = v));
		});
		new Setting(this.contentEl)
			.setName("编写类型")
			.addDropdown((drop) => {
				for (const s of PRESET_STYLES) drop.addOption(s, s);
				drop.setValue(style).onChange((v) => (style = v));
			})
			.addText((text) => {
				text.setPlaceholder("或输入自定义类型名");
				text.onChange((v) => (style = v || style));
			});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("创建").setCta().onClick(async () => {
				if (!title.trim()) return;
				this.submitted = true;
				this.close();
				await this.onSubmit({ title: title.trim(), genre: genre.trim() || "网文小说", style: style.trim() || "网文小说" });
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 各卷章数输入共用（AutoBookModal / BookSkillCreateModal）：解析＋由卷数×各卷章数推算全书总章数 */
const COUNTS_HINT = "每卷一个整数（逗号分隔），或单个整数用于所有卷";
function parseCountsText(text: string): number[] {
	return text.split(/[,，、\s]+/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
}
function computedTotalChapters(volCount: number, nums: number[]): number | null {
	if (!Number.isSafeInteger(volCount) || volCount < 1 || !nums.length) return null;
	if (nums.some((n) => !(Number.isSafeInteger(n) && n >= 1))) return null;
	if (nums.length === 1) return volCount * nums[0];
	if (nums.length === volCount) return nums.reduce((a, b) => a + b, 0);
	return null;
}

/** v0.3.1+ 起始/停止节点双下拉（AutoBookModal / BookSkillCreateModal / SkillRangeModal 共用）：
 *  停止节点下拉多一项「跑到末尾」（映射 undefined＝至流水线末尾）；返回当前值读取器与区间校验（空串＝合法，停止节点不得排在起始节点之前） */
function addStageRangeSettings(contentEl: HTMLElement, init: { startAt?: StageId; endAt?: StageId }): { startAt: () => StageId; endAt: () => StageId | undefined; error: () => string } {
	let startAt: StageId = init.startAt ?? "worldview";
	let endSel: string = init.endAt ?? "end";
	new Setting(contentEl).setName("起始节点").addDropdown((drop) => {
		for (const s of PIPELINE_STAGES) drop.addOption(s.id, s.name);
		drop.setValue(startAt).onChange((v) => { startAt = v as StageId; });
	});
	new Setting(contentEl).setName("停止节点").setDesc("所选阶段也会执行；「跑到末尾」＝一直执行到「连续编写正文」").addDropdown((drop) => {
		for (const s of PIPELINE_STAGES) drop.addOption(s.id, s.name);
		drop.addOption("end", "跑到末尾");
		drop.setValue(endSel).onChange((v) => { endSel = v; });
	});
	return {
		startAt: () => startAt,
		endAt: () => (endSel === "end" ? undefined : endSel as StageId),
		error: () => {
			if (endSel === "end") return "";
			const i = PIPELINE_STAGES.findIndex((s) => s.id === startAt);
			const j = PIPELINE_STAGES.findIndex((s) => s.id === endSel);
			return j < i ? "停止节点不能排在起始节点之前" : "";
		},
	};
}

/** v0.3.0+ 全自动写书流水线参数弹窗（仅「按技能全自动写书」缺参补填时打开）：起始/停止节点 / 一句话设定 / 规模参数（分卷＝卷数＋各卷章数；平铺＝总章数）/ 覆盖已有产物开关 */
export interface AutoBookInput {
	startAt: StageId;
	endAt?: StageId; // v0.3.1+ 停止节点（含）；缺省＝跑到流水线末尾
	premise: string;
	volumeCount: number; // 分卷模式：计划卷数（≥1）
	chapterCounts: number[]; // 分卷模式：各卷目标章数（长度＝volumeCount；单值输入时已复制填满）
	flatTotalChapters: number; // 平铺模式：全书总章数（≥1）
	overwrite: boolean; // true=已有世界观/策划指南/书级大纲也重新生成（覆盖）；false=已有即跳过
}

export class AutoBookModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private flatMode: boolean,
		private init: { startAt?: StageId; endAt?: StageId; premise?: string; volumeCount?: number; chapterCounts?: number[]; flatTotalChapters?: number },
		private onSubmit: (input: AutoBookInput) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "按技能全自动写书 — 补填参数" });
		this.contentEl.createEl("p", { text: "从起始节点起依次执行：生成世界观 → 生成策划指南 → 生成书级大纲 → 建卷并生成卷大纲 → 生成章节大纲 → 连续编写正文；可用停止节点提前收尾。缺少前置文件会在开始前检查并拒绝启动。", cls: "aw-dim" });
		let premise = this.init.premise ?? "";
		let volCount = this.init.volumeCount ?? 3;
		let countsText = (this.init.chapterCounts ?? []).join(", ") || "10";
		let flatTotal = this.init.flatTotalChapters ?? 30;
		let overwrite = false;
		let errText = "";
		const errEl = this.contentEl.createDiv({ cls: "articlewriter-muted" });

		const range = addStageRangeSettings(this.contentEl, this.init);
		// 一句话设定：整行宽度都给输入框（styles.css .aw-setting-stretch），长设定不必在小框里横向滚动；6 行高，可纵向拖拽
		const premiseSetting = new Setting(this.contentEl).setName("一句话设定");
		premiseSetting.settingEl.addClass("aw-setting-stretch");
		premiseSetting.addTextArea((ta) => {
			ta.setPlaceholder("例：一个能看见别人死期的少年，发现自己每次说出死期都会提前应验");
			ta.setValue(premise).onChange((v) => (premise = v));
			ta.inputEl.rows = 6;
		});
		if (this.flatMode) {
			new Setting(this.contentEl).setName("全书总章数").addText((text) => {
				text.setValue(String(flatTotal)).onChange((v) => { flatTotal = Number(v.trim()) || 0; });
			});
		} else {
			new Setting(this.contentEl).setName("卷数").addText((text) => {
				text.setValue(String(volCount)).onChange((v) => { volCount = Number(v.trim()) || 0; updateCountsDesc(); });
			});
			const countsSetting = new Setting(this.contentEl).setName("各卷章数");
			countsSetting.addText((text) => {
				text.setPlaceholder(COUNTS_HINT);
				text.setValue(countsText).onChange((v) => { countsText = v; updateCountsDesc(); });
			});
			const updateCountsDesc = (): void => {
				const t = computedTotalChapters(volCount, parseCountsText(countsText));
				countsSetting.setDesc(t != null ? `${COUNTS_HINT}（全书总章数 = ${t}）` : COUNTS_HINT);
			};
			updateCountsDesc();
		}
		new Setting(this.contentEl).setName("覆盖已有产物").setDesc("开启：世界观/策划指南/书级大纲即使已有内容也重新生成；关闭：已有即跳过该阶段").addToggle((t) => {
			t.setValue(overwrite).onChange((v) => (overwrite = v));
		});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("开始").setCta().onClick(async () => {
				const nums = parseCountsText(countsText);
				const rangeErr = range.error();
				if (rangeErr) { errText = rangeErr; errEl.setText(errText); return; }
				if (!premise.trim() && range.startAt() === "worldview") { errText = "起始节点为「生成世界观」时必须填写一句话设定"; errEl.setText(errText); return; }
				if (this.flatMode) {
					if (!(Number.isSafeInteger(flatTotal) && flatTotal >= 1)) { errText = "总章数须为正整数"; errEl.setText(errText); return; }
				} else {
					if (!(Number.isSafeInteger(volCount) && volCount >= 1)) { errText = "卷数须为正整数"; errEl.setText(errText); return; }
					if (nums.some((n) => !(Number.isSafeInteger(n) && n >= 1))) { errText = "各卷章数须全为正整数"; errEl.setText(errText); return; }
					if (nums.length !== 1 && nums.length !== volCount) { errText = `各卷章数须为 ${volCount} 个（或单个整数用于所有卷），收到 ${nums.length} 个`; errEl.setText(errText); return; }
				}
				this.submitted = true;
				this.close();
				await this.onSubmit({
					startAt: range.startAt(),
					endAt: range.endAt(),
					premise: premise.trim(),
					volumeCount: volCount,
					chapterCounts: this.flatMode ? [] : (nums.length === 1 ? Array.from({ length: volCount }, () => nums[0]) : nums),
					flatTotalChapters: flatTotal,
					overwrite,
				});
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** v0.3.0+ 自动化建书技能创建向导：生成「案头资料/<文件名>.md」技能文件（frontmatter 参数＋正文一句话设定），
 *  供「按技能全自动写书」免交互执行；参数按所选模式校验，与 AutoBookModal 同一套规则 */
export interface BookSkillCreateInput {
	fileName: string; // 技能文件名（不含 .md，已去非法字符）
	startAt: StageId;
	endAt?: StageId; // v0.3.1+ 停止节点（含）；「跑到末尾」＝不写 end 字段
	premise: string; // 正文＝一句话设定
	mode: "flat" | "volumes";
	flatTotalChapters: number;
	volumeCount: number;
	chapterCounts: number[]; // 长度 1 时已按卷数复制填满
	overwrite: boolean;
}

export class BookSkillCreateModal extends Modal {
	constructor(
		app: App,
		private flatMode: boolean, // 当前书籍模式（默认选中项）
		private initPremise: string, // 预填 state.one_line
		private onSubmit: (input: BookSkillCreateInput) => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "创建自动化建书技能" });
		this.contentEl.createEl("p", {
			text: "技能文件将保存到当前书籍「案头资料/」：frontmatter 存规模参数、正文存一句话设定。之后运行「按技能全自动写书」——参数齐全即免交互跑完整流水线，缺参会弹窗补填。技能文件也可在聊天窗口用 @ 引用。",
			cls: "aw-dim",
		});
		let fileName = "自动建书";
		let premise = this.initPremise;
		let mode: "flat" | "volumes" = this.flatMode ? "flat" : "volumes";
		let flatTotal = 30;
		let volCount = 3;
		let countsText = "10";
		let overwrite = false;
		let errText = "";
		const errEl = this.contentEl.createDiv({ cls: "articlewriter-muted" });

		new Setting(this.contentEl).setName("技能文件名").addText((text) => {
			text.setPlaceholder("案头资料/下的文件名（不含 .md）");
			text.setValue(fileName).onChange((v) => (fileName = v));
		});
		const range = addStageRangeSettings(this.contentEl, {});
		const premiseSetting = new Setting(this.contentEl).setName("一句话设定（写入正文）");
		premiseSetting.settingEl.addClass("aw-setting-stretch");
		premiseSetting.addTextArea((ta) => {
			ta.setPlaceholder("例：一个能看见别人死期的少年，发现自己每次说出死期都会提前应验");
			ta.setValue(premise).onChange((v) => (premise = v));
			ta.inputEl.rows = 6;
		});
		new Setting(this.contentEl).setName("规模模式").addDropdown((drop) => {
			drop.addOption("flat", "平铺（无卷）");
			drop.addOption("volumes", "分卷");
			drop.setValue(mode).onChange((v) => { mode = v as "flat" | "volumes"; applyMode(); });
		});
		const flatTotalSetting = new Setting(this.contentEl).setName("全书总章数").addText((text) => {
			text.setValue(String(flatTotal)).onChange((v) => { flatTotal = Number(v.trim()) || 0; });
		});
		const volCountSetting = new Setting(this.contentEl).setName("卷数").addText((text) => {
			text.setValue(String(volCount)).onChange((v) => { volCount = Number(v.trim()) || 0; updateCountsDesc(); });
		});
		const countsSetting = new Setting(this.contentEl).setName("各卷章数");
		countsSetting.addText((text) => {
			text.setPlaceholder(COUNTS_HINT);
			text.setValue(countsText).onChange((v) => { countsText = v; updateCountsDesc(); });
		});
		const updateCountsDesc = (): void => {
			const t = computedTotalChapters(volCount, parseCountsText(countsText));
			countsSetting.setDesc(t != null ? `${COUNTS_HINT}（全书总章数 = ${t}）` : COUNTS_HINT);
		};
		const applyMode = (): void => {
			flatTotalSetting.settingEl.toggleClass("hide", mode !== "flat");
			volCountSetting.settingEl.toggleClass("hide", mode !== "volumes");
			countsSetting.settingEl.toggleClass("hide", mode !== "volumes");
			updateCountsDesc();
		};
		applyMode();
		new Setting(this.contentEl).setName("覆盖已有产物").setDesc("开启：世界观/策划指南/书级大纲即使已有内容也重新生成；关闭：已有即跳过该阶段").addToggle((t) => {
			t.setValue(overwrite).onChange((v) => (overwrite = v));
		});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("创建技能文件").setCta().onClick(async () => {
				const safeName = fileName.replace(/[\\/:*?"<>|]/g, "").trim();
				const nums = parseCountsText(countsText);
				const rangeErr = range.error();
				if (rangeErr) { errText = rangeErr; errEl.setText(errText); return; }
				if (!safeName) { errText = "技能文件名不能为空"; errEl.setText(errText); return; }
				if (!premise.trim() && range.startAt() === "worldview") { errText = "起始节点为「生成世界观」时必须填写一句话设定"; errEl.setText(errText); return; }
				if (mode === "flat") {
					if (!(Number.isSafeInteger(flatTotal) && flatTotal >= 1)) { errText = "平铺模式：全书总章数须为正整数"; errEl.setText(errText); return; }
				} else {
					if (!(Number.isSafeInteger(volCount) && volCount >= 1)) { errText = "分卷模式：卷数须为正整数"; errEl.setText(errText); return; }
					if (nums.some((n) => !(Number.isSafeInteger(n) && n >= 1))) { errText = "各卷章数须全为正整数"; errEl.setText(errText); return; }
					if (nums.length !== 1 && nums.length !== volCount) { errText = `各卷章数须为 ${volCount} 个（或单个整数用于所有卷），收到 ${nums.length} 个`; errEl.setText(errText); return; }
				}
				await this.onSubmit({
					fileName: safeName,
					startAt: range.startAt(),
					endAt: range.endAt(),
					premise: premise.trim(),
					mode,
					flatTotalChapters: mode === "flat" ? flatTotal : 0,
					volumeCount: mode === "volumes" ? volCount : 0,
					chapterCounts: mode === "volumes" ? (nums.length === 1 ? Array.from({ length: volCount }, () => nums[0]) : nums) : [],
					overwrite,
				});
				this.close();
			})
		);
	}
}

/** v0.3.1+ 技能运行范围确认弹窗（「按技能全自动写书」参数齐全时弹出）：预填技能文件里的 start/end 节点，
 *  允许临时调整起始/停止节点后再开跑；确认即回调 (startAt, endAt)，取消＝不执行 */
export class SkillRangeModal extends Modal {
	constructor(
		app: App,
		private skillName: string,
		private init: { startAt?: StageId; endAt?: StageId },
		private onSubmit: (startAt: StageId, endAt?: StageId) => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: `按技能全自动写书 — ${this.skillName}` });
		this.contentEl.createEl("p", { text: "技能参数已齐全。确认或调整执行范围后开始；停止节点也会执行，「跑到末尾」＝一直执行到「连续编写正文」。", cls: "aw-dim" });
		let errText = "";
		const errEl = this.contentEl.createDiv({ cls: "articlewriter-muted" });

		const range = addStageRangeSettings(this.contentEl, this.init);

		const btn = new Setting(this.contentEl).addButton((b) => b.setButtonText("取消").onClick(() => this.close()));
		btn.addButton((b) => b.setButtonText("开始").setCta().onClick(async () => {
			const rangeErr = range.error();
			if (rangeErr) { errText = rangeErr; errEl.setText(errText); return; }
			this.close();
			await this.onSubmit(range.startAt(), range.endAt());
		}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 批量新建卷：手动把卷名逐个加入列表（可上移/下移/删除），确定后按列表顺序依次创建；不连环弹框 */
export class VolumeBatchCreateModal extends Modal {
	private submitted = false;
	private pending: string[] = [];
	private listEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(
		app: App,
		private storyName: string,
		private existingNames: string[],
		private onSubmit: (names: string[]) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: `新建卷（《${this.storyName}》）` });
		this.contentEl.createDiv({
			text: this.existingNames.length
				? `已有卷：${this.existingNames.join("、")}。新卷名须唯一，不能与它们重复；要建几个就在下面加几行，确定后按列表顺序依次创建。`
				: "该书还没有任何卷。在下方逐个添加要新建的卷名，确定后按列表顺序依次创建。",
		});
		new Setting(this.contentEl).setName("新卷名").addText((text) => {
			text.setPlaceholder("输入卷名，回车或点「添加」");
			text.inputEl.focus();
			this.inputEl = text.inputEl;
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.addCurrent();
				} else if (e.key === "Escape") {
					this.close(); // onClose 触发 onCancel
				}
			});
		}).addButton((btn) => btn.setButtonText("添加").onClick(() => this.addCurrent()));
		this.statusEl = this.contentEl.createDiv();
		this.listEl = this.contentEl.createDiv();
		this.renderList();
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("确定创建").setCta().onClick(async () => {
					if (!this.pending.length) return;
					this.submitted = true;
					const names = [...this.pending];
					this.close();
					await this.onSubmit(names);
				})
			)
			.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
	}

	private setStatus(msg: string): void {
		if (this.statusEl) this.statusEl.setText(msg);
	}

	private addCurrent(): void {
		const name = this.inputEl?.value.trim() ?? "";
		if (!name) {
			this.setStatus("");
			return;
		}
		if (this.existingNames.includes(name)) {
			this.setStatus(`「${name}」已存在：卷名须唯一`);
			return;
		}
		if (this.pending.includes(name)) {
			this.setStatus(`「${name}」已在列表中`);
			return;
		}
		this.pending.push(name);
		if (this.inputEl) this.inputEl.value = "";
		this.setStatus("");
		this.renderList();
		this.inputEl?.focus();
	}

	private renderList(): void {
		const el = this.listEl;
		if (!el) return;
		el.empty();
		this.pending.forEach((name, i) => {
			new Setting(el)
				.setName(`${i + 1}. ${name}`)
				.addButton((b) =>
					b.setIcon("arrow-up")
						.setTooltip("上移（提前创建顺序）")
						.setDisabled(i === 0)
						.onClick(() => {
							[this.pending[i - 1], this.pending[i]] = [this.pending[i], this.pending[i - 1]];
							this.renderList();
						})
				)
				.addButton((b) =>
					b.setIcon("arrow-down")
						.setTooltip("下移（延后创建顺序）")
						.setDisabled(i === this.pending.length - 1)
						.onClick(() => {
							[this.pending[i + 1], this.pending[i]] = [this.pending[i], this.pending[i + 1]];
							this.renderList();
						})
				)
				.addButton((b) => b.setButtonText("删除").onClick(() => {
					this.pending.splice(i, 1);
					this.renderList();
				}));
		});
		if (!this.pending.length) this.setStatus("");
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 章节列表（点击打开正文，对齐 /chapter list + /open） */
export interface ChapterItem {
	num: number;
	key?: string; // v0.0.15：复合键 "volId:N" / "N"；缺省时按 num 处理
	title: string;
	path: string; // 章节目录路径
	isCurrent: boolean;
	display?: string; // 展示名（含卷前缀），缺省用「第NN章 标题」
}

export class ChapterListModal extends SuggestModal<ChapterItem> {
	constructor(app: App, private items: ChapterItem[], private onOpenBody: (item: ChapterItem) => void | Promise<void>) {
		super(app);
		this.inputEl.placeholder = "选择章节打开正文…";
	}

	getSuggestions(): ChapterItem[] {
		return this.items;
	}

	renderSuggestion(item: ChapterItem, el: HTMLElement): void {
		el.createSpan({ text: item.display || `第${String(item.num).padStart(2, "0")}章 ${item.title}` });
		if (item.isCurrent) el.createSpan({ text: " （当前）", cls: "aw-dim" });
	}

	onChooseSuggestion(item: ChapterItem): void {
		void this.onOpenBody(item);
	}
}

// ---------- work_dir 文件夹选择器 ----------

function collectFolders(app: App): string[] {
	const result: string[] = [];
	const walk = (folder: TFolder, depth: number) => {
		if (depth >= 3 || result.length >= 500) return; // v0.0.x：真正限制到 3 层深（此前 >3 会多列一层）
		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;
			if (child.name.startsWith(".")) continue; // .obsidian 等隐藏目录
			result.push(child.path);
			walk(child, depth + 1);
		}
	};
	walk(app.vault.getRoot(), 0);
	return result.sort((a, b) => a.localeCompare(b, "zh"));
}

/** 选择 vault 内已有文件夹作为工作目录（work_dir）；留空输入=vault 根 */
export class FolderPickerModal extends SuggestModal<string> {
	private submitted = false;

	constructor(app: App, private onPick: (path: string) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
		this.inputEl.placeholder = "选择写小说的文件夹（work_dir），支持模糊搜索…";
	}

	getSuggestions(query: string): string[] {
		const all = collectFolders(this.app);
		if (!query.trim()) return all;
		const q = query.trim().toLowerCase();
		return all.filter((p) => p.toLowerCase().includes(q));
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	override onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) this.onCancel();
	}

	onChooseSuggestion(path: string): void {
		this.submitted = true;
		this.close();
		void this.onPick(path);
	}
}

/** 多小说选择器 */
export class StoryPickerModal extends SuggestModal<string> {
	private submitted = false;

	constructor(app: App, private stories: string[], private onPick: (name: string) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
		this.inputEl.placeholder = "选择要操作的小说…";
	}

	getSuggestions(): string[] {
		return this.stories;
	}

	renderSuggestion(name: string, el: HTMLElement): void {
		el.setText(name);
	}

	override onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) this.onCancel();
	}

	onChooseSuggestion(name: string): void {
		this.submitted = true;
		this.close();
		void this.onPick(name);
	}
}

/** vault Markdown 文档选择器（引用文档配置框「添加 vault 文档」）：模糊搜索 vault 内全部 .md，选中即直接添加，无需手输路径 */
export class VaultFilePickerModal extends SuggestModal<TFile> {
	constructor(app: App, private onPick: (path: string) => void) {
		super(app);
		this.inputEl.placeholder = "选择 vault 内的 Markdown 文档（按路径模糊搜索）…";
	}

	getSuggestions(query: string): TFile[] {
		const all = this.app.vault.getMarkdownFiles();
		const q = query.trim().toLowerCase();
		const hit = q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
		return hit.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 200);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	onChooseSuggestion(file: TFile): void {
		this.close();
		this.onPick(file.path);
	}
}

/** 技能文件选择器（引用文档配置框「添加技能」，v0.3.0+）：按基名模糊搜索 SKILLS/ 下的技能（名单由调用方打开弹窗前异步加载），选中即添加为 skill:<基名> */
export class SkillPickerModal extends SuggestModal<string> {
	constructor(app: App, private names: string[], private onPick: (name: string) => void, placeholder = "选择技能（SKILLS/*.md，按名称模糊搜索）…") {
		super(app);
		this.inputEl.placeholder = placeholder;
	}

	getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		return this.names.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 200);
	}

	renderSuggestion(name: string, el: HTMLElement): void {
		el.setText(name);
	}

	onChooseSuggestion(name: string): void {
		this.close();
		this.onPick(name);
	}
}

// ---------- 通用操作菜单（卷/场景/角色/伏笔等管理入口）----------

export interface ActionItem {
	label: string;
	sub?: string;
	marker?: string; // 如 "▶ 当前"（当前书/章/卷/场景的数据侧标记）
	disabled?: boolean;
}

/** 可点击的动作列表；回车选择高亮项，Esc 取消 */
export class ActionMenuModal extends Modal {
	private submitted = false;
	private selected = 0;
	private onKeydown?: (e: KeyboardEvent) => void; // 打开期间挂 document(捕获)，焦点不在 contentEl 内也能响应↑↓/回车/Esc

	constructor(
		app: App,
		private title: string,
		private items: ActionItem[],
		private onSelect: (index: number) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const list = this.contentEl.createDiv({ cls: "aw-action-list" }); // max-height/overflow-y 走 styles.css .aw-action-list
		this.renderList(list);
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("确认").setCta().onClick(() => this.choose())
		);
		this.onKeydown = (e) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				this.moveSelection(e.key === "ArrowDown" ? 1 : -1); // ↑↓移动选中标记 ●（跳过 disabled），不执行
			} else if (e.key === "Enter") {
				e.preventDefault();
				void this.choose();
			} else if (e.key === "Escape") {
				this.close();
			}
		};
		document.addEventListener("keydown", this.onKeydown, true);
	}

	private moveSelection(delta: number): void {
		let i = this.selected;
		for (;;) {
			i += delta;
			if (i < 0 || i >= this.items.length) return; // 到头即停，不回绕、不改选中
			if (!this.items[i].disabled) { this.selected = i; break; } // 跳过 disabled 行
		}
		this.refreshHighlight();
	}

	private renderList(list: HTMLElement): void {
		list.empty();
		this.items.forEach((item, i) => {
			const row = list.createDiv({ cls: `aw-action-row${i === this.selected ? " aw-selected" : ""}${item.disabled ? " aw-disabled" : ""}` }); // cursor pointer/default 走类名
			row.createSpan({ cls: "aw-sel" }); // 选中标记列：圆点 ● 由 CSS ::before 按 .aw-selected 态显示（随类切换，无需重渲染）
			row.createSpan({ text: item.marker ?? "", cls: "aw-cur aw-accent" }); // 当前项标记列：固定宽度占位（无 marker 留空），保证各行文字对齐
			row.createSpan({ text: item.label, cls: "aw-lab" });
			if (item.sub) row.createSpan({ text: item.sub, cls: "aw-dim aw-sub" });
			if (!item.disabled) {
				row.addEventListener("click", () => {
					if (this.selected === i) return; // 已选中，无需重复
					this.selected = i;
					this.refreshHighlight(); // 仅移动选中标记 ●，不执行——等用户点「确认」或按回车
				});
			}
		});
	}

	private refreshHighlight(): void {
		const rows = Array.from(this.contentEl.querySelectorAll<HTMLElement>(".aw-action-row"));
		rows.forEach((r, i) => r.classList.toggle("aw-selected", i === this.selected));
	}

	private async choose(): Promise<void> {
		if (this.submitted) return; // 防重入：回车与「确认」按钮/连点只执行一次
		const item = this.items[this.selected];
		if (!item || item.disabled) return;
		this.submitted = true;
		this.close();
		await this.onSelect(this.selected);
	}

	override onClose(): void {
		if (this.onKeydown) document.removeEventListener("keydown", this.onKeydown, true);
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 多行文本输入（场景正文/世界观历史/大纲追加等）----------

export class TextAreaPrompt extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private placeholderText: string,
		private initialValue: string,
		private submitLabel: string,
		private onSubmit: (value: string) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		let value = this.initialValue ?? "";
		const ta = this.contentEl.createEl("textarea", { cls: "aw-prompt-textarea" }); // width/min-height 走类名
		ta.placeholder = this.placeholderText;
		ta.value = this.initialValue ?? "";
		ta.focus();
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText(this.submitLabel || "保存").setCta().onClick(async () => {
				value = ta.value.trim();
				this.submitted = true;
				this.close();
				await this.onSubmit(value);
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 只读文本面板（show 类命令：世界观/伏笔列表/角色详情等）----------

export interface PanelLine {
	text: string;
	cls?: string; // "aw-dim" / "aw-accent"
	bold?: boolean;
}

/** 展示多行预格式化文本；点击任意处或 Esc 关闭 */
export class TextPanelModal extends Modal {
	constructor(app: App, private title: string, private lines: Array<string | PanelLine>) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const body = this.contentEl.createDiv({ cls: "aw-panel-body" }); // max-height/overflow-y 走 styles.css .aw-panel-body
		for (const line of this.lines) {
			const item: PanelLine = typeof line === "string" ? { text: line } : line;
			if (!item.text.trim()) {
				body.append("\n");
				continue;
			}
			const cls = [item.cls, item.bold ? "aw-bold" : ""].filter(Boolean).join(" ");
			const el = body.createEl(item.bold ? "p" : "div", { cls: cls || undefined });
			el.setText(item.text);
		}
		this.contentEl.createDiv({ text: "（Esc 或点击关闭）", cls: "aw-dim aw-hint-gap" }); // margin-top 走类名
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- 多字段表单（角色/场景等录入）----------

export interface FieldDef {
	key: string;
	label: string;
	placeholder?: string;
}

/** 多个单行文本字段的表单；提交回调收到 {key: value} */
export class MultiFieldModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private fields: FieldDef[],
		private submitLabel: string,
		private onSubmit: (values: Record<string, string>) => void | Promise<void>,
		private onCancel?: () => void,
		private initialValues?: Record<string, string>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact"); // 多字段表单统一紧凑行距（styles.css .aw-form-compact，人物属性等）
		this.contentEl.createEl("h3", { text: this.title });
		const values: Record<string, string> = {};
		for (const field of this.fields) {
			new Setting(this.contentEl).setName(field.label).addText((text) => {
				if (field.placeholder) text.setPlaceholder(field.placeholder);
				if (this.initialValues?.[field.key]) text.setValue(this.initialValues[field.key]);
				text.onChange((v) => (values[field.key] = v.trim()));
			});
		}
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText(this.submitLabel || "保存").setCta().onClick(async () => {
				this.submitted = true;
				this.close();
				await this.onSubmit(values);
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 添加人物（v0.2.0+：姓名 + 归属级别 + 设定字段 + 动态关系行）----------

/** 「添加人物」可选的归属级别（书籍级 / 某卷 / 某章）及其范围内已有角色名 */
export interface CharacterScopeOption {
	id: string; // 唯一键：book / vol:<卷id> / ch:<复合键>
	kind: "book" | "volume" | "chapter";
	label: string; // 展示名：书籍级 / 卷 · 风起 / 章 · 第二卷·第03章 初见
	volId?: string;
	chapterKey?: string;
	localCandidates: string[]; // 该级别**范围内**已有角色名（排在下拉最前，体现"在选中级别范围内选择人物"）
}

/** 一条待写入《人物关系.md》的关系（对象 + 类型） */
export interface CharacterRelationInput {
	target: string; // 关系对象角色名（空行不写入）
	type: string; // 关系类型（空=未标注）
}

export interface AddCharacterResult {
	name: string;
	scope: CharacterScopeOption;
	fields: Record<string, string>; // identity/age/gender/personality/appearance/background/abilities/notes
	relations: CharacterRelationInput[];
}

/**
 * 添加人物弹窗：单页表单——姓名 + 人物级别（书/卷/章，决定写入哪份《人物.md》）+ 设定字段 + 关系区。
 * 关系区初始为空，点「+ 添加关系」在下方新增一行（关系对象下拉 = 该级别范围内人物优先 + 全书其余人物、关系类型下拉 = 预设类型），
 * 每行可单独删除、可加多行；底部「确定」提交（姓名为空不提交）。关系条目由调用方写入同层级《人物关系.md》。
 */
export class AddCharacterModal extends Modal {
	private submitted = false;
	private name = "";
	private fields: Record<string, string> = {};
	private scopeId: string;
	private relations: CharacterRelationInput[] = [];
	private relHost!: HTMLElement;

	constructor(
		app: App,
		private scopes: CharacterScopeOption[],
		private allCandidates: string[], // 全书角色名（下拉里的补充候选，带层级标注由调用方拼进 label 传入亦可；此处仅名字）
		private relationTypes: string[],
		private onSubmit: (result: AddCharacterResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
		this.scopeId = scopes[0]?.id ?? "";
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact"); // 与 MultiFieldModal 同一紧凑行距类（styles.css .aw-form-compact）
		this.contentEl.createEl("h3", { text: "添加人物" });
		this.contentEl.createDiv({
			text: "归属级别决定人物写入哪一份《人物.md》（书籍级=书根、卷级=卷目录、章级=章节目录）；关系条目写入同层级的《人物关系.md》。",
			cls: "aw-prompt-hint",
		});
		new Setting(this.contentEl).setName("姓名（必填）").addText((t) => {
			t.setPlaceholder("角色名");
			t.inputEl.focus();
			t.onChange((v) => (this.name = v.trim()));
		});
		new Setting(this.contentEl).setName("人物级别").addDropdown((d) => {
			for (const s of this.scopes) d.addOption(s.id, s.label);
			if (this.scopeId) d.setValue(this.scopeId);
			d.onChange((v) => {
				this.scopeId = v;
				this.renderRelations(); // 换级别 → 候选顺序变化，重建关系区（已选对象尽量保留）
			});
		});
		const FIELDS: Array<[string, string, string?]> = [
			["identity", "身份"],
			["age", "年龄"],
			["gender", "性别"],
			["personality", "性格"],
			["appearance", "外貌"],
			["background", "背景"],
			["abilities", "能力/技能", "多个用「、」分隔"],
			["notes", "备注"],
		];
		for (const [key, label, ph] of FIELDS) {
			new Setting(this.contentEl).setName(label).addText((t) => {
				if (ph) t.setPlaceholder(ph);
				t.onChange((v) => (this.fields[key] = v.trim()));
			});
		}
		this.contentEl.createEl("h4", { text: "人物关系" });
		this.relHost = this.contentEl.createDiv({ cls: "aw-addchar-rels" });
		this.renderRelations();
		new Setting(this.contentEl).addButton((b) =>
			b.setButtonText("+ 添加关系").onClick(() => {
				this.relations.push({ target: "", type: "" });
				this.renderRelations();
			})
		);
		const actions = this.contentEl.createDiv({ cls: "aw-addchar-actions" });
		actions.createEl("button", { text: "确定", cls: "mod-cta" }).addEventListener("click", () => this.submit());
	}

	/** 关系行列表：对象下拉（本级别范围内人物优先，其余全书人物追加在后）+ 类型下拉 + 删除 */
	private renderRelations(): void {
		this.relHost.empty();
		if (!this.relations.length) {
			this.relHost.createDiv({ text: "还没有关系条目：点下方「+ 添加关系」新增一行。", cls: "aw-dim aw-addchar-hint" });
			return;
		}
		const local = this.scopes.find((s) => s.id === this.scopeId)?.localCandidates ?? [];
		const seen = new Set(local);
		const rest = this.allCandidates.filter((n) => !seen.has(n));
		this.relations.forEach((rel, i) => {
			const row = this.relHost.createDiv({ cls: "aw-addchar-rel" });
			row.createSpan({ text: `关系 ${String(i + 1)}`, cls: "aw-dim aw-addchar-relidx" });
			const selFrom = row.createEl("select", { cls: "dropdown aw-addchar-sel" });
			selFrom.createEl("option", { text: "选择关系对象…", value: "" });
			for (const n of local) selFrom.createEl("option", { text: n, value: n });
			for (const n of rest) selFrom.createEl("option", { text: `${n}（其它层级）`, value: n });
			if (rel.target && !seen.has(rel.target) && !rest.includes(rel.target)) selFrom.createEl("option", { text: rel.target, value: rel.target }); // 换级别后旧值不在候选里也保留，避免丢用户输入
			selFrom.value = rel.target;
			selFrom.addEventListener("change", () => { rel.target = selFrom.value; });
			const selType = row.createEl("select", { cls: "dropdown aw-addchar-sel" });
			selType.createEl("option", { text: "（未标注类型）", value: "" });
			for (const t of this.relationTypes) selType.createEl("option", { text: t, value: t });
			selType.value = rel.type;
			selType.addEventListener("change", () => { rel.type = selType.value; });
			row.createEl("button", { text: "✕", cls: "aw-addchar-relrm", attr: { "aria-label": "删除这条关系" } }).addEventListener("click", () => {
				this.relations.splice(i, 1);
				this.renderRelations();
			});
		});
	}

	private submit(): void {
		if (this.submitted) return;
		if (!this.name.trim()) {
			new Notice("请填写姓名");
			return;
		}
		const scope = this.scopes.find((s) => s.id === this.scopeId);
		if (!scope) {
			new Notice("请选择人物级别");
			return;
		}
		this.submitted = true;
		const relations = this.relations
			.map((r) => ({ target: r.target.trim(), type: r.type.trim() }))
			.filter((r) => r.target);
		this.close();
		void this.onSubmit({ name: this.name.trim(), scope, fields: this.fields, relations });
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- LLM 对话回复保存到文件 ----------

export interface SaveReplyResult {
	path: string; // vault 相对路径（无扩展名已自动补 .md）
	openAfter: boolean; // 保存后是否打开该文件
}

/** 对话回复保存到文件：输入目标路径（vault 相对；无扩展名自动补 .md，缺失父目录由调用方逐级创建）；目标已存在时红色警示且须勾选「覆盖」才可保存；可选「保存后打开文件」（默认开）。纯 UI，落盘动作由调用方回调执行 */
export class SaveReplyModal extends Modal {
	private submitted = false;
	private inputEl!: HTMLInputElement;
	private warnEl!: HTMLElement;
	private overwriteTgl!: ToggleComponent;
	private openTgl!: ToggleComponent;
	private saveBtn!: HTMLButtonElement;

	constructor(
		app: App,
		private defaultPath: string,
		private onSubmit: (result: SaveReplyResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "保存回复到文件" });
		this.contentEl.createDiv({ cls: "aw-prompt-hint", text: "输入目标文件路径（vault 相对路径，如 我的书/笔记.md）；未带扩展名自动补 .md，缺失的父目录会自动创建。" });
		this.inputEl = this.contentEl.createEl("input", { cls: "text-input aw-newdoc-input", type: "text" }); // 原生 input 保证占满整行（Setting 布局在部分主题下会右对齐缩窄）
		this.inputEl.setAttr("placeholder", "如：我的书/LLM回复.md");
		if (this.defaultPath) this.inputEl.value = this.defaultPath; // 预填默认目录前缀（光标置末尾，直接续输文件名）
		this.inputEl.focus();
		window.setTimeout(() => { const n = this.inputEl.value.length; this.inputEl.setSelectionRange(n, n); }, 0); // 光标置末尾，避免选中态误删预填内容
		this.warnEl = this.contentEl.createDiv({ cls: "aw-save-warn" });
		new Setting(this.contentEl).setName("覆盖已存在的文件").addToggle((t) => {
			this.overwriteTgl = t;
			t.setValue(false).onChange(() => this.refreshState());
		});
		new Setting(this.contentEl).setName("保存后打开文件").addToggle((t) => {
			this.openTgl = t;
			t.setValue(true);
		});
		new Setting(this.contentEl)
			.addButton((b) => {
				this.saveBtn = b.buttonEl;
				b.setCta().setButtonText("保存").onClick(() => this.submit());
			})
			.addButton((b) => b.setButtonText("取消").onClick(() => this.close()));
		this.inputEl.addEventListener("input", () => this.refreshState());
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			} else if (e.key === "Escape") {
				this.close(); // onClose 触发 onCancel
			}
		});
		this.refreshState();
	}

	/** 规范化路径：去首尾空白、去前导 /，基名无扩展名时补 .md */
	private normalizePath(): string {
		let p = this.inputEl.value.trim().replace(/^\/+/, "");
		if (!p) return "";
		const base = p.substring(p.lastIndexOf("/") + 1);
		if (!/\.[A-Za-z0-9]{1,8}$/.test(base)) p += ".md";
		return p;
	}

	/** 按当前输入刷新警示与「保存」可用性：目标已存在→红色警示且须勾选覆盖；目标是目录→报错禁用 */
	private refreshState(): void {
		const p = this.normalizePath();
		const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
		const isFile = f instanceof TFile;
		const isDir = f instanceof TFolder;
		if (isDir) this.warnEl.setText(`目标是文件夹，不能保存到它：${p}`);
		else if (isFile) this.warnEl.setText(`目标文件已存在，保存将覆盖其内容：${p}`);
		else this.warnEl.setText("");
		this.saveBtn.disabled = !p || isDir || (isFile && !this.overwriteTgl.getValue());
	}

	private submit(): void {
		const p = this.normalizePath();
		if (!p) return; // 空路径不提交，防误触
		const f = this.app.vault.getAbstractFileByPath(p);
		if (f instanceof TFolder) return;
		if (f instanceof TFile && !this.overwriteTgl.getValue()) return; // 覆盖须显式勾选
		this.submitted = true;
		this.close();
		void this.onSubmit({ path: p, openAfter: this.openTgl.getValue() });
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel(); // 未提交即关闭（Esc/点外部）视为取消
	}
}

// ---------- 确认框（删除等危险操作）----------

export class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmLabel?: string,
		private onConfirm?: () => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const p = this.contentEl.createEl("p");
		p.setText(this.message);
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(this.confirmLabel || "确认").setCta().onClick(() => this.do(true)))
			.addButton((btn) => btn.setButtonText("取消").onClick(() => this.do(false)));
	}

	private async do(ok: boolean): Promise<void> {
		this.resolved = true;
		this.close();
		if (ok && this.onConfirm) await this.onConfirm();
		else if (!ok && this.onCancel) this.onCancel();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.resolved && this.onCancel) this.onCancel();
	}
}

// ---------- LLM 流式生成预览已并入统一生成过程面板（src/gen_progress_view.ts GenProgressView 的 WritingStreamSink 流式阶段），不再使用独立 Modal。

/** 导出 AI 提示词功能点选择弹窗：checkbox 列表 + 全选/全不选按钮，提交回调返回选中标题数组（空数组视为取消） */
export class ExportPromptsSelectModal extends Modal {
	private submitted = false;
	private selected = new Set<string>();

	constructor(
		app: App,
		private features: Array<{ title: string; description?: string }>,
		private onSubmit: (selected: string[]) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "选择要导出的功能点" });
		contentEl.createDiv({ cls: "aw-prompt-hint", text: "勾选需要导出的功能点；未勾选的将跳过（AI提示词导出说明始终包含）。" });

		const btnRow = contentEl.createDiv({ cls: "aw-export-prompts-btns" });
		btnRow.createEl("button", { text: "全选" }).addEventListener("click", () => {
			this.selected = new Set(this.features.map((f) => f.title));
			this.refreshCheckboxes();
		});
		btnRow.createEl("button", { text: "全不选" }).addEventListener("click", () => {
			this.selected = new Set();
			this.refreshCheckboxes();
		});

		for (const feat of this.features) {
			const row = contentEl.createDiv({ cls: "aw-export-prompts-row" });
			const cb = row.createEl("input", { type: "checkbox", cls: "aw-export-prompts-cb" });
			cb.checked = this.selected.has(feat.title);
			// 整行可点：点击行内任意位置（含 checkbox 本身、键盘空格激活）都切换选中态；
			// preventDefault 抑制 checkbox 的原生切换，保证手动 toggle 是唯一入口（否则点 checkbox 会双切回原态）
			row.addEventListener("click", (ev) => {
				ev.preventDefault();
				cb.checked = !cb.checked;
				if (cb.checked) this.selected.add(feat.title);
				else this.selected.delete(feat.title);
			});
			const label = row.createEl("label", { cls: "aw-export-prompts-label" });
			label.setText(feat.title);
			if (feat.description) {
				const desc = row.createSpan({ cls: "aw-export-prompts-desc" });
				desc.setText(feat.description);
			}
		}

		new Setting(contentEl)
			.addButton((b) => b.setCta().setButtonText("导出选中").onClick(() => this.submit()))
			.addButton((b) => b.setButtonText("取消").onClick(() => this.close()));
	}

	private refreshCheckboxes(): void {
		const rows = Array.from(this.contentEl.querySelectorAll<HTMLDivElement>(".aw-export-prompts-row"));
		rows.forEach((row, i) => {
			const cb = row.querySelector<HTMLInputElement>(".aw-export-prompts-cb");
			if (cb) cb.checked = this.selected.has(this.features[i]?.title ?? "");
		});
	}

	private submit(): void {
		const result = [...this.selected];
		if (!result.length) return; // 空选视为取消
		this.submitted = true;
		this.close();
		void this.onSubmit(result);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 只读 Markdown 展示面板（用于无 vault 文件载体的内容，如系统级创作规范） */
export class MarkdownViewerModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private markdown: string,
	) {
		super(app);
	}

	private mdComp?: Component; // 本地 dts 中 Modal 非 Component，用独立组件承载渲染生命周期（关闭时 unload）

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.title });
		const body = contentEl.createDiv({ cls: "aw-md-viewer" });
		this.mdComp = new Component();
		this.mdComp.load();
		void MarkdownRenderer.render(this.app, this.markdown, body, "", this.mdComp);
	}

	override onClose(): void {
		this.contentEl.empty();
		this.mdComp?.unload();
		this.mdComp = undefined;
	}
}

// ---------- 时间线面板：事件编辑弹窗（v0.3.1+，v0.3.3+ 合并大事件后随时间线面板使用）----------

/** 事件编辑弹窗提交结果（各字段已去首尾空白；人物/关联已按顿号、逗号、分号拆分为非空数组；title 允许空串＝旧「纯时间点」标题保持无名）。
 * 时间点非法（parseTimelineTime 解析失败）时弹窗内联报错、不放行提交——合并后时间线节点的时间点随弹窗一起编辑，新建节点必须有合法时间点 */
export interface EventEditResult {
	timeText: string; // 时间点原始文本（如 120 / 120-06 / 120-06-15；面板侧经 parseTimelineTime 复解析收窄）
	title: string; // 事件名（标题行时间点之后的文本；空串＝无名）
	chars: string[]; // - 人物：
	done: boolean; // 完成状态（勾选＝已完成，写回 `- 完成：是`）
	event: string; // - 事件：（多行保留换行）
	desc: string; // - 描述：（多行保留换行；面板仅悬停 Tip 显示）——弹窗不再提供编辑控件，提交时原样透传 initialValues.desc（编辑保留既有描述、新增为空）
	impact: string; // - 影响：
	related: string[]; // - 关联：（其它事件名）
}

/**
 * 下拉多选控件（EventEditModal「人物」「关联」两字段共用，交互仿 AddCharacterModal 关系行下拉）：
 * 已选项各占一行（值 + ✕ 移除）；行尾「＋」下拉只列出尚未选中的候选（选后自动重渲染、候选里去重）；
 * 无可再选项时显示 emptyHint（候选本来就空、或已全部选完）。initial 中的旧值即使不在候选里也保留为已选行（不丢历史数据）。
 * 返回当前选中项 getter（保持加入顺序、去重）。
 */
const makeMultiSelect = (
	parent: HTMLElement,
	placeholder: string,
	emptyHint: string,
	options: readonly string[],
	initial: readonly string[]
): (() => string[]) => {
	const host = parent.createDiv({ cls: "aw-ev-msel" });
	const selected: string[] = [...new Set(initial)];
	const render = (): void => {
		host.empty();
		for (const v of selected) {
			const row = host.createDiv({ cls: "aw-ev-msel-row" });
			row.createSpan({ text: v, cls: "aw-ev-msel-val" });
			row.createEl("button", { text: "✕", cls: "aw-addchar-relrm", attr: { "aria-label": `移除 ${v}` } }).addEventListener("click", () => {
				selected.splice(selected.indexOf(v), 1);
				render();
			});
		}
		const remaining = options.filter((o) => !selected.includes(o));
		if (!remaining.length) {
			host.createDiv({ text: emptyHint, cls: "aw-dim aw-ev-msel-empty" });
			return;
		}
		const drop = host.createEl("select", { cls: "dropdown aw-addchar-sel" });
		drop.createEl("option", { text: placeholder, value: "" });
		for (const o of remaining) drop.createEl("option", { text: o, value: o });
		drop.addEventListener("change", () => {
			if (!drop.value) return;
			selected.push(drop.value);
			render();
		});
	};
	render();
	return () => [...selected];
};

/**
 * 时间线事件编辑弹窗（时间线面板「新增/编辑事件」共用）：事件名（可空） + 人物（下拉多选） + 已完成（勾选，完成状态） + 事件（多行） + 影响（多行） + 关联（下拉多选，其它事件名）。描述不在弹窗编辑：提交时原样透传 initialValues.desc（编辑保留既有 `- 描述：`、新增为空）。
 * initialValues 预填（编辑=节点现值；新增=空）；charOptions/relatedOptions 为人物/关联下拉候选（面板注入：人物来自三层《人物.md》，关联为既有事件名、已排除自身）。
 * 事件名允许留空（＝旧「纯时间点」标题保持无名）；关闭弹窗即放弃（onCancel）。
 */
export class EventEditModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private initialValues: Partial<EventEditResult> | undefined,
		private charOptions: readonly string[],
		private relatedOptions: readonly string[],
		private onSubmit: (result: EventEditResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact"); // 多字段表单统一紧凑行距（同 MultiFieldModal）
		this.contentEl.createEl("h3", { text: this.title });
		let timeText = "";
		let timeErr: HTMLElement | null = null;
		let title = "";
		let done = false;
		let event = "";
		let impact = "";
		new Setting(this.contentEl).setName("时间点").addText((t) => {
			t.setPlaceholder("如 120 / 120-06 / 120-06-15");
			t.setValue(this.initialValues?.timeText ?? "");
			t.onChange((v) => (timeText = v.trim()));
		});
		timeErr = this.contentEl.createDiv({ cls: "aw-ev-msel-empty" });
		timeErr.hide();
		new Setting(this.contentEl).setName("事件名").addText((t) => {
			t.setPlaceholder("事件名（可留空；写在时间点之后）");
			if (this.initialValues?.title) t.setValue(this.initialValues.title);
			t.onChange((v) => (title = v.trim()));
		});
		this.contentEl.createDiv({ text: "人物", cls: "aw-ev-msel-label" }); // 下拉多选（候选＝该书三层《人物.md》角色名）
		const getChars = makeMultiSelect(this.contentEl, "＋ 选择人物…", this.charOptions.length ? "（候选人物已全部选用）" : "（没有人物候选：先在《人物.md》中登记人物）", this.charOptions, this.initialValues?.chars ?? []);
		new Setting(this.contentEl).setName("已完成").setDesc("勾选后条目显示「✓ 已完成」徽章，文档写回 `- 完成：是`（取消勾选则不写该行）").addToggle((tg) => {
			tg.setValue(this.initialValues?.done ?? false);
			tg.onChange((v) => (done = v));
		});
		new Setting(this.contentEl).setName("事件").addTextArea((ta) => { // 多行：事件简述（面板内联显示）
			ta.setPlaceholder("事件经过简述");
			ta.setValue(this.initialValues?.event ?? "");
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows"); // 宽度复用既有多行输入类；aw-ta-rows 去掉全局 240px min-height，让 rows 生效
			ta.inputEl.rows = 5; // 事件＝5 行高
			ta.onChange((v) => (event = v));
		});
		new Setting(this.contentEl).setName("影响").addTextArea((ta) => {
			ta.setPlaceholder("事件影响 / 后果 / 代价");
			ta.setValue(this.initialValues?.impact ?? "");
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows"); // 同上：宽度复用、去 min-height
			ta.inputEl.rows = 2; // 影响＝2 行高
			ta.onChange((v) => (impact = v));
		});
		this.contentEl.createDiv({ text: "关联", cls: "aw-ev-msel-label" }); // 下拉多选（候选＝面板既有事件名，已排除自身）
		const getRelated = makeMultiSelect(this.contentEl, "＋ 选择关联事件…", this.relatedOptions.length ? "（既有事件已全部选用）" : "（暂无其它既有事件可关联）", this.relatedOptions, this.initialValues?.related ?? []);
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存").setCta().onClick(async () => {
				if (!parseTimelineTime(timeText)) { // 时间点必填且格式必须可解析（年 / 年-月 / 年-月-日）：非法则内联报错、不关闭弹窗
					timeErr.setText(`时间点无效：「${timeText || "（空）"}」无法解析，请用 120 / 120-06 / 120-06-15 这类写法`);
					timeErr.show();
					return;
				}
				this.submitted = true;
				this.close();
				await this.onSubmit({ timeText, title, chars: getChars(), done, event: event.trim(), desc: (this.initialValues?.desc ?? "").trim(), impact: impact.trim(), related: getRelated() }); // desc＝透传原值（弹窗无编辑控件），防编辑时抹掉既有描述
			})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close())); // onClose 未提交时触发 onCancel
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}
