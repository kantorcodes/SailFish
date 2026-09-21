# 已完成

2026-09-21 压测题 v5：去掉假失败，校准分数

## 起因

DeepSeek Flash（1M 窗口）实跑一份报告，总分 0，但模型本身五档全过。四处问题全在尺子上：

1. **并发第三路被自己卡出假失败**：`BENCH_MAX_OUTPUT_TOKENS = 64`，思考型模型 completion 正好 64、`finish_reason: length` → 判 truncated → 并发 0 → 总分 0。另两路只用 2 token。这是工具轴已修过的同一个病（当时去掉了工具两步的小上限），并发漏了。
2. **写速分量级失真**：`BENCH_SCORE_REF.outputCharsPerSecSum = 200`，实测五档 cps 合计 2826 → 分数 14130，而 context 2325 / tools 1134。几何平均被一项带偏。
3. **各档没写同一段**：`BENCH_OUTPUT_PASSAGE` 182 字，只有 4000 档写出 182（原样抄对），16000/32000/64000/128000 写出 491/1360/756/551。题面结构是 `userHead(含正文) + ballast`，128000 档时正文距离生成点 126,607 字。副作用：写得越多 cps 越高（32000 档 709 最快），等于奖励不听话。
4. **主轴没带工具清单**：context 轴用 `toolChoice: 'none'`，接口把 25 个工具摘掉。同为 4000 字，实测 prompt_tokens：context 2467 vs tools 6093 / concurrency 6112，差 3626 ≈ 工具清单估算 3258。

用户确认：四处全修，题升 v5；主轴带上工具清单后若模型真去调了工具，该档判不通过、备注写工具名。

设计取舍已写入 `electron/services/llm-bench/SPEC.md`。

## 要改什么

### types.ts
- `BENCH_SUITE_VERSION` → `sailfish-bench-v5`
- 删 `BENCH_MAX_OUTPUT_TOKENS`（并发不再单卡上限；`index.ts` 同步去掉导出）
- `BENCH_SCORE_REF`：`outputCharsPerSecSum` 200 → 2000（默认五档、每档 ~400 cps 为及格线）；新增/改用 `concurrencyTtftMs`（按最慢一路首字延迟算分），替掉现在的 `concurrencyCharsPerSec`
- `BenchRungResult` 增 `calledTool` 已有，主轴复用它记「不该调却调了」

### suite.ts
- 题面重排：`system` 不变；user 改成 `isolate + 垫料 + 指令与正文`——垫料在前，要它照抄的正文和指令贴在最后
- `BENCH_USER_INSTRUCTION` / `BENCH_USER_TOOL` 同样改成「垫料在前、指令在后」，三轴保持同一形状
- 隔离行仍在最前，保证各档不共享前缀

### runner.ts
- `runContext`：`toolChoice` 从 `'none'` 改为不传（真实请求形状，工具清单照发）；若 `outcome.calledTool` → 该档 `success=false`、`error='unexpected_tool_call'`、`toolName` 记下
- `runShort`（并发）：去掉 `maxOutputTokens: BENCH_MAX_OUTPUT_TOKENS`，走模型自己配的上限

### score.ts
- `scoreConcurrency`：从「最慢一路 totalMs 换算 cps」改为「最慢一路 ttftMs 对参照值」
- `scoreOutput`：参照值换新常量（逻辑不变）

### llm-bench.html
- 版本号标签 v4 → v5
- 新增状态文案：`unexpectedTool`（中「不该调却调了工具」/ 英 "Unexpected tool call"）

### 测试
- `suite.test.ts`：版本号；断言指令和正文在用户消息末尾、垫料在前；各轴不共享前缀
- `runner.test.ts`：并发不再传 maxOutputTokens；主轴调了工具判不通过
- `score.test.ts`：并发按 ttft 算分；写速新参照值

## 不做

- 不改上下文档位、不改工具往返的两步结构、不改三路这个数
- 不为了让分数好看而放宽失败判定：限流、断流、真截断照旧判零
- 不回头兼容 v4 分数（SPEC 已写明跨版本不比）

