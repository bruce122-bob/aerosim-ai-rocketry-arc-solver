# 🚀 OpenRocket文件解析器改进报告

## 目标
提升OpenRocket .ork文件解析器的兼容性、健壮性和准确性，支持更多OpenRocket版本和文件格式。

---

## ✅ 已实施的改进

### 1. **增强的ZIP文件解压** 📦

#### 改进前：
- 简单的文件查找逻辑
- 有限的错误处理
- 只支持少数文件名

#### 改进后：
- **扩展的文件名支持**：支持更多可能的文件名
  - `rocket.ork`, `document.xml`, `rocket.xml`
  - `openrocket.xml`, `design.xml`, `data.xml`
- **智能文件匹配**：
  - 按文件大小和相关性评分
  - 优先选择包含"rocket"关键词的文件
  - 按大小排序，优先大文件
- **增强的错误处理**：
  - 详细的错误信息
  - 列出ZIP文件中的所有文件
  - 提供修复建议

**代码改进**：
```typescript
// 扩展的文件名列表
const possibleFiles = [
  'rocket.ork', 'document.xml', 'rocket.xml',
  'openrocket.xml', 'design.xml', 'data.xml'
];

// 智能匹配和评分
const score = size + (fileName.includes('rocket') ? 1000 : 0);
```

---

### 2. **增强的XML解析** 📄

#### 改进前：
- 简单的两种MIME类型尝试
- 有限的错误信息
- 不支持编码问题修复

#### 改进后：
- **多种MIME类型支持**：
  - `application/xml`
  - `text/xml`
  - `application/xhtml+xml`
- **XML清理**：
  - 自动移除BOM (Byte Order Mark)
  - 自动添加XML声明（如果缺失）
  - 处理编码问题
- **详细的错误报告**：
  - 显示错误行号和列号
  - 提供修复建议
  - 更友好的错误消息

**代码改进**：
```typescript
// 清理XML文本
let cleanedText = text.trim();
if (cleanedText.charCodeAt(0) === 0xFEFF) {
  cleanedText = cleanedText.slice(1); // 移除BOM
}
if (!cleanedText.startsWith('<?xml')) {
  cleanedText = '<?xml version="1.0" encoding="UTF-8"?>\n' + cleanedText;
}
```

---

### 3. **扩展的材料数据库** 🧱

#### 改进前：
- 仅支持15种材料
- 简单的精确匹配
- 不支持材料变体

#### 改进后：
- **50+种材料支持**：
  - 3D打印材料：PLA, PETG, ABS, TPU, Nylon等
  - 传统材料：Balsa, Plywood, Fiberglass等
  - 复合材料：G10, Carbon Fiber等
  - 降落伞材料：Ripstop Nylon, Tyvek等
  - 减震绳材料：Kevlar, Nylon Cord等
- **智能材料匹配**：
  - 精确匹配
  - 大小写不敏感匹配
  - 部分匹配（关键词匹配）
  - 支持材料变体

**代码改进**：
```typescript
const findMaterialDensity = (matName: string, defaultDensity: number): number => {
  // 精确匹配
  if (MATERIAL_DENSITIES[matName]) return MATERIAL_DENSITIES[matName];
  
  // 大小写不敏感匹配
  // 部分匹配（关键词）
  // ...
};
```

**新增材料示例**：
- `PLA+`, `PETG`, `TPU` (3D打印)
- `G10 Fiberglass`, `Carbon Fiber Tube` (复合材料)
- `Tyvek`, `Polyester` (降落伞)
- `Kevlar Cord`, `Nylon Rope` (减震绳)

---

### 4. **增强的推力曲线解析** 📈

#### 改进前：
- 只支持`datapoint`标签
- 简单的子元素解析
- 缺失数据时使用简化曲线

#### 改进后：
- **多种标签名支持**：
  - `datapoint` (标准)
  - `thrustpoint`, `point`, `data` (变体)
  - `thrustcurve` (容器)
- **多种数据格式支持**：
  - 子元素标签 (`<time>`, `<thrust>`)
  - XML属性 (`time="...", thrust="..."`)
  - 文本内容（空格/逗号分隔）
- **数据验证和清理**：
  - 自动排序（按时间）
  - 确保第一个点在t=0
  - 确保最后一个点在burnTime
  - 验证数据有效性

**代码改进**：
```typescript
// 尝试多种可能的标签名
const possibleThrustCurveTags = [
  'datapoint', 'thrustpoint', 'point', 'data', 'thrustcurve'
];

// 多种解析方式
// 方法1: 子元素标签
// 方法2: XML属性
// 方法3: 文本内容
```

---

### 5. **改进的Cd提取** 🎯

