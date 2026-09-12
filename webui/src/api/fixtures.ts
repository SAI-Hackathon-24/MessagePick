/**
 * 契约对齐的开发期数据源（fixtures）
 * =============================================================================
 * ⚠️ 定位与约束（务必先读）：
 *
 *  · `REQ-019` / `AC-010` 明确「不做演示数据版本」——交付物只接真实微信消息。
 *    因此本文件**不是**产品功能，而是**后端模块（MOD-001 ~ MOD-008）尚未实现期间**
 *    用于前端自测与验收自查的替身：严格按 docs/design 的契约产出数据，
 *    使界面能在真实接口就位前被验证。
 *  · 接入真实后端后，本文件与 `mock.ts` 应一并删除（见 `docs/frontend/README.md`）。
 *  · 本文件不含任何真实微信数据：全部由固定种子伪随机生成，内容为虚构。
 *  · 字段与口径逐条对齐 `api-contract.md` 与 `data-model.md`，不自行发明字段。
 *
 * 生成顺序（与 DM 依赖一致）：群 → 成员身份 → 人 → 原始消息 → 梗 → 提取条目
 * → 兴趣标签 → 画像 → 配对 → 生成历史。
 */
import type {
  DataSource,
  ExtractItem,
  ExtractType,
  Group,
  HeatState,
  InterestCategory,
  InterestTag,
  MemberIdentity,
  MemberInterestHint,
  MemeType,
  MessageKind,
  MonthlyBucket,
  PersonProfile,
  PersonaTrait,
  Priority,
  RawMessage,
  SourceRef,
  TodoState,
} from '@/types';

/* -------------------------------------------------------------------------- */
/* 种子随机（固定种子 → 每次刷新一致，便于复现问题）                              */
/* -------------------------------------------------------------------------- */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rng = makeRng(20260912);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const pickN = <T,>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(rng() * copy.length), 1));
  return out;
};
const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

/** 数据时间基准：2026-03-01 ~ 2026-06-30（与「记录更新至 X」一致） */
export const DATA_START = new Date('2026-03-01T00:00:00+08:00');
export const DATA_END = new Date('2026-06-30T23:59:00+08:00');
export const UPDATED_TO = '2026-06-30T22:15:00+08:00';
/** 采集到的消息总条数（用于「数据量」展示与删除预检计数） */
export const TOTAL_CAPTURED_MESSAGES = 3184;
/** 通讯录 / 好友列表条目数 */
export const TOTAL_CONTACTS = 96;

