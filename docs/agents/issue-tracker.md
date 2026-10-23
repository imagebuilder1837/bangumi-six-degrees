# Issue tracker: GitHub

本仓库的问题和工作项使用 GitHub Issues，通过 `gh` CLI 操作。
在仓库目录运行命令，由 Git remote 推断目标仓库。

## 常用操作

- 发布工作项：`gh issue create --title "..." --body-file <文件路径>`。
- 读取：`gh issue view <编号> --json number,title,body,labels,comments`。
- 列出：`gh issue list --state open --json number,title,body,labels`；
  按需添加 `--label` 或调整 `--state`。
- 评论：`gh issue comment <编号> --body "..."`。
- 添加或移除标签：`gh issue edit <编号> --add-label "..."` /
  `--remove-label "..."`。
- 关闭：`gh issue close <编号> --comment "..."`。
- 无法建立原生子 Issue 关系时，在子 Issue 正文顶部写
  `Part of #<父编号>`，并在父 Issue 的任务列表中链接子 Issue。

技能要求“发布到 issue tracker”时，创建 GitHub Issue；
要求“获取相关 ticket”时，读取对应 Issue。

## Pull requests as a triage surface

**PRs as a request surface: no.**
