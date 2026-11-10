/**
 * 情节张力/节奏规则默认内容：唯一来源为仓库根 TENSION_RULES.md。
 * 构建时由 esbuild 以 text loader 打包进 release/main.js；作为每书「案头资料/张力规则.md」的播种种子
 * （建书播种 / 大纲·策划生成前缺失补播种），生成书级/卷级大纲与策划指南时从该书文件读盘注入提示词（不进正文写作路径）。
 */
import tensionRulesMd from "../TENSION_RULES.md";

export const DEFAULT_TENSION_RULES = tensionRulesMd;