const at = (dayOffset: number, hour = 12, minute = 0) => {
  const d = new Date(DATA_START.getTime());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const SPAN = Math.round((DATA_END.getTime() - DATA_START.getTime()) / 86400000); // ≈121 天

/* -------------------------------------------------------------------------- */
/* DM-002 群（REQ-004 群多选、REQ-011 按群删除的单位）                            */
/* -------------------------------------------------------------------------- */
export const GROUPS: Group[] = [
  { id: 'g1', name: '24组·聊斋开发群' },
  { id: 'g2', name: '人工智能2401班群' },
  { id: 'g3', name: '算法竞赛集训队' },
  { id: 'g4', name: '宿舍夜话(204)' },
  { id: 'g5', name: '学生会宣传部' },
  { id: 'g6', name: '羽毛球约球群' },
];

const MEMBERS_PER_GROUP: Record<string, string[]> = {
  g1: ['陈禹哲', '蒋驰骋', '杨贺尧', '李沛轩', '刘行健', '杨睿哲', '陈诺', '苏晚意'],
  g2: ['陈禹哲', '杨贺尧', '苏晚意', '周牧之', '林知夏', '何嘉树', '赵一鸣', '孙沐白', '郑寒声', '许亦舟'],
  g3: ['杨贺尧', '李沛轩', '刘行健', '秦昭', '孟繁星', '裴云舟'],
  g4: ['陈禹哲', '蒋驰骋', '杨睿哲', '陈诺', '沈砚清', '唐颂'],
  g5: ['苏晚意', '周牧之', '林知夏', '白露', '顾青梧', '唐颂'],
  g6: ['何嘉树', '赵一鸣', '孙沐白', '秦昭', '孟繁星', '裴云舟'],
};

/** 跨群身份对齐：同一人出现在多个群（未确认映射前按独立个体处理 —— REQ-082） */
export const ME_NAME = '陈禹哲';

/* -------------------------------------------------------------------------- */
/* DM-004 群成员身份 + DM-011 人                                                */
/* -------------------------------------------------------------------------- */
export const MEMBERS: MemberIdentity[] = [];
export const PERSON_NAMES: Record<string, string> = {};
{
  let seq = 0;
  Object.entries(MEMBERS_PER_GROUP).forEach(([groupId, names]) => {
    names.forEach((name) => {
      seq += 1;
      const memberId = `m${seq}`;
      const personId = `p_${name}`;
      MEMBERS.push({
        id: memberId,
        groupId,
        displayName: name,
        isMe: name === ME_NAME && groupId === 'g1',
        personId,
      });
      PERSON_NAMES[personId] = name;
    });
  });
}
/** 人的标识列表（跨群合并单位） */
export const PERSON_IDS = Object.keys(PERSON_NAMES);
export const ME_PERSON_ID = `p_${ME_NAME}`;

export const memberById = (id: string) => MEMBERS.find((m) => m.id === id);

/* -------------------------------------------------------------------------- */
/* DM-003 原始消息记录                                                          */
/* -------------------------------------------------------------------------- */
const TEXT_POOL = [
  '这个需求做不了，先对齐一下',
  '我把词云那块先搭出来，晚上发你看看',
  '已阅，明天找时间看',
  '收到，我改完就推',
  '今晚通宵也要把接口对完',
  '这个梗必须做成表情包哈哈哈',
  '接龙：明天下午三点，A 栋 301，带电脑',
  '缴费截止到周五 18:00，别忘了',
  '我投「深夜废话诗人」一票',
  '羽毛球局还差两个人，来不来',
  '群里谁有往年的真题，求一份',
  '摸鱼被抓到了，笑死',
  '答辩加油，我们稳的',
  '这个 bug 找了一小时，结果是路径写错了',
  '奶茶拼单，21:30 截止，满 8 杯免配送',
  '图书馆研讨间我抢到了，407',
  '老师说明天停课，注意群公告',
  '算法训练赛爆零了，裂开',
  '下次一定，这次真来不及',
  '谁来接个话，话题要冷场了',
];

export const MESSAGES: RawMessage[] = (() => {
  const out: RawMessage[] = [];
  let seq = 0;
  // 每天在每个群产生 2~6 条消息，保证「万条级」演示量（实际约 3k 条，性能验证够用）
  for (let day = 0; day <= SPAN; day += 1) {
    GROUPS.forEach((g) => {
      const count = int(2, 6);
      const groupMembers = MEMBERS.filter((m) => m.groupId === g.id);
      for (let i = 0; i < count; i += 1) {
        seq += 1;
        const sender = pick(groupMembers);
        const kind: MessageKind = rng() < 0.86 ? 'text' : rng() < 0.6 ? 'image' : 'sticker';
        const mentioned = rng() < 0.18 ? [pick(groupMembers).id] : undefined;
        const quoted = rng() < 0.22 && out.length > 0 ? pick(out).id : undefined;
        out.push({
          id: `msg${seq}`,
          groupId: g.id,
          senderId: sender.id,
          senderName: sender.displayName,
          sentAt: at(day, int(8, 23), int(0, 59)),
          kind,
          text: kind === 'text' ? pick(TEXT_POOL) : undefined,
          mediaUrl: kind === 'text' ? undefined : `/api/media/${g.id}/${seq}`,
          mentionedIds: mentioned,
          quotedMessageId: quoted,
        });
      }
    });
  }
  return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
})();

const toRef = (m: RawMessage): SourceRef => ({
  messageId: m.id,
  groupId: m.groupId,
  groupName: GROUPS.find((g) => g.id === m.groupId)?.name ?? m.groupId,
  senderName: m.senderName,
  sentAt: m.sentAt,
  excerpt: m.text ?? (m.kind === 'image' ? '[图片]' : '[表情包]'),
});

/* -------------------------------------------------------------------------- */
/* DM-006 梗 + DM-007 出现记录（模块一）                                         */
/* -------------------------------------------------------------------------- */
interface MemeSeed {
  name: string;
  type: MemeType;
  groupId: string;
  interpretation: string;
  /** 峰值日（dayOffset） */
  peak: number[];
}

const MEME_SEEDS: MemeSeed[] = [
  { name: '已阅', type: 'catchphrase', groupId: 'g1', interpretation: '群里通知刷屏时统一回复的极简回执，带一点「看到了但先不展开」的意味，比「收到」更松弛。', peak: [22, 58, 96] },
  { name: '收到', type: 'catchphrase', groupId: 'g2', interpretation: '标准回执。与「已阅」的区别在于更正式、更可能真的去执行，通常紧跟在老师或组长的通知之后。', peak: [14, 52, 88] },
  { name: '摸鱼', type: 'catchphrase', groupId: 'g1', interpretation: '在应当干活的时间做无关的事，群里多用于自我举报或互相调侃，常与「今天也是努力的一天」连用。', peak: [26, 64, 101] },
  { name: '下次一定', type: 'catchphrase', groupId: 'g6', interpretation: '婉拒约局的固定句式，字面答应、实际不去；衍生说法是「下辈子一定」，表示拒绝得更彻底。', peak: [18, 47, 79] },
  { name: '裂开', type: 'catchphrase', groupId: 'g3', interpretation: '情绪崩溃的夸张表达，多用于代码跑不通、训练赛爆零等场景，现已泛化为一切受挫的通用反应。', peak: [31, 70, 104] },
  { name: '6', type: 'inner', groupId: 'g1', interpretation: '单字回复，可表达赞叹、无语、敷衍等一切情绪，是群内语义密度最高的一个字；单独发送时通常表示「无话可说」。', peak: [9, 33, 55, 78, 110] },
  { name: '拉个会', type: 'inner', groupId: 'g1', interpretation: '不说明议题就要开会，群内黑话；出现即意味着进度不同步，往往需要有人先放下手上的活。', peak: [24, 61] },
  { name: '对齐一下', type: 'inner', groupId: 'g1', interpretation: '把双方理解拉到同一水平线；实际常代指「需求还没定，先聊聊」，是项目群的万能用语。', peak: [28, 66, 99] },
  { name: '虾仁猪心', type: 'inner', groupId: 'g4', interpretation: '「吓人诛心」的谐音梗，形容某人一针见血地戳中痛处，语气是调侃而非指责。', peak: [20, 54, 86] },
  { name: '咕咕咕', type: 'inner', groupId: 'g6', interpretation: '放鸽子的拟声表达；叠加三次表示鸽得非常彻底，是约球群最常用的自嘲方式。', peak: [16, 49, 82] },
  { name: '猫猫震惊', type: 'sticker', groupId: 'g4', interpretation: '群内使用率最高的表情包，几乎可以回应任何消息；作为情绪缓冲垫，避免直接评价带来的尴尬。', peak: [12, 38, 60, 90, 112] },
  { name: '狗头保命', type: 'sticker', groupId: 'g2', interpretation: '加在玩笑话后面的免责声明，表示「我在开玩笑别当真」，多见于吐槽老师或队友之后。', peak: [25, 57, 94] },
  { name: '摸鱼猫', type: 'sticker', groupId: 'g5', interpretation: '一只趴在键盘上的猫，配文「今天也是努力的一天」，是群内摸鱼文化的视觉符号。', peak: [29, 63, 97] },
  { name: '组长', type: 'inner', groupId: 'g1', interpretation: '对陈禹哲的专属称呼，通常伴随「这个怎么弄」出现，已从职务变成一种临场求助的信号。', peak: [11, 41, 72, 108] },
  { name: '来活了', type: 'inner', groupId: 'g5', interpretation: '宣传部的开工暗号；出现即代表又有临时任务派下来，语气里通常带一点无奈。', peak: [17, 51, 84] },
  { name: '答辩PPT', type: 'inner', groupId: 'g1', interpretation: '路演材料，群内先后出现过十几个版本，是「对齐一下」的主要触发源。', peak: [70, 86, 106] },
];

export interface MemeRecord {
  id: string;
  name: string;
  type: MemeType;
  groupId: string;
  interpretation: string;
  occurrences: { messageId: string; memberId: string; at: string }[];
  /** 纠正标记：改判后不再进入词云与统计结果（REQ-035） */
  correction: 'none' | 'not_meme' | 'not_interested' | 'merged' | 'king_wrong';
  mergedTo?: string;
  /** 相关变体（DM-008） */
  variantIds: string[];
}

export const MEMES: MemeRecord[] = MEME_SEEDS.map((seed, idx) => {
  const groupMsgs = MESSAGES.filter((m) => m.groupId === seed.groupId && m.kind === 'text');
  const occurrences: MemeRecord['occurrences'] = [];
  seed.peak.forEach((peakDay) => {
    const window = groupMsgs.filter((m) => {
      const day = Math.round((Date.parse(m.sentAt) - DATA_START.getTime()) / 86400000);
      return Math.abs(day - peakDay) <= 12;
    });
    pickN(window, int(6, 14)).forEach((m) => occurrences.push({ messageId: m.id, memberId: m.senderId, at: m.sentAt }));
  });
  occurrences.sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: `meme${idx + 1}`,
    name: seed.name,
    type: seed.type,
    groupId: seed.groupId,
    interpretation: seed.interpretation,
    occurrences,
    correction: 'none',
    variantIds: [],
  };
});

