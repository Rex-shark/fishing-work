#!/bin/sh
# 把繪圖比賽的技能安裝（或更新）到另一個專案的技能目錄。
# 用法：other/skills/install.sh <技能目錄>
#   pi：          other/skills/install.sh /path/to/project/.pi/skills
#   Claude Code： other/skills/install.sh /path/to/project/.claude/skills
# 只帶 agent 用得到的檔案（SKILL.md、壓縮版腳本、references）；有註解的原始腳本與維護紀錄留在本專案。
# 目標目錄裡同名的技能會被整個換掉，其他技能不動。
set -eu

if [ $# -ne 1 ]; then
  echo "用法：$0 <技能目錄>（例如 /path/to/project/.pi/skills）" >&2
  exit 1
fi

src="$(cd "$(dirname "$0")" && pwd)"
dest="$1"
mkdir -p "$dest"

for skill in play-draw-contest set-draw-contest-topic; do
  rm -rf "${dest:?}/$skill"
  mkdir -p "$dest/$skill"
  cp "$src/$skill/SKILL.md" "$dest/$skill/SKILL.md"
  if [ -d "$src/$skill/references" ]; then
    cp -R "$src/$skill/references" "$dest/$skill/references"
  fi
  if [ -f "$src/$skill/scripts/draw-helper.min.js" ]; then
    mkdir -p "$dest/$skill/scripts"
    cp "$src/$skill/scripts/draw-helper.min.js" "$dest/$skill/scripts/draw-helper.min.js"
  fi
  echo "已安裝 $skill → $dest/$skill"
done
