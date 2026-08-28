/**
 * 内置免费模型(Joker-free / OpenCode Zen 免费档)的固定清单:免费档选择器、
 * 默认供应商档案和上游拉取失败时的兜底都以它为准。须与 model-provider-presets.ts
 * 里 opencode-zen 预设的 models 保持一致(测试强制同步)。
 */
export const DEFAULT_COMPOSER_MODEL_IDS: readonly string[] = [
  'big-pickle',
  'hy3-free',
  'ling-3.0-flash-fin-free',
  'mimo-v2.5-free',
  'muse-spark-1.2-contributor-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free'
]