// 变体关系：同群 + 同类型互为变体（DM-008）
MEMES.forEach((m) => {
  m.variantIds = MEMES.filter((o) => o.id !== m.id && o.groupId === m.groupId && o.type === m.type).slice(0, 3).map((o) => o.id);
});
// 「下次一定」→「下辈子一定」的口径示例（对齐 raw_design §3.4 的举例）
{
  const base = MEMES.find((m) => m.name === '下次一定');
  const derived = MEMES.find((m) => m.name === '裂开');
  if (base && derived && !base.variantIds.includes(derived.id)) base.variantIds.push(derived.id);
}

/* -------------------------------------------------------------------------- */
/* 派生：热度状态 / 生命周期 / 月度分布（DM-006 计算口径）                         */
/* -------------------------------------------------------------------------- */
export const heatStateOf = (lastUsedAt: string, now = DATA_END): HeatState => {
  const days = Math.floor((now.getTime() - Date.parse(lastUsedAt)) / 86400000);
  if (days <= 7) return 'active';
  if (days <= 30) return 'fading';
  return 'silent';
};

export const monthlyOf = (m: MemeRecord): MonthlyBucket[] => {
  const map = new Map<string, number>();
  m.occurrences.forEach((o) => {
    const key = o.at.slice(0, 7);
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  const months = [...map.keys()].sort();
  return months.map((month) => ({
    month,
    count: map.get(month) ?? 0,
    // 不完整月份 = 数据未覆盖整月的边界月（首月 / 末月）
    incomplete: month === DATA_START.toISOString().slice(0, 7) || month === DATA_END.toISOString().slice(0, 7),
  }));
};

export const lifecycleOf = (m: MemeRecord) => {
  const first = m.occurrences[0]?.at ?? at(0);
  const last = m.occurrences[m.occurrences.length - 1]?.at ?? first;
  const monthly = monthlyOf(m);
  const peak = monthly.reduce((best, b) => (b.count > best.count ? b : best), monthly[0] ?? { month: '', count: 0 });
  const peakOccurrence = m.occurrences.find((o) => o.at.slice(0, 7) === peak.month) ?? m.occurrences[0];
  return {
    firstSeenAt: first,
    peakAt: peakOccurrence?.at ?? first,
    silentAt: last,
    activeDays: Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / 86400000)),
  };
};

