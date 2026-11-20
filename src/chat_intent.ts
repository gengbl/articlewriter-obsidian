/**
 * 对话面板「这条消息算不算纯闲聊」判定（v0.4.7+，纯函数、无 IO、可单测）。
 * 背景：本地弱模型会把「hi」「你好」当成指令，擅自调用「连续编写」这类改动稿件/跑长流程的重命令。
 * 面板据此做三件事：①不做「行动宣告」催办 ②拦下写作/生成类工具调用 ③系统提示词里写明同一口径（见 llm_chat_view.composeSystemPrompt）。
 */

/** 短消息上限：超过这个长度一律认为「有话要说」，不按闲聊处理（宁松勿严） */
export const CHATTER_MAX_CHARS = 16;

/** 问候／致谢／告别／身份与能力询问类套话（整句匹配；比对前已去掉空白与标点） */
export const GREETING_RE =
	/^(你好+|您好+|你坏|嗨+|哈喽|嗨喽|哈罗|嘿|嘿嘿|在吗|在么|在不在|有人在吗|早上好|上午好|下午好|晚上好|你是谁|你是什么|你能做什么|你会什么|你能干什么|你能帮我做什么|帮我做什么|谢谢+|多谢|感谢|多谢了|辛苦了|辛苦|再见|拜拜|回头见|good\s?morning|good\s?night|good\s?evening|hi+|hello+|hey+|yo|thanks?(you)?|thank\s?you|bye|nice\s?to\s?meet\s?you)+$/i;

/** 承认／同意类短句：意图含糊但**不算闲聊**（上一轮助手提过建议、用户回「好的」＝许可，不能拦） */
export const CONFIRM_RE = /^(好的|好吧|好|行|行吧|可以|可以的|没问题|同意|确认|是的|是|对|对的|嗯+|哦+|ok|okay|好的呢|来吧|做吧|就这样|听你的|你决定|随便你|都行)+$/i;

/** 出现即视为「有动作意图」的词（覆盖查询类与写作/生成类，尽量宽松以免误拦真实指令） */
export const ACTION_HINT_RE =
	/(写|编写|创作|续写|生成|创建|新建|建|改|修改|重写|润色|审阅|审|去ai|去\s?ai|deai|删|插入|添加|加|继续|接着|接下来|开始|执行|运行|跑|检查|看看|看|查|读|打开|关闭|分析|统计|字数|调整|补充|补|对齐|整理|导出|保存|切换|换|配置|设定|规划|安排|复制|移动|重排|归卷|合并|拆分|校对|翻译|列出|搜索|找|定位|跳转|大纲|正文|章节|卷|世界观|时间线|人物|关系|伏笔|灵感|脚本|剧本|导出)/i;

/**
 * 是不是纯闲聊／问候？
 * 规则：①去掉空白与标点后整句命中问候套话＝true；②短句（≤CHATTER_MAX_CHARS 字符）且不含任何动作意图词＝true；
 * ③整句命中承认短句（「好的」「嗯」「ok」…）＝false（那是对上一轮提议的许可，属含糊指令、不拦）；④空消息＝true。
 */
export function isPureChatter(text: string): boolean {
	const t = text.trim().replace(/[\s\p{P}\p{S}]+/gu, "");
	if (!t) return true;
	if (CONFIRM_RE.test(t)) return false;
	if (GREETING_RE.test(t)) return true;
	return t.length <= CHATTER_MAX_CHARS && !ACTION_HINT_RE.test(t);
}
