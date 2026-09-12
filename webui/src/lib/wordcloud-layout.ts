/**
 * 词云布局算法 —— 阿基米德螺旋 + 包围盒碰撞检测
 * 纯计算，无依赖；输出带坐标的词条，交由 WordCloud 组件渲染。
 */
export interface CloudWord<T> {
  item: T;
  text: string;
  /** 字号 px */
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: 0 | 90;
  /** 是否成功放入（放不下的词条会被丢弃，由调用方决定是否回退为列表） */
  placed: boolean;
}

export interface CloudLayoutOptions {
  width: number;
  height: number;
  minSize?: number;
  maxSize?: number;
  /** 允许竖排的比例 0~1 */
  rotateRatio?: number;
  /** 字体族，用于估算文本宽度 */
  fontFamily?: string;
  /** 权重 → 字号的映射指数，>1 更突出高频词 */
  scaleExponent?: number;
  padding?: number;
}

/** 粗略估算文本宽度：中文按 1em，英文/数字按 0.55em */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    units += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.56;
  }
  return units * fontSize;
}

export function layoutCloud<T>(
  items: T[],
  getText: (item: T) => string,
  getWeight: (item: T) => number,
  opts: CloudLayoutOptions,
): CloudWord<T>[] {
  const { width, height, minSize = 14, maxSize = 54, rotateRatio = 0.18, scaleExponent = 1, padding = 4 } = opts;

  if (!items.length || width <= 0 || height <= 0) return [];

  const weights = items.map(getWeight);
  const maxW = Math.max(...weights);
  const minW = Math.min(...weights);

  const sized = items
    .map((item, i) => {
      const t = maxW === minW ? 1 : (weights[i] - minW) / (maxW - minW);
      const size = minSize + Math.pow(t, scaleExponent) * (maxSize - minSize);
      return { item, text: getText(item), size };
    })
    .sort((a, b) => b.size - a.size);

  const placed: CloudWord<T>[] = [];
  const cx = width / 2;
  const cy = height / 2;

  sized.forEach((word, index) => {
    const wantRotate = index % Math.max(2, Math.round(1 / rotateRatio)) === 1;
    const textW = estimateTextWidth(word.text, word.size);
    const textH = word.size * 1.08;

    // 先尝试横排，失败再尝试竖排（保证词云更紧凑）
    const candidates: (0 | 90)[] = wantRotate ? [90, 0] : [0, 90];

    for (const rotate of candidates) {
      const w = (rotate === 90 ? textH : textW) + padding;
      const h = (rotate === 90 ? textW : textH) + padding;

      // 阿基米德螺旋搜索空位
      for (let step = 0; step < 900; step++) {
        const angle = step * 0.32;
        const radius = 0.85 * angle;
        const x = cx + radius * Math.cos(angle) * 1.5 - w / 2;
        const y = cy + radius * Math.sin(angle) * 0.85 - h / 2;
        if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
        const box = { x, y, w, h };
        const collides = placed.some((p) => !(box.x + box.w < p.x || p.x + p.w < box.x || box.y + box.h < p.y || p.y + p.h < box.y));
        if (!collides) {
          placed.push({ ...word, x, y, w, h, rotate, placed: true });
          return;
        }
      }
    }
    // 放不下：标记未放置，调用方回退处理
    placed.push({ ...word, x: 0, y: 0, w: 0, h: 0, rotate: 0, placed: false });
  });

  return placed;
}