export const sourceRefsOf = (ids: string[]): SourceRef[] =>
  ids.map((id) => MESSAGES.find((m) => m.id === id)).filter((m): m is RawMessage => !!m).map(toRef);

/* -------------------------------------------------------------------------- */
/* DM-010 提取条目（模块二）                                                     */
/* -------------------------------------------------------------------------- */
interface ExtractSeed {
  type: ExtractType;
  groupId: string;
  subject: string;
  elements: ExtractItem['elements'];
  day: number;
  hour: number;
  priority: Priority;
  todo: TodoState;
}

const EXTRACT_SEEDS: ExtractSeed[] = [
  { type: 'payment', groupId: 'g2', subject: '参赛材料费缴纳', elements: { time: at(6, 9), location: '行政楼 A301', subject: '参赛材料费缴纳 50 元', deadline: at(9, 18) }, day: 6, hour: 9, priority: 'high', todo: 'pending' },
  { type: 'deadline', groupId: 'g1', subject: '黑客松中期材料提交', elements: { subject: '中期材料（PRD 摘要 + 架构图 + 分工表）', deadline: at(12, 20) }, day: 12, hour: 22, priority: 'high', todo: 'done' },
  { type: 'meeting', groupId: 'g1', subject: '第二次路演排练', elements: { time: at(17, 15), location: 'A 栋 301', subject: '第二次路演排练，重点打磨开场' }, day: 17, hour: 13, priority: 'medium', todo: 'pending' },
  { type: 'announcement', groupId: 'g2', subject: '作品仓库提交截止', elements: { subject: '作品须在 6 月 10 日 12:00 前完成仓库提交', deadline: at(23, 12) }, day: 23, hour: 10, priority: 'high', todo: 'pending' },
  { type: 'relay', groupId: 'g6', subject: '周末羽毛球接龙', elements: { time: at(27, 16), location: '西区体育馆 3 号场', subject: '周日 16:00-18:00 场地接龙，需 14:00 前报人数', deadline: at(27, 14) }, day: 27, hour: 11, priority: 'medium', todo: 'pending' },
  { type: 'deadline', groupId: 'g5', subject: '宣传海报初稿', elements: { subject: '海报初稿 A/B 两版 + 300 字说明', deadline: at(31, 12) }, day: 31, hour: 16, priority: 'high', todo: 'pending' },
  { type: 'activity', groupId: 'g3', subject: '图论专题训练赛', elements: { time: at(35, 19), location: '线上评测系统', subject: '图论专题训练赛，赛后当晚交题解' }, day: 35, hour: 18, priority: 'medium', todo: 'pending' },
  { type: 'signup', groupId: 'g2', subject: 'AI 应用赛报名信息收集', elements: { subject: '在线表格填写姓名 / 学号 / 组别', deadline: at(39, 23) }, day: 39, hour: 14, priority: 'high', todo: 'done' },
  { type: 'relay', groupId: 'g4', subject: '奶茶拼单', elements: { location: '3 号楼大厅', subject: '满 8 杯免配送', deadline: at(43, 21) }, day: 43, hour: 20, priority: 'low', todo: 'done' },
  { type: 'vote', groupId: 'g1', subject: '团建地点投票', elements: { subject: '青龙山徒步 / 密室逃脱 / 露营烧烤 三选一', deadline: at(48, 18) }, day: 48, hour: 17, priority: 'medium', todo: 'pending' },
  { type: 'activity', groupId: 'g1', subject: '技术分享：向量检索', elements: { time: at(53, 20), subject: '向量检索在群聊分析中的应用', location: '腾讯会议 391-228-771' }, day: 53, hour: 12, priority: 'medium', todo: 'pending' },
  { type: 'announcement', groupId: 'g1', subject: '图书馆研讨间预约', elements: { time: at(58, 9), location: '图书馆 4 楼 407', subject: '周一 9:00 开放预约，需抢' }, day: 58, hour: 21, priority: 'medium', todo: 'ignored' },
  { type: 'deadline', groupId: 'g2', subject: '期末项目验收', elements: { time: at(66, 14), subject: '10 分钟演示 + 5 分钟提问', deadline: at(65, 23) }, day: 66, hour: 15, priority: 'high', todo: 'pending' },
  { type: 'signup', groupId: 'g2', subject: '大模型讲座报名', elements: { time: at(70, 19), location: '学术报告厅', subject: '大模型应用落地实践，计入创新学分' }, day: 70, hour: 10, priority: 'medium', todo: 'done' },
  { type: 'announcement', groupId: 'g1', subject: '路演顺序抽签结果', elements: { time: at(78, 16), subject: '24 组第 7 个上场，预计 16:20' }, day: 78, hour: 19, priority: 'high', todo: 'pending' },
  { type: 'deadline', groupId: 'g2', subject: '奖学金评定材料', elements: { subject: '成绩单 / 获奖证明 / 志愿时长证明', deadline: at(84, 17) }, day: 84, hour: 11, priority: 'high', todo: 'pending' },
  { type: 'at_all', groupId: 'g4', subject: '宿舍卫生检查', elements: { time: at(88, 21), location: '204 宿舍', subject: '重点查地面与阳台' }, day: 88, hour: 22, priority: 'low', todo: 'pending' },
  { type: 'activity', groupId: 'g5', subject: '校园摄影展征集', elements: { subject: '主题「夏至」，每人限 3 张', deadline: at(92, 23) }, day: 92, hour: 14, priority: 'low', todo: 'ignored' },
  { type: 'meeting', groupId: 'g1', subject: '组内周会', elements: { time: at(100, 20), location: '线上', subject: '同步进度与阻塞' }, day: 100, hour: 18, priority: 'medium', todo: 'pending' },
  { type: 'deadline', groupId: 'g3', subject: '题解提交', elements: { subject: '训练赛题解，当晚 24:00 前', deadline: at(35, 23) }, day: 35, hour: 22, priority: 'medium', todo: 'ignored' },
];