#### 改进前：
- 只从2个位置提取
- 简单的优先级
- 无来源追踪

#### 改进后：
- **多位置提取**（按优先级）：
  1. `stage/overridecd` (最准确，用户手动设置)
  2. `rocket/overridecd`
  3. `rocket/cd`
  4. `flightconfiguration/cd`
  5. `simulation/flightdata/cd` (最新计算结果)
- **智能选择**：
  - 优先使用overridecd（用户设置）
  - 其次使用simulation结果（最新计算）
  - 最后使用其他值
- **来源追踪**：
  - 记录Cd值的来源
  - 显示所有候选值
  - 便于调试和验证

**代码改进**：
```typescript
const cdCandidates: Array<{ value: number, source: string }> = [];

// 从多个位置提取
// 优先级1: stage/overridecd
// 优先级2: rocket/overridecd
// ...

// 智能选择最佳值
const overrideCd = cdCandidates.find(c => c.source.includes('overridecd'));
```

---

### 6. **改进的错误报告** ⚠️

#### 改进前：
- 简单的错误消息
- 无修复建议
- 有限的调试信息

#### 改进后：
- **详细的错误信息**：
  - 显示错误位置（行号、列号）
  - 列出ZIP文件内容
  - 显示XML结构预览
- **修复建议**：
  - 检查文件是否损坏
  - 建议重新保存文件
  - 检查OpenRocket版本
- **调试信息**：
  - 文件大小和格式
  - 解析步骤日志
  - 找到的数据点数量

**示例错误消息**：
```
XML解析失败。请确保这是有效的OpenRocket .ork文件。
错误详情: ... (行 123, 列 45)

建议:
1. 检查文件是否损坏
2. 尝试在OpenRocket中重新保存文件
3. 确保使用OpenRocket 1.0或更高版本
```

---

## 📊 改进效果

### 兼容性提升
- **ZIP文件支持**：从3种文件名扩展到6种+智能匹配
- **XML格式支持**：从2种MIME类型扩展到3种+自动修复
- **材料支持**：从15种扩展到50+种
- **推力曲线格式**：从1种扩展到5种+多种数据格式

### 准确性提升
- **Cd提取**：从2个位置扩展到5个位置，智能选择最佳值
- **推力曲线**：更准确的数据解析和验证
- **材料匹配**：智能匹配，支持变体和部分匹配

### 健壮性提升
- **错误处理**：更详细的错误信息和修复建议
- **数据验证**：自动验证和清理数据
- **容错能力**：支持多种格式变体和缺失数据

---

## 🔧 技术细节

### 文件结构
```
services/orkParser.ts
├── extractXMLFromZip()      # ZIP解压（增强版）
├── parseORKFile()             # 主解析函数（增强版）
├── parseStages()              # Stage解析
├── parseComponents()          # 组件解析
├── parseComponent()           # 单个组件解析（增强材料匹配）
├── parseMotorConfiguration()  # Motor解析（增强推力曲线和Cd提取）
└── MATERIAL_DENSITIES         # 扩展的材料数据库
```

### 关键改进点
1. **智能文件查找**：评分系统选择最佳文件
2. **XML清理**：自动修复常见问题
3. **材料智能匹配**：多级匹配策略
4. **推力曲线多格式**：支持多种标签和数据格式
5. **Cd多源提取**：优先级系统选择最佳值

---

## 🎯 使用建议

### 1. 文件准备
- 使用OpenRocket 1.0或更高版本保存文件
- 确保文件未损坏
- 如果解析失败，尝试在OpenRocket中重新保存

### 2. 材料设置
- 使用标准材料名称（如"PLA"而非"PLA 3D打印"）
- 如果材料未识别，系统会使用默认密度
- 检查控制台日志查看材料匹配情况

### 3. 推力曲线
- 确保.ork文件包含完整的推力曲线数据
- 如果缺失，系统会使用平均推力创建简化曲线
- 检查控制台日志查看推力曲线解析情况

### 4. Cd值
- 优先使用OpenRocket计算的Cd值（来自simulation）
- 可以手动设置overridecd覆盖
- 检查控制台日志查看Cd值来源

---

## 📚 未来改进方向

1. **更多组件类型支持**：
   - Freeform Fins
   - Elliptical Fins
   - Tube Fins
   - Pods

2. **更智能的数据验证**：
   - 自动检测数据异常
   - 提供数据修复建议
   - 验证数据一致性

3. **性能优化**：
   - 大文件解析优化
   - 增量解析
   - 缓存机制

4. **更多格式支持**：
   - RockSim文件格式
   - RASAero文件格式
   - 自定义格式

---

*最后更新: 2025-12-08*
*版本: 2.0 (Enhanced ORK Parser)*






