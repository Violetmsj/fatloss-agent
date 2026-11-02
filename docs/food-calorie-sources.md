# 食物热量数据来源

本项目默认不随源码分发食物成分数据，也不会在安装或启动时自动下载。个人学习或研究时，可手动执行：

```bash
npm run food-data:sync
# 自定义插件数据目录时，必须传入同一路径
npm run food-data:sync -- --data-directory /绝对路径/减脂存储目录
```

脚本从 [Sanotsu/china-food-composition-data](https://github.com/Sanotsu/china-food-composition-data) 的固定提交 `d15675c27582748307023b7ee7aca2a63fc52756` 下载[增强矫正版完整 CSV](https://github.com/Sanotsu/china-food-composition-data/blob/d15675c27582748307023b7ee7aca2a63fc52756/json_data_v3_20260825_qwen38max_kimi_k3_fixed_en/food_composition_full.csv)，校验 SHA-256 和 1677 条记录后写入DSH 存储目录下的 `reference/`（默认 `~/.dsh/storages/fatloss-agent/reference/`）。原仓库未提供清晰的软件许可证；使用前请自行核对其最新版权说明。本项目仅将其作为用户主动下载的个人学习研究资料，不主张对数据的权利。

数据按每 100 克可食部分给出营养值，适合常见中国食材，但 OCR、模型矫正和原始资料本身都可能存在误差，也不覆盖多数外卖混合菜。名称相近且无法可靠区分时，程序会要求用户选择；无可靠匹配或属于混合菜时才降级为联网估算。估算结果必须展示假设、区间和来源，并由用户确认后才能记录。

运动无设备活动热量时，联网步骤只负责根据运动描述匹配 MET 或 MET 区间；程序再按 [Compendium 换算说明](https://pacompendium.com/unite-conversions/)使用固定公式计算活动热量。联网搜索使用 DSH 宿主已配置的 `web_search`，在独立检索子 Agent 内执行；不继承用户画像、写库工具或主聊天。提供方和凭据由宿主管理。