export const EXTRACTS: ExtractItem[] = EXTRACT_SEEDS.map((seed, idx) => {
  const group = GROUPS.find((g) => g.id === seed.groupId)!;
  const groupMsgs = MESSAGES.filter((m) => m.groupId === seed.groupId);
  const sourceCount = int(3, 7);
  const anchor = at(seed.day, seed.hour);
  const sources = pickN(groupMsgs, sourceCount).map(toRef);
  const people = pickN(
    MEMBERS.filter((m) => m.groupId === seed.groupId),
    int(1, 3),
  ).map((m) => ({ memberId: m.id, name: m.displayName }));
  const deadline = seed.elements.deadline;
  // 提醒状态 = 待办未处理 且 当前时间（数据基准）距 DDL ≤ 1 天（DM-010）
  const remindState: ExtractItem['remindState'] =
    seed.todo === 'pending' && deadline && Date.parse(deadline) - DATA_END.getTime() <= 86400000 && Date.parse(deadline) > DATA_END.getTime()
      ? 'remind'
      : 'no_remind';
  return {
    id: `ex${idx + 1}`,
    type: seed.type,
    elements: { ...seed.elements, people },
    subject: seed.subject,
    groupId: seed.groupId,
    groupName: group.name,
    sentAt: anchor,
    summaryLine:
      deadline && Date.parse(deadline) > DATA_END.getTime()
        ? `${seed.subject}：需在 ${deadline.slice(5, 10)} 前完成`
        : `${seed.subject}：${seed.elements.subject ?? ''}`.slice(0, 40),
    aiSummary: `${group.name}提到的「${seed.subject}」。${seed.elements.subject ? `要点：${seed.elements.subject}。` : ''}${
      seed.elements.location ? `地点在${seed.elements.location}。` : ''
    }${deadline ? `截止时间为 ${deadline.slice(0, 16).replace('T', ' ')}。` : ''}该事项在群内被 ${sourceCount} 条消息反复提起，已合并为一条。`,
    priority: seed.priority,
    todoState: seed.todo,
    remindState,
    sourceRefs: sources.sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
  };
});

