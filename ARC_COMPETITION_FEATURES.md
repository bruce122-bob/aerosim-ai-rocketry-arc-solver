# ARC 竞赛功能完整实现

根据 ARC 竞赛最佳实践，已完整实现所有关键功能。

## ✅ 已实现的核心功能

### 1. 数据驱动校准系统 (The Digital Twin Loop)

#### 关键校准参数
- **`k_thrust`**: 推力缩放因子
  - 默认值: 1.0 (标称推力)
  - 用途: 校准实际发动机性能与标称值的差异
  - 典型范围: 0.95 - 1.05 (±5%)

- **`k_drag`**: 阻力缩放因子
  - 默认值: 1.12 (已校准到 748ft @ 12°C, 1m/s)
  - 用途: 校准 OpenRocket Cd 与实际飞行的差异
  - 典型范围: 1.05 - 1.15

#### 数据校准函数
```typescript
calibrateFromFlightData(
    rocket: RocketConfig,
    env: Environment,
    flightData: FlightDataPoint[],  // 从高度计导入的数据
    launchAngleDeg?: number,
    railLength?: number,
    initialKThrust?: number,
    initialKDrag?: number
): CalibrationResult
```

**使用方法**:
1. 从高度计导出 CSV 数据（时间, 高度）
2. 转换为 `FlightDataPoint[]` 格式
3. 调用校准函数
4. 获得优化的 `k_thrust` 和 `k_drag`
5. 使用校准后的参数进行后续模拟

**输出**:
- 优化的 `k_thrust` 和 `k_drag`
- RMSE 改进百分比
- 收敛状态

### 2. 蒙特卡洛模拟 (Monte Carlo Simulation)

#### 功能说明
运行数千次仿真，每次随机化关键参数，获得性能概率分布。

#### 蒙特卡洛配置
```typescript
interface MonteCarloConfig {
    numRuns: number;              // 仿真次数 (推荐: 1000-10000)
    windSpeedMean: number;         // 平均风速 (m/s)
    windSpeedStdDev: number;      // 风速标准差 (m/s)
    kThrustMean: number;           // 平均推力缩放
    kThrustStdDev: number;         // 推力缩放标准差 (典型: 0.03 = 3%)
    kDragMean: number;             // 平均阻力缩放
    kDragStdDev: number;           // 阻力缩放标准差 (典型: 0.05 = 5%)
    massVariation: number;         // 质量变化 (±1% = 0.01)
}
```

#### 使用示例
```typescript
const config: MonteCarloConfig = {
    numRuns: 1000,
    windSpeedMean: 1.0,
    windSpeedStdDev: 0.5,
    kThrustMean: 1.0,
    kThrustStdDev: 0.03,  // 3% 发动机性能差异
    kDragMean: 1.12,
    kDragStdDev: 0.05,    // 5% 阻力不确定性
    massVariation: 0.01   // ±1% 质量变化
};

const result = runMonteCarloSimulation(rocket, env, config);
```

#### 输出结果
- **Apogee 统计**: 均值、标准差、最小值、最大值、5%/95% 分位数、中位数
- **Flight Time 统计**: 均值、标准差、最小值、最大值
- **目标达成率**: 达到目标高度（默认 850ft）的概率
- **分布直方图**: 20 个区间的概率分布
- **原始结果**: 每次仿真的详细数据

### 3. 渐进式降落伞展开

#### 实现细节
- **开伞时间**: 0.3 秒（ARC 最佳实践）
- **展开方式**: 线性从 0 到 1 的阻力增长
- **优势**: 
  - 避免瞬时阻力冲击
  - 更真实的物理模拟
  - 对鸡蛋安全分析至关重要

### 4. 随机阵风支持

#### 功能
- 支持 ±2 m/s 的随机阵风
- 为蒙特卡洛模拟做准备
- 可通过 `enableRandomGusts` 开关控制

### 5. 完整物理模型

#### 已实现
- ✅ RK4 数值积分（高精度）
- ✅ ISA 大气模型（随高度变化）
- ✅ 湿度修正（虚拟温度）
- ✅ 风切变模型（幂律，α=0.14）
- ✅ 温度推力修正（0.4%/°C）
- ✅ 攻角效应（Cd_alpha=1.5）
- ✅ 导轨摩擦（2% 能量损失）
- ✅ 马赫数相关阻力（亚音速、跨音速、超音速）
- ✅ OpenRocket Cd 集成（0.546）

## 📊 使用流程（ARC 竞赛最佳实践）

### 第一步：初始校准
1. 进行试飞，记录高度计数据
2. 使用 `calibrateFromFlightData()` 校准 `k_thrust` 和 `k_drag`
3. 保存校准后的参数

### 第二步：蒙特卡洛分析
1. 使用校准后的参数作为 `kThrustMean` 和 `kDragMean`
2. 设置合理的标准差（基于发动机批次差异和测量不确定性）
3. 运行 1000-10000 次蒙特卡洛模拟
4. 分析结果：
   - 最可能达到的高度
   - 达到目标高度的概率
   - 95% 置信区间

### 第三步：优化设计
1. 根据蒙特卡洛结果调整设计
2. 重新运行模拟
3. 迭代直到达到目标概率

## 🎯 关键优势

1. **数据驱动**: 用真实飞行数据校准，而非猜测
2. **不确定性量化**: 蒙特卡洛模拟提供概率分布，而非单一预测
3. **持续改进**: 每次飞行后重新校准，模型越来越准确
4. **竞赛优势**: 知道达到目标高度的概率，而非只是"可能"

## 📝 注意事项

1. **数据质量**: 高度计数据质量直接影响校准效果
2. **环境条件**: 校准时的环境条件应尽量接近比赛条件
3. **多次校准**: 建议用多次飞行数据平均，提高校准可靠性
4. **参数范围**: k_thrust 和 k_drag 应限制在合理范围内（防止过拟合）

## 🔧 技术细节

- **优化算法**: 梯度下降（简单但有效）
- **随机数生成**: Box-Muller 变换（正态分布）
- **单位自动检测**: 自动识别米/英尺
- **收敛判断**: RMSE 改进 < 0.01m 或最大迭代次数

## 📈 预期效果

经过校准后，模拟器预测精度应达到：
- **RMSE**: < 5% (相对于实际飞行高度)
- **目标达成率预测**: ±2% (相对于实际概率)

这些功能使模拟器从"玩具"变成"赢赛工具"！

