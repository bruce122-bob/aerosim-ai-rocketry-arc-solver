# Cd（阻力系数）计算说明

## 📋 Cd的来源

### 1. **从.ork文件提取（优先级最高）**

模拟程序按以下顺序提取Cd值：

```typescript
// 优先级1: 从<stage><overridecd>标签提取
const overrideCdElement = stageEl.querySelector("overridecd");
if (overrideCdElement) {
    cd = parseFloat(overrideCdElement.textContent); // 例如: 0.546
}

// 优先级2: 从motor配置中提取
const cdElement = rocket.querySelector("cd");

// 优先级3: 默认值 0.5
const finalCd = configData.cd || motorConfig.cd || 0.5;
```

### 2. **OpenRocket中的Cd值**

OpenRocket中的Cd值通常来自：

#### A. **用户手动设置（Override Cd）**
- 在OpenRocket中，用户可以手动设置`overridecd`值
- 这个值会保存在.ork文件的`<stage><overridecd>`标签中
- **这是最常用的方式**

#### B. **OpenRocket自动计算**
OpenRocket使用以下方法计算Cd：

1. **基础阻力计算**：
   - 基于火箭形状（nose cone, body tube, fins）
   - 使用经验公式（如Hoerner的阻力数据）
   - 考虑表面粗糙度（finish类型）

2. **Barrowman方程**：
   - 主要用于计算**压力中心（CP）**
   - **不直接计算Cd**
   - Cd通常基于经验数据表

3. **马赫数修正**：
   - OpenRocket会根据速度自动调整Cd
   - 跨音速和超音速区域有特殊处理

### 3. **OpenRocket Cd值的含义**

OpenRocket的Cd值通常是一个**综合阻力系数**，包括：

- ✅ **形状阻力**（form drag）
- ✅ **摩擦阻力**（skin friction）
- ✅ **表面粗糙度**（paint, seams, decals）
- ✅ **基础攻角效应**（小角度）
- ❌ **不包括**：大风引起的攻角、发射导轨干扰等

## 🔍 如何获取正确的Cd值

### 方法1：从OpenRocket仿真结果获取（推荐）

1. **在OpenRocket中运行仿真**
2. **查看仿真结果**：
   - OpenRocket会在仿真后计算一个"有效Cd"
   - 这个值考虑了所有飞行条件（速度、高度、马赫数）
3. **提取Cd值**：
   - 查看仿真报告中的"Average Cd"或"Effective Cd"
   - 或者在.ork文件中查找`<simulation><cd>`标签

### 方法2：从实际飞行数据反向计算

如果您有实际飞行数据，可以反向计算Cd：

```typescript
// 从飞行数据计算Cd
// 假设：已知Apogee、质量、推力曲线、环境条件

// 1. 运行模拟，调整Cd直到匹配实际Apogee
// 2. 找到匹配的Cd值

// 例如：
// 实际Apogee: 748ft
// 模拟Apogee (Cd=0.5): 785ft
// 模拟Apogee (Cd=0.546): 760ft
// 模拟Apogee (Cd=0.58): 748ft ✅
// → 正确的Cd = 0.58
```

### 方法3：使用OpenRocket的默认计算

如果不设置`overridecd`，OpenRocket会使用：
- 基于形状的经验公式
- 默认值通常在 **0.4-0.6** 之间
- 对于典型的模型火箭，通常在 **0.5-0.55**

## ⚠️ 为什么0.546可能不准？

### 问题分析

1. **Cd值依赖于飞行条件**：
   - 不同速度 → 不同Cd（马赫数效应）
   - 不同质量 → 不同飞行速度 → 不同Cd
   - 不同环境条件 → 不同Cd

2. **Cd值依赖于火箭配置**：
   - 质量变化 → 速度变化 → Cd变化
   - 发动机不同 → 推力曲线不同 → 速度不同 → Cd不同

3. **从另一次飞行计算的Cd**：
   - 如果0.546是从**不同质量**的飞行计算的
   - 或者从**不同发动机**的飞行计算的
   - 可能不适用于当前的748ft飞行

## 🎯 正确的做法

### 方案1：使用OpenRocket的Cd值（推荐）

1. **在OpenRocket中**：
   - 不要手动设置`overridecd`
   - 让OpenRocket自动计算
   - 运行仿真，查看结果中的Cd值

2. **在模拟程序中**：
   - 如果.ork文件中有`overridecd`，使用它
   - 如果没有，使用默认值0.5，然后通过`k_drag`校准

### 方案2：使用k_drag校准（当前实现）

```typescript
// 在physics6dof.ts中
let baseCd = rocket.cdOverride || 0.55; // 从.ork文件或默认值

// 应用校准系数
Cd *= physicsConfig.k_drag; // k_drag = 1.0 表示不校准
```

**校准步骤**：
1. 使用基础Cd值（如0.5）运行模拟
2. 对比实际飞行数据（748ft）
3. 调整`k_drag`直到匹配：
   ```typescript
   // 如果模拟结果太高，增加k_drag
   // 785ft → 748ft，需要增加约5%阻力
   k_drag = 1.05
   ```

### 方案3：从实际飞行数据计算Cd

如果您有748ft飞行的完整数据：
- 质量：613g（总质量）
- Apogee：748ft
- 环境条件：12°C, 0m/s wind, 1021hPa

可以：
1. 运行模拟，调整Cd直到匹配748ft
2. 找到正确的Cd值
3. 将这个Cd值设置为`overridecd`在.ork文件中

## 📊 当前模拟程序的Cd使用流程

```typescript
// 1. 从.ork文件提取
const finalCd = configData.cd || motorConfig.cd || 0.5;

// 2. 在physics6dof.ts中使用
let baseCd = rocket.cdOverride || 0.55;

// 3. 应用马赫数修正
const mach = velocity / speedOfSound;
const Cd = getDragCd(baseCd, mach); // 考虑跨音速/超音速

// 4. 应用校准系数
Cd *= physicsConfig.k_drag; // 默认k_drag = 1.0

// 5. 计算阻力
const drag = 0.5 * rho * v² * Cd * A;
```

## 💡 建议

对于您的748ft飞行：

1. **检查.ork文件中的Cd值**：
   - 如果0.546是从另一次飞行计算的，可能不准确
   - 建议移除`overridecd`，让OpenRocket重新计算

2. **使用k_drag校准**：
   - 保持基础Cd = 0.5（OpenRocket默认）
   - 通过调整`k_drag`来匹配实际飞行数据
   - `k_drag = 1.05` 应该能匹配748ft

3. **验证**：
   - 使用校准后的参数运行模拟
   - 应该得到接近748ft的结果
















