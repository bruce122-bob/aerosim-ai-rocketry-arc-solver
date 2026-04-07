# 📚 OpenRocket源码参考指南

## 概述
本文档记录如何参考OpenRocket源码来改进我们的.ork文件解析器。

---

## 🔗 重要资源

### 1. OpenRocket GitHub仓库
- **URL**: https://github.com/openrocket/openrocket
- **语言**: Java
- **主要模块**:
  - `core/src/main/java/info/openrocket/core/file/openrocket/importt/` - 文件导入/导出
  - `core/src/main/java/info/openrocket/core/rocketcomponent/` - 火箭组件类
  - `core/src/main/java/info/openrocket/core/calculation/` - 计算逻辑（CG/CP等）

### 2. 关键Java类

#### 文件解析
- **OpenRocketLoader.java**: 主加载器，负责解析.ork文件
- **OpenRocketContentHandler.java**: XML内容处理器
- **ComponentHandler.java**: 组件解析处理器
- **ComponentParameterHandler.java**: 组件参数解析

#### 组件类
- **BodyTube.java**: 机体管组件
- **NoseCone.java**: 鼻锥组件
- **FinSet.java**: 翼片组件
- **Transition.java**: 过渡段组件

#### 计算类
- **MassCalculator.java**: 质量计算
- **CGCalculator.java**: 重心计算
- **CPCalculator.java**: 压心计算

---

## 📋 .ork文件结构（基于源码分析）

### ZIP结构
```
.ork文件 (ZIP)
├── rocket.ork (XML主文件)
└── [其他资源文件，如贴图等]
```

### XML结构（关键部分）

```xml
<openrocket version="1.x">
  <rocket>
    <name>Rocket Name</name>
    <referencelength>0.xxx</referencelength>  <!-- 参考长度 -->
    <referencetype>maximum</referencetype>     <!-- maximum/nose/custom -->
    
    <!-- CG/CP覆盖值 -->
    <cg>0.xxx</cg>              <!-- 绝对位置（米） -->
    <cp>0.xxx</cp>              <!-- 绝对位置（米） -->
    <overridecg>0.xxx</overridecg>  <!-- 用户手动覆盖 -->
    <overridecp>0.xxx</overridecp>
    
    <stage>
      <name>Stage 1</name>
      <subcomponents>
        <nosecone>
          <name>Nose Cone</name>
          <position type="top">0.0</position>  <!-- 相对位置 -->
          <length>0.xxx</length>
          <aftradius>0.xxx</aftradius>  <!-- 底部半径 -->
          <mass>0.xxx</mass>
          <overridemass>0.xxx</overridemass>  <!-- 用户覆盖 -->
          <!-- ... -->
        </nosecone>
        <!-- 更多组件 -->
      </subcomponents>
    </stage>
    
    <motorconfiguration>
      <motor>
        <designation>F42T</designation>
        <thrustcurve>
          <datapoint>
            <time>0.0</time>
            <thrust>0.0</thrust>
          </datapoint>
          <!-- 更多数据点 -->
        </thrustcurve>
      </motor>
    </motorconfiguration>
    
    <simulations>
      <simulation>
        <flightdata>
          <cg>0.xxx</cg>    <!-- 计算出的CG -->
          <cp>0.xxx</cp>    <!-- 计算出的CP -->
        </flightdata>
        <flightconditions>
          <cg>0.xxx</cg>    <!-- 初始条件CG -->
          <cp>0.xxx</cp>    <!-- 初始条件CP -->
        </flightconditions>
      </simulation>
    </simulations>
  </rocket>
</openrocket>
```

---

## 🎯 关键发现（基于源码）

### 1. 位置系统（Position System）

OpenRocket使用**相对位置系统**：
- `position type="top"`: 相对于父组件顶部
- `position type="bottom"`: 相对于父组件底部
- `position type="middle"`: 相对于父组件中心
- `position type="after"`: 在父组件之后（我们映射为absolute）