/* -------------------------------------------------------------------------- */
/* DM-013 兴趣标签 + DM-014 人物兴趣标签（模块三）                                */
/* -------------------------------------------------------------------------- */
const TAG_POOL: { name: string; category: InterestCategory }[] = [
  { name: '羽毛球', category: 'sports' },
  { name: '长跑', category: 'sports' },
  { name: '乒乓球', category: 'sports' },
  { name: '健身', category: 'sports' },
  { name: '摄影', category: 'art' },
  { name: '手绘', category: 'art' },
  { name: '吉他', category: 'art' },
  { name: '黑胶唱片', category: 'art' },
  { name: '算法竞赛', category: 'game' },
  { name: '独立游戏', category: 'game' },
  { name: '桌游', category: 'game' },
  { name: '端游《无畏契约》', category: 'game' },
  { name: '表情包制作', category: 'entertainment' },
  { name: '科幻小说', category: 'entertainment' },
  { name: '电影', category: 'entertainment' },
  { name: '美食探店', category: 'entertainment' },
  { name: '夜宵搭子', category: 'social' },
  { name: '组局张罗', category: 'social' },
  { name: '群聊活跃', category: 'social' },
  { name: '技术分享', category: 'social' },
  { name: '大模型应用', category: 'entertainment' },
  { name: '前端动效', category: 'art' },
];

/** 同义归并组示例（REQ-055）：羽毛球 / 打羽球 / 约球 → 羽毛球 */
const MERGED_ALIASES: Record<string, string[]> = {
  羽毛球: ['打羽球', '约球'],
  算法竞赛: ['刷题', 'ACM'],
  摄影: ['拍照', '扫街'],
};

export const TAGS: InterestTag[] = TAG_POOL.map((t, idx) => {
  // 证据条数越多 → 该标签越可信（提及越多、越可信 —— REQ-080 的口径说明）
  const evidenceCount = int(3, 12);
  const evidence = pickN(MESSAGES.filter((m) => m.kind === 'text'), evidenceCount).map(toRef);
  const confidence = Number(Math.min(0.99, 0.45 + evidenceCount * 0.045 + rng() * 0.1).toFixed(2));
  return {
    tagId: `t${idx + 1}`,
    name: t.name,
    category: t.category,
    confidence,
    evidence,
    origin: MERGED_ALIASES[t.name] ? 'merged' : rng() < 0.15 ? 'manual' : 'extracted',
    mergedFrom: MERGED_ALIASES[t.name],
  };
});

/** 人 → 兴趣（DM-014 是双向索引的唯一数据，正反互为反查 —— REQ-050） */
export const PERSON_TAGS: Record<string, string[]> = Object.fromEntries(
  PERSON_IDS.map((pid) => {
    // 先按一级维度抽样，保证画像至少覆盖 2~3 个维度（避免雷达出现整轴 0 分）
    const categories = pickN(['sports', 'art', 'game', 'entertainment', 'social'] as const, int(2, 3));
    const picked: string[] = [];
    categories.forEach((c) => {
      pickN(TAGS.filter((t) => t.category === c), int(1, 3)).forEach((t) => picked.push(t.tagId));
    });
    // 再补足到 4~7 个标签
    const rest = TAGS.filter((t) => !picked.includes(t.tagId));
    pickN(rest, Math.max(0, int(4, 7) - picked.length)).forEach((t) => picked.push(t.tagId));
    return [pid, [...new Set(picked)]];
  }),
);
/** 发言不足的成员 → 未知，不做推测（REQ-081） */
const UNKNOWN_PERSON_IDS = new Set(PERSON_IDS.filter((_, i) => i % 11 === 5));

