import { App, Modal, Notice, setTooltip, SuggestModal, Setting, TFile, TFolder, ToggleComponent } from "obsidian";
import { PIPELINE_STAGES, type StageId } from "./pipeline"; // v0.3.0+：AutoBookModal 起始节点下拉（pipeline.ts 纯数据、不 import obsidian，无循环依赖）
import {
	applyCharacterMerge,
	CHARACTER_FIELDS,
	CHARACTER_MERGE_ALL,
	CHARACTER_MERGE_EMPTY,
	characterFieldValue,
	formatCharacterBlock,
	parseTimelineTime,
	SCENE_TERRAIN_COLORS,
	type CharacterMergePick,
	type CharacterMergePicks,
	type CharacterMergeSource,
} from "./md_docs"; // v0.3.3+：EventEditModal 时间点校验；v0.4.8+：SceneEditModal「地形」下拉候选；v0.4.11+：MergeCharacterModal 合并人物（md_docs 纯数据模块，无循环依赖）
import { type BookSkillPhase } from "./state_doc"; // v0.3.4+：BookSkillPhaseModal 阶段键（state_doc 纯数据模块，无循环依赖）
import { GENRE_SKILL_NAMES } from "./skills_default"; // v0.3.6+：NewStoryModal 旧四题材回落；v0.4.3+ skills_default 会派生题材/编写类型目录技能（story_types 为单向依赖）
import { INSPIRATION_SKILL_NAME, inspirationMatches, inspirationPreview, type InspirationBlock } from "./inspiration"; // v0.4.3+ 灵感工具包弹窗（inspiration.ts 纯解析/渲染、不 import obsidian，无循环依赖）

/** 逐级创建 filePath 的全部父目录（createFolder 一次只建一层；已存在跳过）——对话面板「保存到文件」与会话保存、工具落盘共用 */
export async function ensureParentFolders(app: App, filePath: string): Promise<void> {
	const parts = filePath.split("/");
	let cur = "";
	for (let i = 0; i < parts.length - 1; i++) {
		cur = cur ? `${cur}/${parts[i]}` : parts[i];
		if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
	}
}

/** v0.4.3+ 本插件弹窗统一基类：构造期给 contentEl 挂 `.aw-form` 作用域类（styles.css）——
 *  弹窗内 Setting 行标签一律左对齐、输入框/下拉框吃满标签之外的剩余整行宽度。
 *  挂在构造函数而非 onOpen：现有子类普遍覆写 onOpen 且不调用 super.onOpen()，构造期挂类对全部子类恒生效。 */
export class AwModal extends Modal {
	constructor(app: App) {
		super(app);
		this.contentEl.addClass("aw-form");
		// v0.4.11+ 弹窗根元素作用域类：styles.css 手机端「自然排布」修正（.is-phone .aw-modal）需要选中弹窗本体，
		// 而 `.aw-form` 挂在 contentEl（= .modal-content）没法向上选，故在 modalEl 另挂一类
		this.modalEl.addClass("aw-modal");
	}
}

/** 文本输入框；提交回调收到值（空串视为取消）。可选 hint：渲染在标题与输入框之间的说明文字（支持 \n 多行，样式 .aw-prompt-hint）；可选 initial：预填初始值（光标置于末尾）；
 *  multiline（v0.3.7+）：5 行 textarea 占满整行（去无标签行的定宽 info 列＋.aw-prompt-textarea 宽度 100%＋aw-ta-rows 去全局 min-height）＋右对齐「确定/取消」按钮行；回车换行、Ctrl/Cmd+回车或点「确定」提交 */
export class TextInputModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private placeholderText: string,
		private onSubmit: (value: string) => void | Promise<void>,
		private onCancel?: () => void,
		private hintText?: string,
		private initialText?: string,
		private multiline?: boolean
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		if (this.multiline) this.contentEl.addClass("aw-form-compact"); // control 改 stretch，textarea width:100% 才真正撑满整行（.aw-prompt-textarea 单用时无标签行 control 是 flex:0 auto）
		if (this.hintText) this.contentEl.createDiv({ text: this.hintText, cls: "aw-prompt-hint" }); // v0.1.6+：详细说明放输入框上方（原仅占位符提示、易被忽略）
		const commit = (el: HTMLInputElement | HTMLTextAreaElement) => {
			const value = el.value.trim();
			this.submitted = true;
			this.close();
			void this.onSubmit(value);
		};
		const caretToEnd = (el: HTMLInputElement | HTMLTextAreaElement) => {
			const n = el.value.length;
			el.setSelectionRange(n, n); // 光标置末尾，避免选中态误删预填内容
		};
		if (this.multiline) {
			let taEl: HTMLTextAreaElement | undefined; // 供下方「确定/取消」按钮行取值
			const row = new Setting(this.contentEl).addTextArea((ta) => {
				taEl = ta.inputEl;
				ta.setPlaceholder(this.placeholderText);
				if (this.initialText) ta.inputEl.value = this.initialText;
				ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows"); // 宽度复用既有多行输入类（100% 占满行宽）；aw-ta-rows 去掉全局 240px min-height，让 rows 生效
				ta.inputEl.rows = 5; // 5 行高
				ta.inputEl.focus();
				window.setTimeout(() => caretToEnd(ta.inputEl), 0); // 延到 Modal.open() 自动聚焦（会全选预填文本）之后再置光标
				ta.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						commit(ta.inputEl); // Ctrl/Cmd+回车提交
					} else if (e.key === "Escape") {
						this.close(); // onClose 触发 onCancel
					} // 多行模式裸回车＝插入换行（textarea 原生行为，不拦截）
				});
			});
			row.infoEl.remove(); // 无标签行：去掉 .aw-form-compact 定宽 6.5em 的空 info 列，textarea 才真正占满整行（否则左侧留白）
			// 显式提交/取消按钮行（同 SkillEditModal 口径）：多行裸回车是换行不能只靠键盘提交；取消走 close()→onClose→submitted=false→onCancel
			const btns = new Setting(this.contentEl)
				.addButton((btn) => btn.setButtonText("确定").setCta().onClick(() => { if (taEl) commit(taEl); }))
				.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
			btns.settingEl.addClass("aw-btns-right"); // 确定/取消成组贴右（既有类：隐藏空标签列＋control flex-end＋清 auto margin）
		} else {
			new Setting(this.contentEl).addText((text) => {
				text.setPlaceholder(this.placeholderText);
				if (this.initialText) text.inputEl.value = this.initialText; // 预填（可选；回车即按预填值提交）
				text.inputEl.focus();
				window.setTimeout(() => caretToEnd(text.inputEl), 0); // 光标置末尾，避免选中态误删预填内容（原 setTimeout 时序不变）
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit(text.inputEl);
					} else if (e.key === "Escape") {
						this.close(); // onClose 触发 onCancel
					}
				});
			});
		}
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 新建文档单弹窗（v0.1.8+）：单一视图——顶部全宽输入框（内部占位提示「自定义文件名…」），中部为该容器标准模板文档行（均可点击选中：名称回填进输入框并标记 is-selected；已存在项保留置灰样式仅作提示、同样可选中），**CTA「确定」按钮位于整个弹窗最底部**（手机端可点按确认、回车同效）。全程只弹一次窗 */
export class NewFilePickerModal extends AwModal {
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

// 建书弹窗「题材类型」下拉选项：与内置四题材技法技能（DEFAULT_SKILLS 的题材类条目）同源，剥去「写法」后缀即题材名（玄幻仙侠/科幻/历史武侠/都市现实）
const PRESET_GENRES = GENRE_SKILL_NAMES.map((n) => n.replace(/写法$/, ""));

/** 新书创建：标题 / 题材类型（四题材下拉，与 SKILLS 技法技能同源） / 编写类型（对齐 Python /new 三项询问） */
export class NewStoryModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private onSubmit: (input: NewStoryInput) => void | Promise<void>,
		private onCancel?: () => void,
		private genreOptions: string[] = PRESET_GENRES,
		private styleOptions: string[] = PRESET_STYLES
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "创建新小说" });
		this.contentEl.addClass("aw-form-compact"); // label 定宽 + 控件占满剩余空间（styles.css .aw-form-compact，同 MultiFieldModal 等）
		const genres = this.genreOptions.length ? this.genreOptions : PRESET_GENRES;
		const styles = this.styleOptions.length ? this.styleOptions : PRESET_STYLES;
		let title = "";
		let genre = genres[0]; // 默认题材目录首项（题材技能文件夹为空时回落旧四题材）
		let style = styles[0] || "网文小说";

		new Setting(this.contentEl).setName("标题").addText((text) => {
			text.setPlaceholder("书名");
			text.onChange((v) => (title = v));
			text.inputEl.focus();
		});
		new Setting(this.contentEl).setName("题材类型").addDropdown((drop) => {
			for (const g of genres) drop.addOption(g, g); // v0.4.3+：来自 SKILLS/题材/ 目录（缺失时回落旧四题材）
			drop.setValue(genre).onChange((v) => (genre = v));
		});
		new Setting(this.contentEl)
			.setName("编写类型")
			.addDropdown((drop) => {
				for (const s of styles) drop.addOption(s, s); // v0.4.3+：来自 SKILLS/编写类型/ 目录（缺失时回落旧四类型）
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

export interface StoryMetaInput {
	genre: string;
	style: string;
}

/** v0.4.3+ 修改现有小说信息：题材/编写类型下拉均来自系统技能目录（题材/、编写类型/），并保留手输自定义值。 */
export class StoryMetaModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private currentGenre: string,
		private currentStyle: string,
		private genreOptions: string[],
		private styleOptions: string[],
		private onSubmit: (input: StoryMetaInput) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "修改小说信息" });
		this.contentEl.addClass("aw-form-compact");
		const genres = this.genreOptions.slice();
		const styles = this.styleOptions.slice();
		// 当前值不在目录里（旧数据/自定义值）也要能显示：临时补进下拉，避免 setValue 丢失
		if (this.currentGenre && !genres.includes(this.currentGenre)) genres.unshift(this.currentGenre);
		if (this.currentStyle && !styles.includes(this.currentStyle)) styles.unshift(this.currentStyle);
		let genre = this.currentGenre || genres[0] || "网文小说";
		let style = this.currentStyle || styles[0] || "网文小说";

		new Setting(this.contentEl).setName("题材类型").addDropdown((drop) => {
			for (const g of genres) drop.addOption(g, g);
			drop.setValue(genre).onChange((v) => (genre = v));
		}).addText((text) => {
			text.setPlaceholder("或输入自定义题材");
			text.onChange((v) => { if (v.trim()) genre = v.trim(); });
		});
		new Setting(this.contentEl).setName("编写类型").addDropdown((drop) => {
			for (const s of styles) drop.addOption(s, s);
			drop.setValue(style).onChange((v) => (style = v));
		}).addText((text) => {
			text.setPlaceholder("或输入自定义类型名");
			text.onChange((v) => { if (v.trim()) style = v.trim(); });
		});
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存").setCta().onClick(async () => {
				this.submitted = true;
				this.close();
				await this.onSubmit({ genre: genre.trim() || "网文小说", style: style.trim() || "网文小说" });
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 各卷章数输入共用（AutoBookModal / AutoBookConfigModal）：解析＋由卷数×各卷章数推算全书总章数 */
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