**实现要点**：
- 位置是递归计算的
- 每个组件的位置 = 父组件位置 + 相对偏移
- 绝对位置用于CG/CP计算

### 2. CG/CP存储位置

**优先级**（从高到低）：
1. `simulation/flightdata/cg` - 最新计算结果（最准确）
2. `simulation/flightconditions/cg` - 初始条件
3. `rocket/overridecg` - 用户手动覆盖
4. `rocket/cg` - 直接设置的值
5. `stage/cg` - Stage级别的值

**重要**：
- OpenRocket的CG/CP是**绝对位置**（从鼻锥顶部开始，单位：米）
- 如果使用`referenceLength`，CG/CP可能相对于参考长度
- 最新的simulation结果通常是最准确的

### 3. ReferenceLength和ReferenceType

**ReferenceLength**：
- 用于稳定性计算
- 默认值：最大直径
- 可以从`referencelength`标签读取，或从最大组件直径计算

**ReferenceType**：
- `maximum`: 使用最大直径（默认）
- `nose`: 使用鼻锥长度
- `custom`: 用户自定义值

### 4. 质量提取优先级

1. `overridemass` - 用户手动覆盖（最准确）
2. `mass` - 直接质量标签
3. `componentmass` - 组件质量
4. 根据几何和材料密度估算

### 5. 推力曲线格式

OpenRocket支持多种推力曲线格式：
- `<datapoint><time>...</time><thrust>...</thrust></datapoint>` (标准)
- 可能还有其他变体

---

## 🔧 我们的改进（基于源码参考）

### 已实施的改进

1. **增强的CG/CP提取**：
   - 从后往前遍历simulation（最新的在最后）
   - 支持多种标签名（cg, centerofgravity等）
   - 优先级系统选择最佳值

2. **改进的位置解析**：
   - 支持OpenRocket的所有position类型
   - 处理"auto"位置
   - 记录相对参考点

3. **ReferenceLength处理**：
   - 从标签读取或从最大直径计算
   - 支持所有referenceType值
   - 用于稳定性计算

4. **增强的推力曲线解析**：
   - 支持多种标签名
   - 多种数据格式（子元素、属性、文本）
   - 数据验证和清理

---

## 📖 参考文档

### OpenRocket开发者文档
- **文件格式规范**: https://openrocket.readthedocs.io/en/latest/dev_guide/file_specification.html
- **开发者指南**: https://wiki.openrocket.info/Developer's_Guide

### 第三方工具
- **RocketSerializer** (Python): https://github.com/RocketPy-Team/RocketSerializer
  - 可以将.ork转换为JSON
  - 用于验证解析逻辑

### 社区资源
- **OpenRocket论坛**: https://www.rocketryforum.com/
- **GitHub Issues**: https://github.com/openrocket/openrocket/issues

---

## 🎯 未来改进方向

### 1. 直接调用OpenRocket API（如果使用Java）
- 嵌入OpenRocket类库
- 通过API读取.ork文件
- 获得准确的组件位置、质量、几何信息

### 2. 使用RocketSerializer验证
- 用RocketSerializer转换.ork到JSON
- 对比我们的解析结果
- 找出差异并修复

### 3. 更完整的组件支持
- Freeform Fins
- Elliptical Fins
- Tube Fins
- Pods

### 4. 更准确的计算
- 参考OpenRocket的CG/CP计算逻辑
- 实现相同的几何计算
- 确保结果一致

---

## 💡 使用建议

### 验证解析结果
1. 用OpenRocket打开.ork文件
2. 记录CG/CP值
3. 用我们的解析器读取
4. 对比结果

### 调试技巧
1. 查看控制台日志（详细的解析步骤）
2. 检查CG/CP来源（显示在日志中）
3. 验证referenceLength是否正确
4. 检查组件位置是否正确

### 报告问题
如果解析结果与OpenRocket不一致：
1. 提供.ork文件
2. 提供OpenRocket中的值
3. 提供我们解析出的值
4. 检查控制台日志

---

*最后更新: 2025-12-08*
*基于: OpenRocket源码分析*






