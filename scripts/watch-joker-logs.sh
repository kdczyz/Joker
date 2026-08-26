#!/usr/bin/env bash
# watch-joker-logs.sh — 实时监控 Joker (Electron) 运行日志
#
# 日志由 src/main/logger.ts 写入,按天分文件:
#   ~/Library/Application Support/Joker/logs/Joker-YYYY-MM-DD.log
# 行格式: [ISO时间戳] [级别] [分类] 消息
#   级别: ERROR / WARN / INFO / STDERR(子进程标准错误)
#
# 用法见 ./watch-joker-logs.sh --help

set -euo pipefail

LOG_HOME="$HOME/Library/Application Support/Joker/logs"
TODAY="Joker-$(date +%F).log"
LEVELS=""
ALL=""
NO_COLOR=""
LINES=30

usage() {
  cat <<'EOF'
实时监控 Joker 运行日志

用法:
  ./watch-joker-logs.sh [选项]

选项:
  -l, --level LEVELS   只显示指定级别,逗号分隔: error,warn,info,stderr
  -a, --all            跟踪所有 Joker-*.log (不仅是今天的)
  -n, --lines N        启动先显示最近 N 行 (默认 30)
      --no-color       关闭颜色高亮
  -h, --help           显示本帮助

示例:
  ./watch-joker-logs.sh                  # 跟踪今天的日志,带颜色
  ./watch-joker-logs.sh -l error,warn    # 只看 error 和 warn
  ./watch-joker-logs.sh -a -l stderr     # 所有日期,只看子进程 stderr
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -l|--level) LEVELS="$2"; shift 2 ;;
    -a|--all)   ALL="1"; shift ;;
    -n|--lines) LINES="$2"; shift 2 ;;
    --no-color) NO_COLOR="1"; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ ! -d "$LOG_HOME" ]]; then
  echo "找不到日志目录: $LOG_HOME" >&2
  echo "(Joker 可能还没运行过,或日志目录已被移动)" >&2
  exit 1
fi

if [[ -n "$ALL" ]]; then
  shopt -s nullglob
  FILES=("$LOG_HOME"/Joker-*.log)
  shopt -u nullglob
  if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "目录下没有任何 Joker-*.log 文件" >&2
    exit 1
  fi
else
  FILES=("$LOG_HOME/$TODAY")
fi

# 颜色 (仅在终端且有 -t 时启用)
if [[ -z "$NO_COLOR" && -t 1 ]]; then
  C_ERR=$'\033[31m'; C_WARN=$'\033[33m'; C_INFO=$'\033[32m'; C_RST=$'\033[0m'
else
  C_ERR=""; C_WARN=""; C_INFO=""; C_RST=""
fi

# 构造过滤正则 (行内任意位置的 [LEVEL])
FILTER=""
if [[ -n "$LEVELS" ]]; then
  IFS=',' read -ra LV <<< "$LEVELS"
  PAT=""
  for lv in "${LV[@]}"; do
    case "$lv" in
      error)  PAT="${PAT:+$PAT|}\[ERROR\]" ;;
      warn)   PAT="${PAT:+$PAT|}\[WARN\]" ;;
      info)   PAT="${PAT:+$PAT|}\[INFO\]" ;;
      stderr) PAT="${PAT:+$PAT|}\[STDERR\]" ;;
      *) echo "未知级别: $lv (可用: error,warn,info,stderr)" >&2; exit 1 ;;
    esac
  done
  FILTER="$PAT"
fi

# 着色 + 实时刷新 (awk fflush 保证逐行输出)
colorize() {
  awk -v err="$C_ERR" -v warn="$C_WARN" -v info="$C_INFO" -v rst="$C_RST" '
  {
    if (index($0,"[ERROR]") || index($0,"[STDERR]")) print err $0 rst
    else if (index($0,"[WARN]")) print warn $0 rst
    else if (index($0,"[INFO]")) print info $0 rst
    else print $0
    fflush()
  }'
}

echo "==> 监控: ${FILES[*]}  (Ctrl+C 退出)" >&2

if [[ -n "$FILTER" ]]; then
  tail -F -n "$LINES" "${FILES[@]}" | grep -E --line-buffered "$FILTER" | colorize
else
  tail -F -n "$LINES" "${FILES[@]}" | colorize
fi