export const tagById = (id: string) => TAGS.find((t) => t.tagId === id);

/* -------------------------------------------------------------------------- */
/* 人的活跃度 / 回复时长（DM-011、REQ-057、REQ-066）                              */
/* -------------------------------------------------------------------------- */
const activityOf = (personId: string) =>
  MESSAGES.filter((m) => memberById(m.senderId)?.personId === personId).length;

/**
 * 回复时长（REQ-066 口径）：
 * 以「被 @ 或直接接话」为触发，取该触发消息的**首条**回复间隔的中位数。
 * · 触发消息 = 本人发的消息；触发方式 = 该消息被回复方 @ 或引用；
 * · 排除纯表情回复（图片 / 表情包）与跨天回复（自然日不同）；
 * · 跨群合并到人。
 * 实现上按群遍历，只取每个触发消息的第一条有效响应。
 */
const replyMedianOf = (personId: string): number | undefined => {
  const myMemberIds = new Set(MEMBERS.filter((m) => m.personId === personId).map((m) => m.id));
  const gaps: number[] = [];
  GROUPS.forEach((g) => {
    const msgs = MESSAGES.filter((m) => m.groupId === g.id);
    // 触发消息：本人发出，且其后存在 @ 或引用它的回复
    msgs.forEach((trigger, idx) => {
      if (!myMemberIds.has(trigger.senderId)) return;
      const first = msgs.slice(idx + 1).find((r) => r.kind === 'text' && (r.mentionedIds?.includes(trigger.senderId) || r.quotedMessageId === trigger.id));
      if (!first) return;
      const sameDay = first.sentAt.slice(0, 10) === trigger.sentAt.slice(0, 10);
      if (!sameDay) return; // 排除跨天回复
      const gapMin = Math.round((Date.parse(first.sentAt) - Date.parse(trigger.sentAt)) / 60000);
      if (gapMin > 0 && gapMin <= 240) gaps.push(gapMin);
    });
  });
  if (gaps.length < 3) return undefined;
  gaps.sort((a, b) => a - b);
  return Math.max(1, gaps[Math.floor(gaps.length / 2)]);
};

export const activityCache: Record<string, number> = Object.fromEntries(PERSON_IDS.map((p) => [p, activityOf(p)]));
export const replyCache: Record<string, number | undefined> = Object.fromEntries(PERSON_IDS.map((p) => [p, replyMedianOf(p)]));

/* -------------------------------------------------------------------------- */
/* DM-016 性格标签（六维闭集；候选须确认后才展示 —— REQ-074、REQ-075）             */
/* -------------------------------------------------------------------------- */
export const PERSONA: Record<string, PersonaTrait[]> = Object.fromEntries(
  PERSON_IDS.map((pid) => {
    const traits = pickN(['leadership', 'lively', 'humorous', 'calm', 'rational', 'judgement'] as const, int(2, 4));
    return [
      pid,
      traits.map((trait, i) => ({
        traitId: `${pid}_pt${i + 1}`,
        trait,
        score: int(45, 96),
        // 一半作为候选（未确认不得进入任何产物 —— REQ-075），一半已确认
        status: i % 2 === 0 ? 'confirmed' : 'candidate',
        origin: 'inferred' as const,
      })),
    ];
  }),
);

/* -------------------------------------------------------------------------- */
/* DM-012 身份对齐候选（跨群：同一人不同群昵称不同 —— REQ-082）                     */
/* -------------------------------------------------------------------------- */
export const ALIGNMENT_CANDIDATES = [
  { candidateId: 'ac1', members: [{ memberId: 'm1', groupName: '24组·聊斋开发群', displayName: '陈禹哲' }, { memberId: 'm17', groupName: '人工智能2401班群', displayName: '陈禹哲' }], source: 'group_messages' as DataSource, status: 'confirmed' as const, confirmedAt: at(3, 10) },
  { candidateId: 'ac2', members: [{ memberId: 'm4', groupName: '24组·聊斋开发群', displayName: '李沛轩' }, { memberId: 'm24', groupName: '算法竞赛集训队', displayName: '沛轩·算法' }], source: 'contacts' as DataSource, status: 'unconfirmed' as const },
  { candidateId: 'ac3', members: [{ memberId: 'm9', groupName: '人工智能2401班群', displayName: '苏晚意' }, { memberId: 'm39', groupName: '学生会宣传部', displayName: '宣传部-苏' }], source: 'contacts' as DataSource, status: 'unconfirmed' as const },
  { candidateId: 'ac4', members: [{ memberId: 'm12', groupName: '人工智能2401班群', displayName: '周牧之' }, { memberId: 'm40', groupName: '学生会宣传部', displayName: '牧之' }], source: 'contacts' as DataSource, status: 'rejected' as const },
  { candidateId: 'ac5', members: [{ memberId: 'm6', groupName: '24组·聊斋开发群', displayName: '杨睿哲' }, { memberId: 'm30', groupName: '宿舍夜话(204)', displayName: '睿哲' }], source: 'group_messages' as DataSource, status: 'confirmed' as const, confirmedAt: at(5, 21) },
];