/** v0.3.1+ 起始/停止节点双下拉（AutoBookModal / AutoBookConfigModal / SkillRangeModal 共用）：
 *  停止节点下拉多一项「跑到末尾」（映射 undefined＝至流水线末尾）；返回当前值读取器与区间校验（空串＝合法，停止节点不得排在起始节点之前）；
 *  onStartChange（v0.4.1+）＝起始节点变更回调，调用方据此联动其它字段的显隐（如「一句话设定」只在起跑点含「生成世界观」时显示） */
function addStageRangeSettings(contentEl: HTMLElement, init: { startAt?: StageId; endAt?: StageId }, onStartChange?: (id: StageId) => void): { startAt: () => StageId; endAt: () => StageId | undefined; error: () => string } {
	let startAt: StageId = init.startAt ?? "worldview";
	let endSel: string = init.endAt ?? "end";
	new Setting(contentEl).setName("起始节点").addDropdown((drop) => {
		for (const s of PIPELINE_STAGES) drop.addOption(s.id, s.name);
		drop.setValue(startAt).onChange((v) => { startAt = v as StageId; onStartChange?.(startAt); });
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

/** v0.4.1+ 一句话设定共用行（AutoBookModal / AutoBookConfigModal）：堆叠布局（styles.css .aw-setting-stack）——
 *  标签自占一行、textarea 自占一行且吃满弹窗宽度；6 行高、可纵向拖拽。返回行元素（供显隐）与当前值读取器 */
function addPremiseSetting(contentEl: HTMLElement, name: string, initial: string): { settingEl: HTMLElement; value: () => string } {
	let premise = initial;
	const setting = new Setting(contentEl).setName(name);
	setting.settingEl.addClass("aw-setting-stack");
	setting.addTextArea((ta) => {
		ta.setPlaceholder("例：一个能看见别人死期的少年，发现自己每次说出死期都会提前应验");
		ta.setValue(premise).onChange((v) => (premise = v));
		ta.inputEl.rows = 6;
	});
	return { settingEl: setting.settingEl, value: () => premise };
}

/** v0.4.1+ 规模参数共用组（AutoBookModal / AutoBookConfigModal）：按模式互斥显隐（aw-hide 类）——平铺＝仅「全书总章数」可编辑；
 *  分卷＝仅卷数/各卷章数，全书总章数整行隐藏、其推算值（卷数×单值或逐项求和）实时显示在各卷章数说明行。
 *  error() 返回中文校验文案（空串＝合法）；read() 在校验通过后取提交值（单值各卷章数已按卷数复制填满） */
interface ScaleControls {
	mode: () => "flat" | "volumes";
	setMode(mode: "flat" | "volumes"): void;
	error(): string;
	read(): { flatTotalChapters: number; volumeCount: number; chapterCounts: number[] };
}

function addScaleSettings(contentEl: HTMLElement, init: { mode?: "flat" | "volumes"; flatTotalChapters?: number; volumeCount?: number; chapterCounts?: number[] } = {}): ScaleControls {
	let mode: "flat" | "volumes" = init.mode ?? "volumes";
	let flatTotal = init.flatTotalChapters ?? 30;
	let volCount = init.volumeCount ?? 3;
	let countsText = (init.chapterCounts ?? []).join(", ") || "10";
	const totalSetting = new Setting(contentEl).setName("全书总章数");
	totalSetting.addText((text) => {
		text.setValue(String(flatTotal)).onChange((v) => { flatTotal = Number(v.trim()) || 0; });
	});
	const volCountSetting = new Setting(contentEl).setName("卷数").addText((text) => {
		text.setValue(String(volCount)).onChange((v) => { volCount = Number(v.trim()) || 0; syncCountsDesc(); });
	});
	const countsSetting = new Setting(contentEl).setName("各卷章数").setDesc(COUNTS_HINT);
	countsSetting.addText((text) => {
		text.setPlaceholder(COUNTS_HINT);
		text.setValue(countsText).onChange((v) => { countsText = v; syncCountsDesc(); });
	});
	const syncCountsDesc = (): void => {
		if (mode !== "volumes") return;
		const t = computedTotalChapters(volCount, parseCountsText(countsText));
		countsSetting.setDesc(t != null ? `${COUNTS_HINT}（全书总章数 = ${t}）` : COUNTS_HINT);
	};
	const applyMode = (): void => {
		if (mode === "flat") {
			totalSetting.setDesc("平铺模式：全书恰好规划这么多章");
		} else {
			totalSetting.setDesc("");
			syncCountsDesc();
		}
		totalSetting.settingEl.toggleClass("aw-hide", mode !== "flat");
		volCountSetting.settingEl.toggleClass("aw-hide", mode !== "volumes");
		countsSetting.settingEl.toggleClass("aw-hide", mode !== "volumes");
	};
	applyMode();
	return {
		mode: () => mode,
		setMode: (m) => { mode = m; applyMode(); },
		error: () => {
			if (mode === "flat") {
				return Number.isSafeInteger(flatTotal) && flatTotal >= 1 ? "" : "平铺模式：全书总章数须为正整数";
			}
			if (!(Number.isSafeInteger(volCount) && volCount >= 1)) return "分卷模式：卷数须为正整数";
			const nums = parseCountsText(countsText);
			if (nums.some((n) => !(Number.isSafeInteger(n) && n >= 1))) return "各卷章数须全为正整数";
			if (nums.length !== 1 && nums.length !== volCount) return `各卷章数须为 ${volCount} 个（或单个整数用于所有卷），收到 ${nums.length} 个`;
			return "";
		},
		read: () => {
			if (mode === "flat") return { flatTotalChapters: flatTotal, volumeCount: 0, chapterCounts: [] };
			const nums = parseCountsText(countsText);
			return { flatTotalChapters: 0, volumeCount: volCount, chapterCounts: nums.length === 1 ? Array.from({ length: volCount }, () => nums[0]) : nums };
		},
	};
}

/** v0.3.0+ 全自动写书流水线参数弹窗（v0.4.1+ 起仅「全自动写书」按书配置缺参时打开，预填已有配置，补填后顺带持久化）：
 *  起始/停止节点 / 一句话设定 / 规模参数（分卷＝卷数＋各卷章数；平铺＝总章数）/ 覆盖已有产物开关 */
export interface AutoBookInput {
	startAt: StageId;
	endAt?: StageId; // v0.3.1+ 停止节点（含）；缺省＝跑到流水线末尾
	premise: string;
	volumeCount: number; // 分卷模式：计划卷数（≥1）
	chapterCounts: number[]; // 分卷模式：各卷目标章数（长度＝volumeCount；单值输入时已复制填满）
	flatTotalChapters: number; // 平铺模式：全书总章数（≥1）
	overwrite: boolean; // true=已有世界观/策划指南/书级大纲也重新生成（覆盖）；false=已有即跳过
}

export class AutoBookModal extends AwModal {
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
		this.contentEl.createEl("h3", { text: "全自动写书 — 补填参数" });
		this.contentEl.createEl("p", { text: "从起始节点起依次执行：生成世界观 → 生成策划指南 → 生成书级大纲 → 建卷并生成卷大纲 → 生成章节大纲 → 连续编写正文；可用停止节点提前收尾。缺少前置文件会在开始前检查并拒绝启动。", cls: "aw-dim" });
		let overwrite = false;
		let errText = "";
		const errEl = this.contentEl.createDiv({ cls: "articlewriter-muted" });

		const range = addStageRangeSettings(this.contentEl, this.init, () => applyPremiseVisible());
		// 一句话设定只在起跑点含「生成世界观」时显示（worldview 是首阶段＝起始节点为 worldview 即会生成）；隐藏时不参与必填校验
		const premiseRow = addPremiseSetting(this.contentEl, "一句话设定", this.init.premise ?? "");
		const scale = addScaleSettings(this.contentEl, { mode: this.flatMode ? "flat" : "volumes", volumeCount: this.init.volumeCount, chapterCounts: this.init.chapterCounts, flatTotalChapters: this.init.flatTotalChapters });
		const applyPremiseVisible = (): void => premiseRow.settingEl.toggleClass("aw-hide", range.startAt() !== "worldview");
		applyPremiseVisible();
		new Setting(this.contentEl).setName("覆盖已有产物").setDesc("开启：世界观/策划指南/书级大纲即使已有内容也重新生成；关闭：已有即跳过该阶段").addToggle((t) => {
			t.setValue(overwrite).onChange((v) => (overwrite = v));
		});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("开始").setCta().onClick(async () => {
				const rangeErr = range.error();
				if (rangeErr) { errText = rangeErr; errEl.setText(errText); return; }
				const premise = premiseRow.value();
				if (!premise.trim() && range.startAt() === "worldview") { errText = "起始节点为「生成世界观」时必须填写一句话设定"; errEl.setText(errText); return; }
				const scaleErr = scale.error();
				if (scaleErr) { errText = scaleErr; errEl.setText(errText); return; }
				this.submitted = true;
				this.close();
				const sc = scale.read();
				await this.onSubmit({
					startAt: range.startAt(),
					endAt: range.endAt(),
					premise: premise.trim(),
					volumeCount: sc.volumeCount,
					chapterCounts: sc.chapterCounts,
					flatTotalChapters: sc.flatTotalChapters,
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

/** v0.4.1+ 「配置全自动建书」弹窗输入（写回《故事状态.md》：auto_book＋use_volumes＋one_line）。
 *  与 AutoBookInput 兼容（补填路径直接 { ...input, mode } 透传复用），多一个 mode 字段 */
export interface AutoBookConfigInput {
	startAt: StageId;
	endAt?: StageId; // 停止节点（含）；「跑到末尾」＝不写 end 键
	premise: string; // 一句话设定（空＝保持 one_line 不动）
	mode: "flat" | "volumes"; // 写回 use_volumes
	flatTotalChapters: number;
	volumeCount: number;
	chapterCounts: number[]; // 长度 1 时已按卷数复制填满
	overwrite: boolean;
}

/** v0.4.1+ 「配置全自动建书」弹窗：预填当前书《故事状态.md》里的 auto_book＋use_volumes＋one_line，
 *  保存即整体写回（见 main.ts saveAutoBookConfig）。规模模式可切换（决定写回的 use_volumes 与生效的规模参数组）；
 *  一句话设定允许留空（＝不改动 one_line），保存不校验 premise；参数校验与 AutoBookModal 同一套规则 */
export class AutoBookConfigModal extends AwModal {
	constructor(
		app: App,
		private init: {
			flatMode: boolean; // 当前书籍模式（use_volumes===false）
			premise?: string; // 预填 state.one_line
			startAt?: StageId;
			endAt?: StageId;
			volumeCount?: number;
			chapterCounts?: number[];
			flatTotalChapters?: number;
			overwrite?: boolean;
		},
		private onSubmit: (input: AutoBookConfigInput) => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "配置全自动建书 — 当前书" });
		this.contentEl.createEl("p", {
			text: "配置保存在《故事状态.md》的 auto_book 块（规模模式写 use_volumes、一句话设定写 one_line）。之后运行「全自动写书」——参数齐全即弹范围确认后免交互跑流水线，缺参会弹窗补填。",
			cls: "aw-dim",
		});
		let overwrite = this.init.overwrite ?? false;
		let errText = "";
		const errEl = this.contentEl.createDiv({ cls: "articlewriter-muted" });

		const range = addStageRangeSettings(this.contentEl, this.init, () => applyPremiseVisible());
		// 一句话设定只在起跑点含「生成世界观」时显示（worldview 是首阶段＝起始节点为 worldview 即会生成）；隐藏时不参与保存
		const premiseRow = addPremiseSetting(this.contentEl, "一句话设定（写入 one_line）", this.init.premise ?? "");
		const scale = addScaleSettings(this.contentEl, {
			mode: this.init.flatMode ? "flat" : "volumes",
			flatTotalChapters: this.init.flatTotalChapters,
			volumeCount: this.init.volumeCount,
			chapterCounts: this.init.chapterCounts,
		});
		const applyPremiseVisible = (): void => premiseRow.settingEl.toggleClass("aw-hide", range.startAt() !== "worldview");
		applyPremiseVisible();
		new Setting(this.contentEl).setName("规模模式").setDesc("决定写回《故事状态.md》的 use_volumes，并决定全书按平铺还是分卷组织").addDropdown((drop) => {
			drop.addOption("flat", "平铺（无卷）");
			drop.addOption("volumes", "分卷");
			drop.setValue(this.init.flatMode ? "flat" : "volumes").onChange((v) => scale.setMode(v as "flat" | "volumes"));
		});
		new Setting(this.contentEl).setName("覆盖已有产物").setDesc("开启：世界观/策划指南/书级大纲即使已有内容也重新生成；关闭：已有即跳过该阶段").addToggle((t) => {
			t.setValue(overwrite).onChange((v) => (overwrite = v));
		});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存配置").setCta().onClick(async () => {
				const rangeErr = range.error();
				if (rangeErr) { errText = rangeErr; errEl.setText(errText); return; }
				const scaleErr = scale.error();
				if (scaleErr) { errText = scaleErr; errEl.setText(errText); return; }
				const sc = scale.read();
				await this.onSubmit({
					startAt: range.startAt(),
					endAt: range.endAt(),
					premise: premiseRow.value().trim(),
					mode: scale.mode(),
					flatTotalChapters: sc.flatTotalChapters,
					volumeCount: sc.volumeCount,
					chapterCounts: sc.chapterCounts,
					overwrite,
				});
				this.close();
			})
		);
	}
}

/** v0.3.1+（v0.4.1+ 起用于「全自动写书」）执行范围确认弹窗（按书配置参数齐全时弹出）：预填 auto_book 里的 start/end 节点，
 *  允许临时调整起始/停止节点后再开跑；确认即回调 (startAt, endAt)，取消＝不执行 */
export class SkillRangeModal extends AwModal {
	constructor(
		app: App,
		private bookTitle: string,
		private init: { startAt?: StageId; endAt?: StageId },
		private onSubmit: (startAt: StageId, endAt?: StageId) => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: `全自动写书 — ${this.bookTitle}` });
		this.contentEl.createEl("p", { text: "书籍配置参数已齐全。确认或调整执行范围后开始；停止节点也会执行，「跑到末尾」＝一直执行到「连续编写正文」。", cls: "aw-dim" });
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
export class VolumeBatchCreateModal extends AwModal {
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

/** v0.4.7+ 对话历史选择器（LLM 面板「重新加载对话」）：列表项由调用方组好（label＝文件名＋轮数、sub＝字数＋首句摘要），
 *  选中即回传该文件的 vault 路径；取消/Esc＝调 onCancel（调用方可用来恢复状态行）。 */
export interface SessionPickerItem {
	path: string;
	label: string;
	sub: string;
}

export class SessionPickerModal extends SuggestModal<SessionPickerItem> {
	private submitted = false;

	constructor(app: App, private items: SessionPickerItem[], private onPick: (path: string) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
		this.inputEl.placeholder = "选择要载入的对话历史（选中＝它的内容成为《当前对话.md》，当前内容转为历史归档）…";
	}

	getSuggestions(query: string): SessionPickerItem[] {
		const q = query.trim().toLowerCase();
		if (!q) return this.items;
		return this.items.filter((it) => `${it.label} ${it.sub}`.toLowerCase().includes(q));
	}

	renderSuggestion(it: SessionPickerItem, el: HTMLElement): void {
		el.createDiv({ cls: "aw-session-pick-label", text: it.label });
		if (it.sub) el.createDiv({ cls: "aw-session-pick-sub", text: it.sub });
	}

	onChooseSuggestion(it: SessionPickerItem): void {
		this.submitted = true;
		this.close();
		void this.onPick(it.path);
	}

	override onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** vault Markdown 文档选择器（引用文档配置框「添加 vault 文档」）：模糊搜索 vault 内全部 .md，选中即直接添加，无需手输路径 */
export class VaultFilePickerModal extends SuggestModal<TFile> {
	constructor(app: App, private onPick: (path: string) => void) {
		super(app);
		this.inputEl.placeholder = "选择 vault 内的 Markdown 文档（按路径模糊搜索）…";
		this.limit = Number.MAX_SAFE_INTEGER; // v0.4.3+ 放开显示上限（父类默认只显前 100 条）：候选显示全部匹配文档
	}

	getSuggestions(query: string): TFile[] {
		const all = this.app.vault.getMarkdownFiles();
		const q = query.trim().toLowerCase();
		const hit = q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
		return hit.sort((a, b) => a.path.localeCompare(b.path)); // v0.4.3+ 不再截断（此前只列前 200）
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
	constructor(app: App, private names: string[], private onPick: (name: string) => void, placeholder = "选择技能（SKILLS/ 下，含文件夹，按名称模糊搜索）…") {
		super(app);
		this.inputEl.placeholder = placeholder;
		this.limit = Number.MAX_SAFE_INTEGER; // v0.4.3+ 放开显示上限（同 VaultFilePickerModal）
	}

	getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		return this.names.filter((n) => !q || n.toLowerCase().includes(q)); // v0.4.3+ 不再截断（此前只列前 200）
	}

	/** v0.4.3+：按 SKILLS/ 文件夹层次显示——`题材/玄幻仙侠` 渲染为灰色「题材 / 」+「玄幻仙侠」 */
	renderSuggestion(name: string, el: HTMLElement): void {
		const slash = name.lastIndexOf("/");
		if (slash < 0) {
			el.setText(name);
			return;
		}
		el.createSpan({ cls: "aw-skill-dir", text: `${name.slice(0, slash)} / ` });
		el.createSpan({ text: name.slice(slash + 1) });
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
export class ActionMenuModal extends AwModal {
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

export class TextAreaPrompt extends AwModal {
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
export class TextPanelModal extends AwModal {
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
export class MultiFieldModal extends AwModal {
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
	/** v0.4.11+ 该级别《人物.md》的实际物理路径（老格式回退名也已解析）＝「合并人物信息」按文档选存储位置用；解析不到＝undefined */
	path?: string;
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
export class AddCharacterModal extends AwModal {
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
		private defaultScopeId: string | undefined, // v0.4.9+ 用户要求＝级别下拉按「书籍级 → 卷级 → 章级」分组排列（默认项**不再顶到最前**），默认选中的那一级由调用方指定＝当前写作位置
		private onSubmit: (result: AddCharacterResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
		this.scopeId = defaultScopeId && scopes.some((s) => s.id === defaultScopeId) ? defaultScopeId : scopes[0]?.id ?? "";
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact"); // 与 MultiFieldModal 同一紧凑行距类（styles.css .aw-form-compact）
		this.contentEl.createEl("h3", { text: "添加人物" });
		this.contentEl.createDiv({
			text: "「人物级别」决定人物写入哪一份《人物.md》（下拉里已写出目标文档）；关系条目写入同一层级的《人物关系.md》。",
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

/** 人物关系表单提交结果（v0.4.11+）：新增与编辑共用；`scope`＝写入哪一层《人物关系.md》 */
export interface RelationshipFormResult {
	a: string; // 角色1（关系主体）
	b: string; // 角色2（关系对象）
	type: string; // 关系类型（空＝未标注）
	status: string; // 关系状态原文（空＝未标注；进行中／铺垫中／已结束均可被面板识别）
	desc: string; // 关系描述（多行原文）
	scope: CharacterScopeOption; // 写入哪一层《人物关系.md》
}

/** 旧名保留兼容（main.ts 既有 import） */
export type AddRelationshipResult = RelationshipFormResult;

/** 编辑态预填值（新增时只给 a＝选中人物作角色1，其余空） */
export interface RelationshipFormInitial {
	a: string;
	b: string;
	type: string;
	status: string;
	desc: string;
	scope?: CharacterScopeOption; // 有值＝编辑态（级别行只读）
}

/**
 * 人物关系表单弹窗（v0.4.11+）：人物关系面板头部「＋ 关系」＝新增；图视图双击连线＝编辑（同一份表单，代码重用）。
 * 级别（书/卷/章，决定写入哪份《人物关系.md》；编辑态只读）＋两个人物（可下拉选全书已登记角色，也允许手填未登记名字）
 * ＋类型／状态下拉＋描述；写盘由 main.ts 分别走 manager.appendRelationships / md_docs.updateRelationshipBlock。
 */
export class RelationshipModal extends AwModal {
	private submitted = false;
	private a: string;
	private b: string;
	private type: string;
	private status: string;
	private desc: string;
	private scopeId: string;

	constructor(
		app: App,
		private scopes: CharacterScopeOption[],
		private allCandidates: string[],
		private relationTypes: string[],
		private defaultScopeId: string | undefined,
		private initial: RelationshipFormInitial | undefined,
		private editMode: boolean,
		private onSubmit: (result: RelationshipFormResult) => void | Promise<void>,
		private onCancel?: () => void,
	) {
		super(app);
		this.a = initial?.a ?? "";
		this.b = initial?.b ?? "";
		this.type = initial?.type ?? "";
		this.status = initial?.status ?? "";
		this.desc = initial?.desc ?? "";
		const wanted = initial?.scope?.id ?? defaultScopeId;
		this.scopeId = wanted && scopes.some((s) => s.id === wanted) ? wanted : scopes[0]?.id ?? "";
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact");
		this.contentEl.createEl("h3", { text: this.editMode ? "编辑人物关系" : "添加人物关系" });
		this.contentEl.createDiv({
			text: this.editMode
				? "修改这条关系的类型、状态与描述；人物级别不可改（要换文档请去对应《人物关系.md》里挪块）。"
				: "关系条目写入所选层级的《人物关系.md》；两个人物可从下拉选已登记角色，也可手填未登记的名字。",
			cls: "aw-prompt-hint",
		});
		new Setting(this.contentEl).setName("关系级别").addDropdown((d) => {
			if (this.editMode && this.initial?.scope) {
				d.addOption(this.scopeId, this.initial.scope.label);
				d.setValue(this.scopeId);
				d.setDisabled(true);
			} else {
				for (const sc of this.scopes) d.addOption(sc.id, sc.label);
				if (this.scopeId) d.setValue(this.scopeId);
				d.onChange((v) => (this.scopeId = v));
			}
		});
		const dlA = this.contentEl.createEl("datalist", { attr: { id: "aw-rel-a-options" } });
		const dlB = this.contentEl.createEl("datalist", { attr: { id: "aw-rel-b-options" } });
		for (const n of this.allCandidates) {
			dlA.createEl("option", { attr: { value: n } });
			dlB.createEl("option", { attr: { value: n } });
		}
		new Setting(this.contentEl).setName("角色1（必填）").addText((t) => {
			t.setPlaceholder("关系主体，如 林川");
			t.setValue(this.a);
			t.inputEl.setAttribute("list", "aw-rel-a-options");
			t.onChange((v) => (this.a = v.trim()));
		});
		new Setting(this.contentEl).setName("角色2（必填）").addText((t) => {
			t.setPlaceholder("关系对象，如 苏晚");
			t.setValue(this.b);
			t.inputEl.setAttribute("list", "aw-rel-b-options");
			t.onChange((v) => (this.b = v.trim()));
		});
		new Setting(this.contentEl).setName("关系类型").addDropdown((d) => {
			d.addOption("", "（未标注）");
			for (const t of this.relationTypes) d.addOption(t, t);
			d.setValue(this.type);
			d.onChange((v) => (this.type = v));
		});
		new Setting(this.contentEl).setName("关系状态").addDropdown((d) => {
			for (const [v, label] of [["", "未标注"], ["进行中", "进行中（active）"], ["铺垫中", "铺垫中（pending）"], ["已结束", "已结束（ended）"]] as const) d.addOption(v, label);
			d.setValue(this.status);
			d.onChange((v) => (this.status = v));
		});
		new Setting(this.contentEl).setName("描述").addTextArea((ta) => {
			ta.setPlaceholder("这段关系是怎么来的、目前如何（可留空）");
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows");
			ta.inputEl.rows = 4;
			ta.setValue(this.desc);
			ta.onChange((v) => (this.desc = v));
		});
		const actions = this.contentEl.createDiv({ cls: "aw-addchar-actions" });
		actions.createEl("button", { text: "确定", cls: "mod-cta" }).addEventListener("click", () => this.submit());
		actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
	}

	private submit(): void {
		if (this.submitted) return;
		if (!this.a || !this.b) { new Notice("请填写两个人物名"); return; }
		if (this.a === this.b) { new Notice("角色1 与角色2 不能是同一个人"); return; }
		const scope = this.scopes.find((sc) => sc.id === this.scopeId) ?? this.initial?.scope;
		if (!scope) { new Notice("请选择关系级别"); return; }
		this.submitted = true;
		this.close();
		void this.onSubmit({ a: this.a, b: this.b, type: this.type.trim(), status: this.status, desc: this.desc.trim(), scope });
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

export const AddRelationshipModal = RelationshipModal; // 旧名兼容（新增入口）
/**
 * 人物编辑弹窗（v0.4.9+ 人物关系面板「编辑人物」）：级别（写进哪一份《人物.md》＝可换层，`manager.updateCharacter` 负责搬条目）
 * ＋ 姓名（改名＝调用方走 `manager.renameCharacter` 全书同步替换＋自动备份）＋ 设定字段（身份/年龄/性别/性格/外貌/背景/能力/备注）。
 * 与 `AddCharacterModal` 的区别＝不编辑关系条目（关系在《人物关系.md》里由分析/命令维护，面板上双击连线可打开）。
 */
export interface CharacterEditResult {
	name: string; // 人物名（＝《人物.md》条目键）；改了＝调用方 renameCharacter 全书同步替换
	fields: Record<string, string>; // identity/age/gender/personality/appearance/background/abilities/notes
	scopeId?: string; // 有级别下拉才带回＝要写到哪一份《人物.md》（＝`CharacterScopeOption.id`）；undefined＝不换层
}

/**
 * `level` 与 `SceneEditModal` 同型（名字不叫 `scope`＝基类 `Modal` 已有公开 `scope`）：
 * `options`＋`value`＝弹窗最上方「级别」下拉（选项文案＝`书籍级 · 案头资料/人物.md` 一类，按书籍级 → 卷级 → 章级排，value＝选中的 `CharacterScopeOption.id`）；
 * 只给 `label`＝只读行（＝拿不到级别候选时，这一行只显示该人物现在在哪份文档）。**这一行不放说明文字**（用户既定偏好）。
 */
export class CharacterEditModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private currentName: string,
		private initialFields: Record<string, string>,
		private level: { options?: readonly { value: string; label: string }[]; value?: string; label?: string } | undefined,
		private onSubmit: (result: CharacterEditResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact");
		this.contentEl.createEl("h3", { text: this.title });
		const scopeOptions = this.level?.options ?? [];
		let scopeChoice = this.level?.value ?? scopeOptions[0]?.value ?? "";
		if (scopeOptions.length) {
			new Setting(this.contentEl)
				.setName("级别")
				.addDropdown((d) => {
					for (const o of scopeOptions) d.addOption(o.value, o.label);
					d.setValue(scopeChoice);
					d.onChange((v) => (scopeChoice = v));
				});
		} else if (this.level?.label) {
			const here = this.level.label;
			new Setting(this.contentEl).setName("级别").addDropdown((d) => {
				d.addOption("here", here);
				d.setValue("here");
				d.setDisabled(true);
			});
		}
		let name = this.currentName;
		let nameErr: HTMLElement | null = null;
		new Setting(this.contentEl).setName("姓名").addText((t) => {
			t.setValue(this.currentName);
			t.onChange((v) => (name = v.trim()));
		});
		nameErr = this.contentEl.createDiv({ cls: "aw-ev-msel-empty" }); // 姓名的内联报错＝紧跟姓名那一行
		nameErr.hide();
		const fields: Record<string, string> = {};
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
				t.setValue(this.initialFields[key] ?? ""); // 预填现值（setValue 不触发 onChange＝同 EventEditModal 坑位）
				t.onChange((v) => (fields[key] = v.trim()));
			});
		}
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText("保存")
				.setCta()
				.onClick(() => {
					if (!name || /[\\/:*?"<>|]/.test(name)) {
						nameErr?.setText(name ? `姓名无效：「${name}」不能包含 \\ / : * ? " < > |` : "姓名不能为空");
						nameErr?.show();
						return;
					}
					this.submitted = true;
					this.close();
					void this.onSubmit({ name, fields, scopeId: scopeOptions.length ? scopeChoice : undefined });
				})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
		btns.settingEl.addClass("aw-btns-right");
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 合并人物信息（v0.4.11+）----------

/** 「最终存储文档」候选（value＝该层《人物.md》的 vault 相对路径；registered＝该文档此刻已有这个人物的登记） */
export interface MergeCharacterTargetOption {
	value: string;
	label: string;
	registered: boolean;
}

/** 合并结果＝用户选定的存储文档＋逐字段取值口径（落盘由调用方走 `manager.mergeCharacter`） */
export interface MergeCharacterResult {
	targetPath: string;
	picks: CharacterMergePicks;
}

/**
 * 「合并人物信息」弹窗：同名人物在多份《人物.md》里各有一条登记时，选**最终存储文档**＋逐字段决定取哪一份的值
 * （候选＝各份登记的非空值 / 全部保留（拼接） / 留空），下方实时预览合并后的条目块。
 * 纯 UI：不读不写 Vault，落盘、备份、面板刷新全在 main.ts。
 */
export class MergeCharacterModal extends AwModal {
	private submitted = false;
	private picks: CharacterMergePicks = {};
	private targetPath = "";
	private previewEl!: HTMLElement;

	constructor(
		app: App,
		private charName: string,
		private sources: readonly CharacterMergeSource[],
		private targets: readonly MergeCharacterTargetOption[],
		defaultTarget: string,
		private onSubmit: (result: MergeCharacterResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
		this.targetPath = targets.some((t) => t.value === defaultTarget) ? defaultTarget : targets[0]?.value ?? "";
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact");
		this.contentEl.createEl("h3", { text: `合并人物「${this.charName}」（${String(this.sources.length)} 份登记）` });
		this.contentEl.createDiv({
			cls: "aw-prompt-hint",
			text: "同一人物在多份《人物.md》里各有一条登记。先选**最终存储文档**，再逐字段决定保留哪一份的值（或全部保留、留空）；"
				+ "合并后其余文档里的这条会被删除，改动的文档先备份到 _backup/人物合并_时间戳/。",
		});
		new Setting(this.contentEl)
			.setName("最终存储文档")
			.setDesc("合并后的条目写进这一份《人物.md》")
			.addDropdown((d) => {
				for (const t of this.targets) d.addOption(t.value, t.registered ? `${t.label}（此处已有登记）` : `${t.label}（新登记）`);
				d.setValue(this.targetPath);
				d.onChange((v) => {
					this.targetPath = v;
					this.refreshPreview();
				});
			});
		for (const { key, label } of CHARACTER_FIELDS) {
			const filled = this.sources.map((s, i) => ({ i, v: characterFieldValue(s.char, key) })).filter((x) => x.v !== "");
			if (!filled.length) {
				new Setting(this.contentEl).setName(label).setDesc("各处登记都是空");
				continue;
			}
			const opts: Array<{ value: string; label: string }> = filled.map((f) => ({
				value: `s${String(f.i)}`,
				label: `${this.sources[f.i].label}：${f.v.length > 30 ? `${f.v.slice(0, 30)}…` : f.v}`,
			}));
			if (filled.length > 1) opts.push({ value: CHARACTER_MERGE_ALL, label: "全部保留（按登记顺序拼接、去重）" });
			opts.push({ value: CHARACTER_MERGE_EMPTY, label: "留空（不写这个字段）" });
			const targetIdx = this.sources.findIndex((s) => s.path === this.targetPath);
			const prefer = filled.find((f) => f.i === targetIdx) ?? filled.find((f) => f.v.length > 0);
			const initial = key === "abilities" && filled.length > 1 ? CHARACTER_MERGE_ALL : filled.some((f) => f.i === (prefer?.i ?? -1)) ? `s${String(prefer?.i)}` : `s${String(filled[0].i)}`;
			this.picks[key] = decodeMergePick(initial);
			new Setting(this.contentEl).setName(label).addDropdown((d) => {
				for (const o of opts) d.addOption(o.value, o.label);
				d.setValue(initial);
				d.onChange((v) => {
					this.picks[key] = decodeMergePick(v);
					this.refreshPreview();
				});
			});
		}
		this.previewEl = this.contentEl.createDiv({ cls: "aw-merge-preview" });
		this.refreshPreview();
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText("合并")
				.setCta()
				.onClick(() => {
					if (!this.targetPath) {
						new Notice("请先选择最终存储文档", 6000);
						return;
					}
					this.submitted = true;
					this.close();
					void this.onSubmit({ targetPath: this.targetPath, picks: this.picks });
				})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
		btns.settingEl.addClass("aw-btns-right");
	}

	/** 预览＝按当前口径拼出的条目块（＝落盘时 `formatCharacterBlock` 写进目标文档的内容，一字不差） */
	private refreshPreview(): void {
		const merged = applyCharacterMerge(this.charName, this.sources, this.picks);
		this.previewEl.setText(`合并结果：\n${formatCharacterBlock(merged)}`);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 下拉值 → 取值口径：`s3`＝取第 4 份登记，其余原样（`__all__`／`__empty__`） */
function decodeMergePick(v: string): CharacterMergePick {
	const m = /^s(\d+)$/.exec(v);
	return m ? Number(m[1]) : v === CHARACTER_MERGE_ALL ? CHARACTER_MERGE_ALL : CHARACTER_MERGE_EMPTY;
}

// ---------- LLM 对话回复保存到文件 ----------

export interface SaveReplyResult {
	path: string; // vault 相对路径（无扩展名已自动补 .md）
	openAfter: boolean; // 保存后是否打开该文件
}

/** 对话回复保存到文件：输入目标路径（vault 相对；无扩展名自动补 .md，缺失父目录由调用方逐级创建）；目标已存在时红色警示且须勾选「覆盖」才可保存；可选「保存后打开文件」（默认开）。纯 UI，落盘动作由调用方回调执行 */
export class SaveReplyModal extends AwModal {
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

export class ConfirmModal extends AwModal {
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

/** v0.4.6+ 修 C6：「修复章节编号引用」落盘前预览确认弹窗——逐章列出「原句 → 改写句」对照（可滚动、长句截断展示），
 *  确认后调用方才批量 setChapterBody；取消/Esc ＝全部不落盘。取代旧「LLM 改写正文但零预览直接覆盖」的行为。 */
export class FixRefsReviewModal extends AwModal {
	private resolved = false;

	constructor(
		app: App,
		private title: string,
		private summary: string,
		private chapters: Array<{ label: string; pairs: Array<{ from: string; to: string }> }>,
		private onConfirm?: () => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		this.contentEl.createEl("p", { text: this.summary, cls: "aw-dim" });
		const box = this.contentEl.createDiv({ cls: "aw-fixrefs-review" }); // styles.css：max-height 滚动区
		for (const ch of this.chapters) {
			box.createEl("h4", { text: ch.label });
			for (const pair of ch.pairs) {
				const cut = (s: string) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);
				box.createDiv({ cls: "aw-fixrefs-pair" }).appendText(`原：${cut(pair.from)}`);
				box.createDiv({ cls: "aw-fixrefs-pair aw-fixrefs-pair-new" }).appendText(`新：${cut(pair.to)}`);
			}
		}
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(`确认保存（${String(this.chapters.length)} 章）`).setCta().onClick(() => void this.do(true)))
			.addButton((btn) => btn.setButtonText("取消（全部不落盘）").onClick(() => void this.do(false)));
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

/** 导出 AI 提示词功能点选择弹窗：checkbox 列表 + 全选/全不选按钮，提交回调返回选中标题数组（空数组视为取消） */
export class ExportPromptsSelectModal extends AwModal {
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

// ---------- 时间线面板：事件编辑弹窗（v0.3.1+，v0.3.3+ 合并大事件后随时间线面板使用）----------

/** 事件编辑弹窗提交结果（各字段已去首尾空白；人物/关联已按顿号、逗号、分号拆分为非空数组；title 允许空串＝旧「纯时间点」标题保持无名）。
 * 时间点非法（parseTimelineTime 解析失败）时弹窗内联报错、不放行提交——合并后时间线节点的时间点随弹窗一起编辑，新建节点必须有合法时间点 */
export interface EventEditResult {
	timeText: string; // 时间点原始文本（如 120 / 120-06 / 120-06-15；面板侧经 parseTimelineTime 复解析收窄）
	title: string; // 事件名（标题行时间点之后的文本；空串＝无名）
	chars: string[]; // - 人物：
	done: boolean; // 完成状态（勾选＝已完成，写回 `- 完成：是`）
	desc: string; // - 详情：（v0.4.11+ 唯一正文内容字段；旧 `- 事件：`／`- 描述：` 兼容解析、写回统一出 详情。多行保留换行；面板内联显示＋悬停 Tip；弹窗内可编辑）
	impact: string; // - 影响：
	related: string[]; // - 关联：（其它事件名）
	scope?: string; // v0.4.9+ 「级别」下拉所选的**目标文档路径**（＝新建事件写进哪一份《时间线.md》；只读级别行不带回＝调用方沿用原口径）。名称用 scope 而非 level＝弹窗里 level 另指标题深度
}

/**
 * 下拉多选控件（EventEditModal「人物」「关联」两字段共用，交互仿 AddCharacterModal 关系行下拉）：
 * v0.4.7+ 已选项排成胶囊 chip、**人多自动换行**（每个 chip 右上角小 ✕ 移除；换行留行距防 ✕ 互压），「＋」补选下拉**单独下一行**；
 * 下拉只列出尚未选中的候选（选后自动重渲染、候选里去重）；
 * 无可再选项时显示 emptyHint（传空串＝不显示占位提示）。initial 中的旧值即使不在候选里也保留为已选胶囊（不丢历史数据）。
 * 返回 `{ get, render }`：get＝当前选中项（保持加入顺序、去重）；render＝重画（外部按 tab 切换等场景复用同一节点重渲染）。
 */
/** v0.4.8+ 多选候选分组（下拉里按组渲染 `<optgroup>`＝树状分类，如「事件按所在《时间线.md》文件分组」）；group 空串＝不分组平铺 */
export interface MultiSelGroup {
	group: string;
	items: readonly string[];
}

const makeMultiSelect = (
	parent: HTMLElement,
	placeholder: string,
	emptyHint: string,
	options: readonly (string | MultiSelGroup)[], // v0.4.8+ 候选＝纯字符串（平铺）或分组对象（下拉里按 `<optgroup>` 分类）；元素级联合＝调用方两种数组都能直接传，`typeof` 逐元素窄化
	initial: readonly string[],
	host?: HTMLElement // 可传入现成宿主节点（不传＝在 parent 内新建并挂载）。外部游离宿主（tab 切换摘下/挂回）须显式调 render() 重画
): { get: () => string[]; render: () => void } => {
	const el = host ?? parent.createDiv({ cls: "aw-ev-msel" });
	const selected: string[] = [...new Set(initial)];
	const groups: MultiSelGroup[] = (() => { // 归一化成分组表：纯字符串候选合成一组（group＝空串＝平铺不渲染表头），分组对象原样入表
		const strs: string[] = [];
		const gs: MultiSelGroup[] = [];
		for (const o of options) {
			if (typeof o === "string") strs.push(o);
			else gs.push({ group: o.group, items: [...o.items] });
		}
		return strs.length ? [{ group: "", items: strs }, ...gs] : gs;
	})();
	const grouped = groups.length > 1 || (groups[0]?.group ?? "") !== "";
	const render = (): void => {
		el.empty();
		if (selected.length) { // v0.4.7+（二次调整）：已选胶囊独占一行（横滚动），补选下拉单独下一行；胶囊容器顶部留白防右上角 ✕ 被滚动容器裁掉
			const chips = el.createDiv({ cls: "aw-ev-msel-chips" });
			for (const v of selected) {
				const chip = chips.createSpan({ cls: "aw-ev-msel-chip" });
				chip.title = v; // 长名截断后悬停可看全名
				chip.createSpan({ text: v, cls: "aw-ev-msel-val" });
				chip.createEl("button", { text: "✕", cls: "aw-addchar-relrm aw-ev-msel-chipx", attr: { "aria-label": `移除 ${v}` } }).addEventListener("click", () => {
					selected.splice(selected.indexOf(v), 1);
					render();
				});
			}
		}
		const remGroups = groups.map((g) => ({ group: g.group, items: g.items.filter((o) => !selected.includes(o)) }));
		if (!remGroups.some((g) => g.items.length)) {
			if (emptyHint) el.createDiv({ text: emptyHint, cls: "aw-dim aw-ev-msel-empty" }); // 传空串＝全部选完后不显示任何占位提示
			return;
		}
		const drop = el.createEl("select", { cls: "dropdown aw-addchar-sel" });
		drop.createEl("option", { text: placeholder, value: "" });
		for (const g of remGroups) {
			if (!g.items.length) continue;
			if (!grouped) {
				for (const o of g.items) drop.createEl("option", { text: o, value: o });
				continue;
			}
			const og = drop.createEl("optgroup"); // DomElementInfo 无 label 字段（obsidian 类型）＝建好再设
			og.label = g.group; // 组名＝分组表头（不可选、只作分类）
			for (const o of g.items) og.createEl("option", { text: o, value: o });
		}
		drop.addEventListener("change", () => {
			if (!drop.value) return;
			selected.push(drop.value);
			render();
		});
	};
	render();
	return { get: () => [...selected], render };
};

/**
 * 行式下拉多选（v0.4.8+ 用户要求）：标签与上方 Setting 字段同一行式布局（左标签列 6.5em 对齐、
 * 控件区吃满剩余宽度），取代旧「标签独占一行 + makeMultiSelect 整行」写法。
 * 用法＝传入已建好的 Setting 行：makeMultiSelect 宿主挂进 setting.controlEl，行加 aw-ev-msel-row 类供 CSS 撑开控件列。
 */
const makeMultiSelectRow = (
	setting: Setting,
	placeholder: string,
	emptyHint: string,
	options: readonly (string | MultiSelGroup)[],
	initial: readonly string[],
): { get: () => string[]; render: () => void } => {
	setting.settingEl.addClass("aw-ev-msel-row");
	return makeMultiSelect(setting.controlEl, placeholder, emptyHint, options, initial);
};

/**
 * **带说明的关联行多选**（v0.4.9+ 用户要求，SceneEditModal「关联场景」用）：每条已选关联**独占一行**
 * ＝场景名 ＋「联通性说明」输入框（写在名字后面）＋**删除按钮在该行最后**；补选下拉仍单独一行（候选＝options 去已选）。
 * 说明即写盘的 `- 关联：名（说明）` 括号段＝面板连线中点上的文字。
 * 返回 get()＝`[{id, note}]`（保持加入顺序、去重；note 已 trim）。
 */
const makeRelNoteRowsRow = (
	setting: Setting,
	placeholder: string,
	emptyHint: string,
	options: readonly { id: string; label: string }[],
	initial: readonly { id: string; note?: string }[],
	notePlaceholder: string,
): (() => Array<{ id: string; note: string }>) => {
	setting.settingEl.addClass("aw-ev-msel-row");
	const el = setting.controlEl.createDiv({ cls: "aw-ev-msel aw-rel-rows" });
	const selected: Array<{ id: string; note: string }> = [];
	for (const it of initial) {
		if (!it.id || selected.some((s) => s.id === it.id)) continue;
		selected.push({ id: it.id, note: (it.note ?? "").trim() });
	}
	const render = (): void => {
		el.empty();
		for (const item of selected) {
			const name = options.find((o) => o.id === item.id)?.label ?? item.id; // 候选里没有（改名/快照过期）＝原样显示 id，不让它凭空消失
			const row = el.createDiv({ cls: "aw-rel-row" });
			const nameEl = row.createSpan({ text: name, cls: "aw-rel-row-name" });
			nameEl.title = `${item.id}（写盘值）`;
			const noteEl = row.createEl("input", { type: "text", cls: "aw-rel-row-note", placeholder: notePlaceholder });
			noteEl.value = item.note;
			noteEl.addEventListener("input", () => (item.note = noteEl.value)); // 直写模型＝补选/删除重渲染时不丢输入
			row.createEl("button", { text: "✕", cls: "aw-addchar-relrm aw-rel-row-x", attr: { "aria-label": `移除关联「${name}」` } }).addEventListener("click", () => {
				const i = selected.findIndex((s) => s.id === item.id);
				if (i >= 0) selected.splice(i, 1);
				render();
			});
		}
		const remaining = options.filter((o) => !selected.some((s) => s.id === o.id));
		if (!remaining.length) {
			if (emptyHint) el.createDiv({ text: emptyHint, cls: "aw-dim aw-ev-msel-empty" });
			return;
		}
		const drop = el.createEl("select", { cls: "dropdown aw-addchar-sel aw-rel-row-add" });
		drop.createEl("option", { text: placeholder, value: "" });
		for (const o of remaining) drop.createEl("option", { text: o.label, value: o.id });
		drop.addEventListener("change", () => {
			if (!drop.value) return;
			selected.push({ id: drop.value, note: "" });
			render();
		});
	};
	render();
	return () => selected.map((s) => ({ id: s.id, note: s.note.trim() }));
};

/**
 * 时间线事件编辑弹窗（时间线面板「新增/编辑事件」共用）：事件名（可空） + 人物（下拉多选） + 已完成（勾选，完成状态） + 事件（多行） + 详情（多行；v0.4.7+ 更名自「描述」，旧 `- 描述：` 解析兼容、保存写回 `- 详情：`） + 影响（多行） + 关联（下拉多选，其它事件名）。
 * initialValues 预填（编辑=节点现值；新增=空）；charOptions/relatedOptions 为人物/关联下拉候选（面板注入：人物来自三层《人物.md》，关联为既有事件名、已排除自身）。
 * 事件名允许留空（＝旧「纯时间点」标题保持无名）；关闭弹窗即放弃（onCancel）。
 */
export class EventEditModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private initialValues: Partial<EventEditResult> | undefined,
		private charOptions: readonly string[],
		private relatedOptions: readonly string[],
		private level: { options?: readonly { value: string; label: string }[]; value?: string; label?: string } | undefined = undefined, // v0.4.9+ 「级别」行（同场景弹窗口径）：`options`＋`value`＝可选下拉（value＝目标《时间线.md》路径、label＝层级词＋书内路径）；只给 `label`＝只读行＝该事件所在位置。（不命名 scope＝基类 Modal 已有公开 `scope`；EventEditResult.scope 才是提交字段）
		private onSubmit: (result: EventEditResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact"); // 多字段表单统一紧凑行距（同 MultiFieldModal）
		this.contentEl.createEl("h3", { text: this.title });
		// v0.4.9+ 用户要求＝**弹窗最上方第一行是「级别」**（同场景弹窗）：新建事件时下拉选「写进哪一份《时间线.md》」（选项文案＝`书级 · 案头资料/时间线.md`／`卷级 · …/文档/时间线.md`／`章级 · …/时间线.md`）；
		// 编辑已有事件／添加子事件与同级事件＝这一行只读，值＝**该事件所在位置**（层级词 · 书内路径）＝换文档要去对应《时间线.md》里挪块（时间线的父子按同一文档内的标题序列成立）
		const levelOptions = this.level?.options ?? [];
		let levelChoice = this.level?.value ?? levelOptions[0]?.value ?? "";
		if (levelOptions.length) {
			new Setting(this.contentEl).setName("级别").addDropdown((d) => { // 不放说明文字（同场景弹窗）＝选项文案本身写清落在哪份文档
				for (const o of levelOptions) d.addOption(o.value, o.label);
				d.setValue(levelChoice);
				d.onChange((v) => (levelChoice = v));
			});
		} else if (this.level?.label) {
			const here = this.level.label; // 只读态＝禁用单项下拉（行型与可编辑态一致，只是改不了）
			new Setting(this.contentEl).setName("级别").addDropdown((d) => {
				d.addOption("here", here);
				d.setValue("here");
				d.setDisabled(true);
			});
		}
		// 字段初始值必须直接取自 initialValues——文本框 setValue 不触发 onChange：
		// 用户没碰过的字段只靠 onChange 回填会恒为空串（编辑态点保存＝「时间点无效」弹窗关不上、未触碰字段被清空）
		let timeText = (this.initialValues?.timeText ?? "").trim();
		let timeErr: HTMLElement | null = null;
		let title = this.initialValues?.title ?? "";
		let done = this.initialValues?.done ?? false;
		let desc = this.initialValues?.desc ?? "";
		let impact = this.initialValues?.impact ?? "";
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
		const getChars = makeMultiSelectRow(new Setting(this.contentEl).setName("人物"), "＋ 选择人物…", this.charOptions.length ? "（候选人物已全部选用）" : "（没有人物候选：先在《人物.md》中登记人物）", this.charOptions, this.initialValues?.chars ?? []); // 下拉多选（候选＝该书三层《人物.md》角色名）
		new Setting(this.contentEl).setName("已完成").addToggle((tg) => { // v0.4.3+：去掉字段说明文字，只留「已完成」标题＋开关
			tg.setValue(this.initialValues?.done ?? false);
			tg.onChange((v) => (done = v));
		});
		new Setting(this.contentEl).setName("详情").addTextArea((ta) => { // v0.4.11+ 唯一正文内容字段：原「事件」框已删，旧文档的 - 事件： 内容在解析时并入详情后回填这里；面板内联显示＋悬停 Tip
			ta.setPlaceholder("事件内容（面板条目中直接显示；旧「事件」字段内容也归这里）");
			ta.setValue(this.initialValues?.desc ?? "");
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows"); // 宽度复用既有多行输入类；aw-ta-rows 去掉全局 240px min-height，让 rows 生效
			ta.inputEl.rows = 5; // 唯一正文框＝5 行高（多行内容靠框内滚动）
			ta.onChange((v) => (desc = v));
		});
		new Setting(this.contentEl).setName("影响").addTextArea((ta) => {
			ta.setPlaceholder("事件影响 / 后果 / 代价");
			ta.setValue(this.initialValues?.impact ?? "");
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows"); // 同上：宽度复用、去 min-height
			ta.inputEl.rows = 2; // 影响＝2 行高
			ta.onChange((v) => (impact = v));
		});
		const getRelated = makeMultiSelectRow(new Setting(this.contentEl).setName("关联"), "＋ 选择关联事件…", this.relatedOptions.length ? "（既有事件已全部选用）" : "（暂无其它既有事件可关联）", this.relatedOptions, this.initialValues?.related ?? []); // 下拉多选（候选＝面板既有事件名，已排除自身）
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存").setCta().onClick(async () => {
				if (!parseTimelineTime(timeText)) { // 时间点必填且格式必须可解析（年 / 年-月 / 年-月-日）：非法则内联报错、不关闭弹窗
					timeErr.setText(`时间点无效：「${timeText || "（空）"}」无法解析，请用 120 / 120-06 / 120-06-15 这类写法`);
					timeErr.show();
					return;
				}
				this.submitted = true;
				this.close();
				await this.onSubmit({ timeText, title, chars: getChars.get(), done, desc: desc.trim(), impact: impact.trim(), related: getRelated.get(), scope: levelOptions.length ? levelChoice : undefined }); // v0.4.9+ scope＝所选目标文档路径（无级别下拉＝不带＝调用方沿用原口径） // desc＝唯一正文内容字段（空＝删除详情）
			})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close())); // onClose 未提交时触发 onCancel
		btns.settingEl.addClass("aw-btns-right"); // 保存/取消成组贴右（同 SkillEditModal）
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 场景面板（v0.4.7+）：场景编辑弹窗（新建/编辑共用） ----------

/** v0.4.9+ 关联场景编辑项：id＝写盘的 scene_id（`- 关联：` 项名）；note＝**联通性说明**（写盘＝`id（说明）` 括号段＝面板连线中点文字） */
export interface SceneRelEdit {
	id: string;
	note: string;
}

export interface SceneEditResult {
	sceneId: string; // 新建必填；编辑态＝可改的新块锚名（v0.4.8+ 改名）。v0.4.7+ 起**场景名即显示名**（独立「显示名」输入已删）
	description: string; // v0.4.8+ 多行（rows5），场景的主文本入口
	characters: string[];
	parent: string; // 父场景 scene_id（空＝顶层；写盘 `- 父场景：<id>`／删除该行）
	related: SceneRelEdit[]; // v0.4.7+ 关联场景（写盘 `- 关联：甲、乙（联通性说明）`／空＝删行）；v0.4.9+ 由 string[] 改为带说明的行（弹窗每行可编辑说明）
	events: string[]; // v0.4.8+ 场景挂载的时间线事件名（写盘 `- 事件：甲、乙（备注）`／空＝删行；括号备注按名字沿用旧值）
	terrain: string; // v0.4.8+ 地形（写盘 `- 地形：名`；空串＝删行/不着色）
	scope?: string; // v0.4.9+ **新建＝写入哪一层《场景.md》**（下拉按书级 → 卷级 → 章级排列，默认卷级）："book"＝案头资料/场景.md | "volume"＝当前激活卷《文档/场景.md》 | "chapter"＝当前激活章《场景.md》；编辑态不带＝不换层（级别行只读显示所在位置）
}

/**
 * 场景编辑弹窗（场景面板「新增/编辑场景」共用）：**级别下拉（v0.4.9+，仅新建时出现＝弹窗第一个字段）**＝选写入哪一层《场景.md》
 * 选项文字只有「书级／卷级／章级」三词（按此顺序排，默认选中卷级；候选由调用方按当前激活卷章算好传入、**这一行不带说明文字**＝用户要求），编辑态只给 `label`＝**该行的值＝场景所在位置**（层级 · 来源《场景.md》路径，禁用下拉、不换层）→
 * **父场景下拉**（v0.4.9+ 用户要求＝排在场景名上面）→场景名（＝显示名＝`## id` 块锚；**编辑态也可改**——改名由调用方 renameSceneBlock 换块锚＋renameSceneRefs 同步其它场景的 `- 父场景：`/`- 关联：` 引用）→角色（下拉多选，候选＝三层《人物.md》）→**关联场景（v0.4.9+ 行式：每条独占一行＝场景名＋联通性说明输入框＋行末删除按钮，补选下拉单独一行）**→**地形下拉**（v0.4.8+：候选＝md_docs 内置地形色板名＋自定义旧值，写 `- 地形：`）→**事件（v0.4.8+ 多选：候选＝该书各层《时间线.md》事件名、按所在文件分组为 `<optgroup>` 树状分类，写 `- 事件：`）**→**描述（多行 rows5，放全部字段最下方）**。
 * v0.4.8+：**「备注」「正文」输入已删**——弹窗不再提交这两字段，文档里已有的 `- 备注：` 行与 ```text 正文围栏写回时**未触碰原样保留**。
 * initialValues 预填（编辑＝条目现值；新增＝空）；名称非法（空 / 含 `\\ / : * ? " < > |`）内联报错、不关闭弹窗；关闭弹窗即放弃（onCancel）。
 */
export class SceneEditModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private editing: { scene_id: string } | null,
		private initialValues: Partial<SceneEditResult> | undefined,
		private charOptions: readonly string[],
		private parentOptions: readonly { id: string; label: string }[] = [], // 父场景候选（调用方给：全部场景去自身与后代防环）
		private sceneOptions: readonly { id: string; label: string }[] = [], // 关联场景候选（v0.4.7+：全部场景去自身；label 展示、id 为选中值与写盘值）
		private eventOptions: readonly MultiSelGroup[] = [], // v0.4.8+ 时间线事件候选：按所在《时间线.md》分组（下拉＝optgroup 树状分类；选中值＝事件名）
		private level: { options?: readonly { value: string; label: string }[]; value?: string; label?: string } | undefined = undefined, // v0.4.9+ 级别：`options`＋`value`＝弹窗最上方「级别」下拉（默认值＝value）；只给 `label`＝只读行（值＝场景所在位置、不换层）。（名字不叫 scope＝基类 Modal 已有公开 `scope`；SceneEditResult.scope 才是提交字段）
		private onSubmit: (result: SceneEditResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact");
		this.contentEl.createEl("h3", { text: this.title });
		// v0.4.9+ **级别＝弹窗最上方第一个字段**：新建时下拉按「书级 → 卷级 → 章级」排（默认选中卷级）＝决定写进哪一层《场景.md》
		//（书级＝案头资料/场景.md、卷级＝当前激活卷的《文档/场景.md》、章级＝当前激活章节的《场景.md》）；编辑态＝该行只读、值＝场景所在位置（层级 · 来源文档路径），不在弹窗里跨层挪块
		const scopeOptions = this.level?.options ?? [];
		let scopeChoice = this.level?.value ?? scopeOptions[0]?.value ?? "";
		if (scopeOptions.length) {
			new Setting(this.contentEl) // v0.4.9+ 用户要求＝这里**不放任何说明文字**，只一个「级别」标题＋下拉（选项文案本身已写清是哪一层）
				.setName("级别")
				.addDropdown((d) => {
					for (const o of scopeOptions) d.addOption(o.value, o.label);
					d.setValue(scopeChoice);
					d.onChange((v) => (scopeChoice = v));
				});
		} else if (this.level?.label) {
			const here = this.level.label; // 只读态（编辑已有场景／添加子场景）＝这一行的值＝**场景所在位置**（层级 · 来源《场景.md》路径；用户要求＝不放解释文字）
			new Setting(this.contentEl).setName("级别").addDropdown((d) => { // 禁用的单项下拉＝与可编辑态同样的行型，只是改不了（要换层＝到对应文档里挪块）
				d.addOption("here", here);
				d.setValue("here");
				d.setDisabled(true);
			});
		}
		// 预填值必须直接从 initialValues 取（setValue 不触发 onChange——同 EventEditModal 坑位）
		let sceneId = this.editing?.scene_id ?? "";
		let nameErr: HTMLElement | null = null;
		let description = this.initialValues?.description ?? "";
		let parent = this.initialValues?.parent ?? ""; // v0.4.7+ 大场景包含小场景
		let terrain = this.initialValues?.terrain ?? ""; // v0.4.8+ 地形下拉（空＝不着色/删行）
		const ed = this.editing; // 收窄一次（回调闭包里窄化不保留）
		new Setting(this.contentEl).setName("父场景").addDropdown((d) => { // v0.4.7+ 大场景包含小场景：写 `- 父场景：<id>`（选「无」＝删除该行、升为顶层）；v0.4.9+ 用户要求＝**排在场景名上面**（层级先定，再写名字）
			d.addOption("", "（无 · 顶层场景）");
			for (const o of this.parentOptions) d.addOption(o.id, o.label);
			d.setValue(this.initialValues?.parent ?? "");
			d.onChange((v) => (parent = v));
		});
		new Setting(this.contentEl).setName("场景名").addText((t) => { // v0.4.8+：编辑态也可改名（＝`## id` 块锚改名）——调用方 renameSceneBlock＋renameSceneRefs 同步全部 `- 父场景：`/`- 关联：` 引用；非法字符内联报错
			if (ed) t.setValue(ed.scene_id);
			else t.setPlaceholder("如 黑石城（即面板显示名与《场景.md》块锚名）");
			t.onChange((v) => (sceneId = v.trim()));
		});
		nameErr = this.contentEl.createDiv({ cls: "aw-ev-msel-empty" }); // 场景名的内联报错＝紧跟场景名那一行
		nameErr.hide();
		const getChars = makeMultiSelectRow(new Setting(this.contentEl).setName("角色"), "＋ 选择角色…", this.charOptions.length ? "（候选人物已全部选用）" : "（没有人物候选：先在《人物.md》中登记人物）", this.charOptions, this.initialValues?.characters ?? []); // 下拉多选（候选＝该书三层《人物.md》角色名）
		const getRelated = makeRelNoteRowsRow(new Setting(this.contentEl).setName("关联场景"), "＋ 选择关联场景…", this.sceneOptions.length ? "（已全部选用）" : "（还没有其它场景可关联）", this.sceneOptions, this.initialValues?.related ?? [], "联通性说明（如 官道 · 三日路程）"); // v0.4.9+ 行式关联（用户要求）：每条**独占一行**＝场景名＋联通性说明输入框＋行末 ✕ 删除；补选下拉单独一行（候选＝其它场景，已选自动移出）；写盘 `- 关联：甲（说明）、乙`，空＝删行
		new Setting(this.contentEl).setName("地形").addDropdown((d) => { // v0.4.8+ 地形下拉：候选＝内置地形色板名（写 `- 地形：名`→地图区域着色）；选「无」＝删除该行
			d.addOption("", "（无 · 不着色）");
			const names = Object.keys(SCENE_TERRAIN_COLORS);
			if (terrain && !names.includes(terrain)) names.push(terrain); // 文档里手写的自定义值（如「森林地带」）补进候选、预填不丢
			for (const n of names) d.addOption(n, n);
			d.setValue(terrain);
			d.onChange((v) => (terrain = v));
		});
		const getEvents = makeMultiSelectRow(new Setting(this.contentEl).setName("事件"), "＋ 选择时间线事件…", this.eventOptions.length ? "（已全部选用）" : "（还没有时间线事件：先在《时间线.md》中登记）", this.eventOptions, this.initialValues?.events ?? []); // v0.4.8+ 场景挂事件：候选＝该书各层《时间线.md》的事件名，**按所在文件分组**（下拉＝`<optgroup>` 树状分类）；写盘 `- 事件：甲、乙`，空＝删行
		new Setting(this.contentEl).setName("描述").addTextArea((ta) => { // v0.4.8+ 描述＝场景主文本（多行 rows5）；放全部字段最下方
			ta.setPlaceholder("场景描述（可多行）");
			ta.setValue(this.initialValues?.description ?? "");
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows");
			ta.inputEl.rows = 5;
			ta.onChange((v) => (description = v));
		});
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存").setCta().onClick(async () => {
				if (!sceneId || /[\\/:*?"<>|]/.test(sceneId)) {
					nameErr?.setText(sceneId ? `场景名无效：「${sceneId}」不能包含 \\ / : * ? " < > |` : "场景名不能为空");
					nameErr?.show();
					return;
				}
				this.submitted = true;
				this.close();
				await this.onSubmit({ sceneId, description: description.trim(), characters: getChars.get(), parent, related: getRelated(), terrain, events: getEvents.get(), scope: scopeOptions.length ? scopeChoice : undefined }); // v0.4.9+ 有级别下拉才交 scope（编辑态＝undefined＝来源文档不变）
			})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
		btns.settingEl.addClass("aw-btns-right");
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 书籍级写作技能（v0.3.4+）：技能编写弹窗＋阶段配置弹窗（面板本体由 main.ts 用 ActionMenuModal 组装菜单项）----------

/** 技能保存位置级别：system＝全局 <work_dir>/SKILLS/<name>.md（跨书共用）；book＝<书>/案头资料/Skill/<name>.md（本书专属） */
export type SkillLevel = "system" | "book";

export interface SkillEditResult {
	name: string; // 技能基名（不含 .md）
	level: SkillLevel; // 保存位置；编辑态改级别＝另存到新位置（原文件由调用方删除）
	content: string; // 技能完整 Markdown 正文
}

/**
 * 技能编写弹窗（新建＋编辑共用，v0.3.4+）：名称 + 保存位置 + 多行正文（新建态正文由调用方预填格式模板，用户填充）。
 * editing=null 为新建（名称可填、保存位置默认书籍级）；编辑态名称只读（保存回原路径，防 故事状态.md book_skills 引用悬空），
 * 改「保存位置」提交＝另存另一级同名下（调用方负责写新删旧）。名称非法（空 / 含文件名非法字符 / 以 .md 结尾）时内联报错、不关闭弹窗。
 */
export class SkillEditModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private editing: { name: string; level: SkillLevel } | null,
		private initialContent: string,
		private onSubmit: (result: SkillEditResult) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact"); // 多字段表单统一紧凑行距（同 EventEditModal）
		this.contentEl.createEl("h3", { text: this.title });
		let name = this.editing?.name ?? "";
		let level: SkillLevel = this.editing?.level ?? "book";
		let content = this.initialContent; // v0.3.4+ 修复：编辑态必须以 initialContent 起算——不碰编辑器直接保存会清空原文件
		const ed = this.editing; // 收窄一次（回调闭包里 this.editing 的窄化不保留）
		let nameErr: HTMLElement | null = null;
		if (ed) {
			new Setting(this.contentEl).setName("Skill 名称").addText((t) => {
				t.setValue(ed.name); // 编辑态：名称只读（＝保存回原位）
				t.setDisabled(true);
			});
		} else {
			new Setting(this.contentEl).setName("Skill 名称").addText((t) => {
				t.setPlaceholder("如 反转钩子设计（不带 .md 后缀）");
				t.onChange((v) => (name = v.trim()));
			});
			nameErr = this.contentEl.createDiv({ cls: "aw-ev-msel-empty" });
			nameErr.hide();
		}
		const loc = new Setting(this.contentEl)
			.setName("保存位置") // v0.4.7+ 说明文字从标签下移出——悬停「保存位置」标签才显示（弹窗更紧凑）
			.addDropdown((d) => {
				d.addOption("system", "系统级（SKILLS/）");
				d.addOption("book", "书籍级（案头资料/Skill/）");
				d.setValue(level);
				d.onChange((v) => (level = v === "system" ? "system" : "book"));
			});
		setTooltip(loc.nameEl, this.editing ? "更改位置并保存＝以同名另存到新位置，原文件自动删除（书籍级引用同步清理）" : "系统级＝SKILLS/（全部书籍共用）；书籍级＝案头资料/Skill/（仅本书）");
		new Setting(this.contentEl).setName("Skill 内容").addTextArea((ta) => {
			ta.setPlaceholder("技能按独立 Markdown 章节编写；注入提示词时剥去起始标题行、以【技能 · 名称】包裹");
			ta.setValue(this.initialContent);
			ta.inputEl.classList.add("aw-prompt-textarea", "aw-ta-rows"); // 宽度复用既有多行输入类；aw-ta-rows 去掉全局 240px min-height，让 rows 生效
			ta.inputEl.rows = 16;
			ta.onChange((v) => (content = v));
		});
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存").setCta().onClick(async () => {
				if (!ed && (!name || /[\\/:*?"<>|]/.test(name) || name.toLowerCase().endsWith(".md"))) {
					nameErr?.setText(name ? `Skill 名称无效：「${name}」不能包含 \\ / : * ? " < > | 或以 .md 结尾` : "Skill 名称不能为空");
					nameErr?.show();
					return;
				}
				this.submitted = true;
				this.close();
				await this.onSubmit({ name, level, content });
			})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close())); // onClose 未提交时触发 onCancel
		btns.settingEl.addClass("aw-btns-right"); // 保存/取消成组贴右（aw-form-compact 默认每钮 margin-left:auto，双钮会把空档平分拆散）
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/**
 * 书籍技能阶段配置弹窗（v0.3.4+）：四个阶段（0–3）各一节下拉多选（候选＝本书 案头资料/Skill/ 技能名），
 * 保存回 故事状态.md book_skills（空阶段＝不写该键）。phases 标签由调用方按 settings.llm.writing_phases 显示名传入。
 */
export class BookSkillPhaseModal extends AwModal {
	private submitted = false;

	constructor(
		app: App,
		private phases: Array<{ key: BookSkillPhase; label: string }>,
		private skillNames: readonly string[],
		private current: Partial<Record<BookSkillPhase, readonly string[]>>,
		private onSubmit: (result: Partial<Record<BookSkillPhase, string[]>>) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("aw-form-compact");
		this.contentEl.createEl("h3", { text: "书籍 Skill 阶段配置" });
		if (!this.skillNames.length) this.contentEl.createDiv({ text: "（尚无书籍级技能：先用「新建 Skill…」保存一条到案头资料/Skill/）", cls: "aw-dim" });
		// 各阶段 tab 页（tab 数由调用方传入的 phases/defs 决定，现＝五阶段；骨架复用设置页「写作阶段模型配置」的 aw-phase-tabs-* 类，阶段名同源 WRITING_PHASE_LABELS）；每 tab＝该阶段已选 Skill 列表（✕ 移除）＋「＋ 添加技能…」下拉
		const tabContainer = this.contentEl.createDiv({ cls: "aw-phase-tabs-container aw-bskill-tabs" });
		const tabHeader = tabContainer.createDiv({ cls: "aw-phase-tabs-header" });
		const tabContent = tabContainer.createDiv({ cls: "aw-phase-tabs-content" });
		const msels = this.phases.map((p) => { // 各阶段控件各建一次（宿主先游离创建、状态常驻）——切 tab 只换挂宿主，切来切去不丢未保存的改动
			const m = makeMultiSelect(tabContent, "＋ 添加技能…", this.skillNames.length ? "" : "（没有技能候选：先新建技能）", this.skillNames, this.current[p.key] ?? []);
			return m;
		});
		const hosts = Array.from(tabContent.children); // makeMultiSelect 在 tabContent 内生成的 .aw-ev-msel 宿主，按 phases 顺序
		let activeTab = 0;
		const showTab = (idx: number): void => {
			activeTab = idx;
			tabHeader.querySelectorAll(".aw-phase-tab-btn").forEach((b, i) => b.classList.toggle("is-active", i === idx));
			tabContent.empty();
			tabContent.appendChild(hosts[idx]);
			msels[idx].render(); // 宿主换挂后重画（empty 清掉了旧内容）
		};
		this.phases.forEach((p, idx) => {
			const btn = tabHeader.createEl("button", { cls: "aw-phase-tab-btn" + (idx === 0 ? " is-active" : "") });
			btn.setText(p.label);
			btn.onclick = () => { if (activeTab !== idx) showTab(idx); };
		});
		showTab(0);
		const btns = new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("保存").setCta().onClick(async () => {
				this.submitted = true;
				const out: Partial<Record<BookSkillPhase, string[]>> = {};
				this.phases.forEach((p, i) => {
					const v = msels[i].get();
					if (v.length) out[p.key] = v;
				});
				this.close();
				await this.onSubmit(out);
			})
		);
		btns.addButton((btn) => btn.setButtonText("取消").onClick(() => this.close())); // onClose 未提交时触发 onCancel
		btns.settingEl.addClass("aw-btns-right"); // 保存/取消成组贴右（同 SkillEditModal）
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- v0.4.3+ 灵感工具包（书级《案头资料/灵感/灵感.md》内一条命令完成打开/定位/改名/删除/新增）----------

/** 弹窗各动作的落盘侧实现（main.ts 提供）：openBlock/openDoc/newBlock/renameBlock/editTemplate 会先关弹窗再执行（要让位给编辑器或下一个弹窗），deleteBlock 留在弹窗内并回填最新列表 */
export interface InspirationKitHandlers {
	openBlock: (b: InspirationBlock) => void | Promise<void>;
	renameBlock: (b: InspirationBlock) => void | Promise<void>;
	deleteBlock: (b: InspirationBlock) => void | Promise<void>;
	newBlock: () => void | Promise<void>;
	openDoc: () => void | Promise<void>;
	editTemplate: () => void | Promise<void>;
}

/**
 * 灵感工具包弹窗：搜索框＋灵感块列表（每行「定位／改名／删除」）＋底部「新增灵感／打开灵感文件／编辑灵感模板」。
 * 行本身＝定位（搜索框回车＝定位到当前过滤结果第一条）。增删改之后调 `setBlocks` 回填重新解析的结果——
 * 每次写盘都会让旧的行号/块对象失效，调用方必须重新 `parseInspirationDoc` 再喂回来。
 */
export class InspirationKitModal extends AwModal {
	private blocks: InspirationBlock[];
	private keyword = "";
	private closed = false;
	private listEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;

	constructor(
		app: App,
		private docLabel: string,
		blocks: InspirationBlock[],
		private h: InspirationKitHandlers
	) {
		super(app);
		this.blocks = blocks;
	}

	/** 增删改后刷新（删除不关窗，留在列表里继续挑下一条） */
	setBlocks(blocks: InspirationBlock[]): void {
		this.blocks = blocks;
		this.renderList();
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "灵感工具包" });
		this.countEl = this.contentEl.createDiv({ cls: "aw-dim aw-prompt-hint" });
		const search = this.contentEl.createEl("input", { cls: "text-input aw-insp-search", type: "text" });
		search.setAttr("placeholder", "搜索灵感（名字或正文）…");
		search.addEventListener("input", () => {
			this.keyword = search.value;
			this.renderList();
		});
		search.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const first = this.filtered()[0]; // 回车＝定位到当前过滤结果的第一条
			if (first) void this.run(() => this.h.openBlock(first), true);
		});
		this.listEl = this.contentEl.createDiv({ cls: "aw-action-list aw-insp-list" });
		this.renderList();
		const btns = new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("新增灵感").setCta().onClick(() => void this.run(() => this.h.newBlock(), true)))
			.addButton((b) => b.setButtonText("打开灵感文件").onClick(() => void this.run(() => this.h.openDoc(), true)))
			.addButton((b) => b.setButtonText("编辑灵感模板").onClick(() => void this.run(() => this.h.editTemplate(), true)));
		btns.settingEl.addClass("aw-btns-right");
	}

	private filtered(): InspirationBlock[] {
		return this.blocks.filter((b) => inspirationMatches(b, this.keyword));
	}

	private renderList(): void {
		if (!this.listEl) return;
		const rows = this.filtered();
		if (this.countEl) {
			this.countEl.setText(`文件：${this.docLabel} · 共 ${String(this.blocks.length)} 条灵感${this.keyword.trim() ? ` · 命中 ${String(rows.length)} 条` : ""}；新增按 SKILLS/${INSPIRATION_SKILL_NAME}.md 在文末追加模板块`);
		}
		this.listEl.empty();
		if (!this.blocks.length) {
			this.listEl.createDiv({ text: "还没有灵感：点「新增灵感」会在文档末尾追加一个模板块，填完直接保存即可。", cls: "aw-dim" });
			return;
		}
		if (!rows.length) {
			this.listEl.createDiv({ text: "没有匹配的灵感（换个关键词，或清空搜索框看全部）。", cls: "aw-dim" });
			return;
		}
		for (const b of rows) {
			const row = this.listEl.createDiv({ cls: "aw-insp-row" });
			row.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).closest("button")) return; // 按钮动作优先于行点击
				void this.run(() => this.h.openBlock(b), true);
			});
			const txt = row.createDiv({ cls: "aw-insp-txt" });
			txt.createDiv({ text: b.name || b.heading, cls: "aw-insp-name" });
			const sub = txt.createDiv({ cls: "aw-insp-sub" });
			if (b.date) sub.createSpan({ text: b.date, cls: "aw-insp-date" });
			sub.createSpan({ text: inspirationPreview(b.body) || "（正文为空，待填充）", cls: "aw-dim" });
			const btns = row.createDiv({ cls: "aw-insp-btns" });
			btns.createEl("button", { text: "定位", cls: "aw-insp-btn" }).onclick = () => void this.run(() => this.h.openBlock(b), true);
			btns.createEl("button", { text: "改名", cls: "aw-insp-btn" }).onclick = () => void this.run(() => this.h.renameBlock(b), true);
			btns.createEl("button", { text: "删除", cls: "aw-insp-btn aw-insp-del" }).onclick = () => void this.run(() => this.h.deleteBlock(b), false);
		}
	}

	/** closeFirst＝要去编辑器/下一个弹窗里干活的动作：先关本弹窗（模态遮罩让位）；删除不关，留在列表里继续挑 */
	private async run(fn: () => void | Promise<void>, closeFirst: boolean): Promise<void> {
		if (this.closed) return; // 已关窗＝不再排队执行（防连点重复打开编辑器/重复弹改名框）
		if (closeFirst) {
			this.closed = true;
			this.close();
		}
		await fn();
	}

	override onClose(): void {
		this.closed = true;
		this.contentEl.empty();
	}
}

/** v0.4.7+ 通用引导弹窗：h3 标题＋多行说明（`.aw-prompt-hint` 走 pre-line）＋一排动作按钮（`cta:true` 者为主按钮）。
 *  任一动作＝先 `close()` 再执行（模态遮罩让位给后续弹窗/文件切换，同 InspirationModal 的 closeFirst 约定）；Esc/点遮罩＝无动作。
 *  现用于「工作目录里没有书籍」时的建书引导（main.ts `guideNewStoryOnStartup`）。 */
export class AwGuideModal extends AwModal {
	constructor(
		app: App,
		private opts: { title: string; body: string; actions: Array<{ label: string; cta?: boolean; run: () => void }> }
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h3", { text: this.opts.title });
		this.contentEl.createEl("p", { cls: "aw-prompt-hint", text: this.opts.body });
		const btns = new Setting(this.contentEl);
		for (const a of this.opts.actions) {
			btns.addButton((b) => {
				b.setButtonText(a.label).onClick(() => {
					this.close();
					a.run();
				});
				if (a.cta) b.setCta();
				return b;
			});
		}
	}
}