## 任务拆解

- [x] SPEC 设计目标
- [x] 题面重排 + 版本升 v5（suite / types）
- [x] 跑手：并发去上限、主轴带工具清单并判「不该调却调了」
- [x] 算分：并发按首字延迟、写速重标定
- [x] 压测窗文案与版本号
- [x] 单测 + CLI 回归 + 真机跑一遍对照

## 审查后追加

代码审查发现修四处时自己引进的新口子，一并处理：

- `finishShort` 原本只看 truncated，一个字都没吐也记 ok；而并发改按 ttft 算分后，缺首字会被当成零延迟——要么整项归零（假失败），要么把最慢那路抹掉（假通过）。现统一判法：要真吐出字才算收住，缺首字退回整轮。
- 工具收尾那步仍写死 `toolChoice: 'none'`，与「清单照真实请求发满」自相矛盾，且各家对 none 的处理不同会破坏可比性。改成照发；拿到结果还去叫下一个工具算没收住。
- 测试没真兜住 toolChoice：补断言 `toolChoice === undefined` 且 `tools.length === 25`；并发那条补成真模拟思考吃额度。
- SPEC 补明「按零」的两种口径（长度逐档累加 vs 工具/并发整项判定），以及会流式吐思考的模型「首字」量的是思考首字这一已知偏差。

## 端到端复验后追加：「没照抄」要标出来（2026-09-21）

换火山 deepseek-v4.1-flash 端到端跑，五档里偶尔仍会有一档自己发挥（一轮里 32k 档写了 889 字），那一档写速 427 字/秒、其余 231–255，混在一起横着比就是假象。补一条：

- 报告带上 `passageChars`；runner 按**不含思考的正文字数**（`onDone` 的 `result.content`）判，偏离一成以上记 `offPassage`，压测窗把该档字数/写速标黄并写明原因。
- 判据必须用正文而非流里累计的 `outputChars`：`chatWithToolsStream` 会把思考过程连同 `<details>` 外壳一起 `onChunk` 出去，用累计字数判会让所有吐思考的模型整片被冤枉。真机验证：火山 GLM5.2 流里 479/638 字、正文 182 字，`offPassage=false`；火山 dsV4.1flash 某轮流里 1271 字同样不误标。
- 不判失败、不动分数：字确实写出来了，扣分会把「模型不听话」算到接口头上；且 `outputCharsPerSec` 是速率，写长本身不抬高它。SPEC 第 9 条据此写明「标记只管给人看」。

二次审查后再收三处：

- 判据从「字数差一成」换成「认不认得出那段话」：忽略空白后必须包含整段正文、且不超过 1.3 倍长。只看字数会把「先寒暄两句再照抄」冤枉掉，只看包不包含又漏掉照抄完继续发挥的（motivating case 就是 889 字那档）。
- `runContext` 原本抄了一份 `finishShort` 的判定逻辑，收敛成调用同一个方法，长度档只多「记写速 + 看照没照抄」两件事。
- `applyWriteSpeed` 的 `genMs` 原本只有 `Math.max(1, …)` 兜底：整段一次到的接口会算出每秒几万字，几何平均被一项带飞（正是 SPEC 第 7 条要防的）。改成首字后不足 50ms 就退回按整轮算。

## 真机对照（DeepSeek Flash，1M 窗口）

| | v4 | v5 |
|---|---|---|
| 各档输出字数 | 182 / 491 / 1360 / 756 / 551 | 182 / 182 / 182 / 182 / 182 |
| 各档写速（字/秒） | 422–709 乱跳 | 432–464 |
| 128k 档输入 tokens | 76,807（工具清单被摘） | 80,441（含清单） |
| 并发 | 一路被 64 上限判截断 | 三路全过 |
| 压测分 | 0（假失败） | 1399（上下文 4185 / 写速 1122 / 工具 1151 / 并发 709） |