/* -------------------------------------------------------------------------- */
/* 生成历史（DM-020）                                                          */
/* -------------------------------------------------------------------------- */
export const GENERATION_HISTORY = [
  { id: 'gh1', kind: 'G1' as const, memeId: 'meme1', memeName: '已阅', tier: 'pure_template' as const, template: '经典双行', createdAt: at(20, 21), outputs: [], creationMark: true as const },
  { id: 'gh2', kind: 'G2' as const, memeId: 'meme3', memeName: '摸鱼', createdAt: at(28, 15), outputs: [], creationMark: true as const },
  { id: 'gh3', kind: 'G1' as const, memeId: 'meme6', memeName: '6', tier: 'group_image' as const, template: '大字号冲击', createdAt: at(44, 19), outputs: [], creationMark: true as const },
  { id: 'gh4', kind: 'G3' as const, memeName: '（候选）薛定谔的进度', createdAt: at(60, 11), outputs: [], creationMark: true as const },
];

/* -------------------------------------------------------------------------- */
/* 素材合规确认（DM-022）                                                       */
/* -------------------------------------------------------------------------- */
export const MATERIAL_CONSENTS = [
  { consentId: 'mc1', materialRef: 'msg12 中的群内图片', memberId: 'm2', memberName: '蒋驰骋', status: 'unconfirmed' as const },
  { consentId: 'mc2', materialRef: '陈禹哲的群头像', memberId: 'm1', memberName: '陈禹哲', status: 'confirmed' as const, confirmedAt: at(19, 20) },
];

/** 「我」相关的成员兴趣提示（API-029，供消息详情内联 —— REQ-070） */
export const interestHintsOf = (memberIds: string[]): MemberInterestHint[] =>
  memberIds.map((memberId) => {
    const member = memberById(memberId);
    const personId = member?.personId ?? memberId;
    const unknown = UNKNOWN_PERSON_IDS.has(personId);
    const tagIds = unknown ? [] : PERSON_TAGS[personId] ?? [];
    return {
      memberId,
      memberName: member?.displayName ?? personId,
      interests: tagIds
        .map((id) => tagById(id))
        .filter((t): t is InterestTag => !!t)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map((t) => t.name),
      unknown,
    };
  });

/** 供 mock 复用：某人的画像（API-020） */
export function buildProfile(personId: string): PersonProfile {
  const unknown = UNKNOWN_PERSON_IDS.has(personId);
  const tagIds = unknown ? [] : PERSON_TAGS[personId] ?? [];
  const tags = tagIds.map((id) => tagById(id)).filter((t): t is InterestTag => !!t);
  const categoryScores = { sports: 0, art: 0, game: 0, entertainment: 0, social: 0 } as Record<InterestCategory, number>;
  tags.forEach((t) => (categoryScores[t.category] += t.confidence));
  const groups = [...new Set(MEMBERS.filter((m) => m.personId === personId).map((m) => m.groupId))].map((gid) => ({
    groupId: gid,
    groupName: GROUPS.find((g) => g.id === gid)?.name ?? gid,
  }));
  return {
    personId,
    name: PERSON_NAMES[personId] ?? personId,
    isMe: personId === ME_PERSON_ID,
    unknown,
    tags,
    categoryScores,
    personalCloud: tags.map((t) => ({ name: t.name, confidence: t.confidence, category: t.category })),
    personality: (PERSONA[personId] ?? []).filter((p) => p.status === 'confirmed'),
    activity: activityCache[personId] ?? 0,
    replyMedianMinutes: replyCache[personId],
    groups,
  };
}

export const knownPersonIds = () => PERSON_IDS;
export const unknownPersonIds = () => [...UNKNOWN_PERSON_IDS];

export const META = {
  dataStart: DATA_START.toISOString(),
  dataEnd: DATA_END.toISOString(),
  updatedTo: UPDATED_TO,
};
