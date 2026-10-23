# Domain docs

## 探索代码前

采用 single-context 布局：

- 读取根目录 `GLOSSARY.md`。
- 读取 `docs/adr/` 中与当前工作相关的 ADR。

文件不存在时静默继续，不为初始化而创建空文档。
由 domain-modeling 技能在领域术语或决策明确后按需创建。

## 使用规则

- Issue、设计建议、假设及测试命名使用术语表定义的领域词汇。
- 避免使用术语表明确排除的同义词。
- 缺失的领域概念交由 domain-modeling 澄清。
- 建议与既有 ADR 冲突时，明确指出冲突及重新讨论的理由。
