/**
 * 静态演示数据源（**仅供静态示范站使用，不进正式构建**）
 * =============================================================================
 * 用途：让**最新版界面**在没有任何后端、没有模型 Key、没有微信数据的情况下也能完整演示。
 *
 * 实现方式：本文件与 `api/index.ts` **同接口**（导出 `api` 与 `apiMode`），
 * 由 `vite.demo.config.ts` 用 `alias` 把 `@/api` 指到本文件。
 * 因此页面组件是**未改动的正式源码**，只有数据来源被替换 —— 界面与仓库版本严格一致。
 *
 * 数据说明（重要）
 * · 全部为**虚构数据**：群名、昵称、梗、条目内容均为合成，不含任何真实聊天内容。
 * · 仅**规模与形态**参考真实使用情形（多群、成员长尾分布、梗的月度起伏、
 *   条目类型分布、DDL 临近与过期并存等），使界面看起来像真实运行的结果。
 * · 时间锚点固定为 2026-09，便于截图与讲解稳定复现。
 */
import type {
  AnalysisScopeView,
  DataFlowNotice,
  DeletePrecheck,
  DeleteResult,
  DeleteScope,
  ExtractItem,
  GatheringSuggestion,
  GenerationHistoryItem,
  GlobalFilter,
  Group,
  IdentityAlignmentCandidate,
  InterestCategory,
  InterestEventStream,
  InterestPeopleResult,
  InterestScoreCard,
  InterestTag,
  LifecycleView,
  MaterialConsent,
  MemeCloudEntry,
  MemeCloudResult,
  MemeKingBoard,
  MemeKingRow,
  MemeUnit,
  MemeYearbook,
  MemberInterestHint,
  MessageContext,
  MessageDetail,
  MyCompatibility,
  NoticeDimension,
  PairMatch,
  Paged,
  PersonProfile,
  PersonaPanel,
  Priority,
  RelationGraph,
  SourceRef,
  TodoState,
  UpdateResult,
  UpdateStatus,
} from '@/types';
import { INTEREST_CATEGORIES, INTEREST_CATEGORY_LABEL } from '@/types';
import type { DataVolume, DueTodoView, OperationSnapshot } from './index';

/* ========================================================================== */
/* 基础工具                                                                    */
/* ========================================================================== */

type Envelope<T> = { ok: true; data: T } | { ok: false; data: null; error: { code: string; message: string; hint?: string } };

const ok = <T,>(data: T): Envelope<T> => ({ ok: true, data });
const fail = (code: string, message: string): Envelope<never> => ({ ok: false, data: null, error: { code, message } });

/** 数据锚点：演示数据集中在 2026-03 ~ 2026-09 这 7 个月。 */
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'] as const;
const DATA_END = new Date('2026-09-13T22:15:00+08:00');

/** 稳定的伪随机（同一 seed 永远同样的结果，保证截图可复现）。 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 相对数据锚点回推 n 天，返回 ISO 串。 */
function daysAgo(days: number, hour = 20, minute = 0): string {
  const d = new Date(DATA_END.getTime() - days * 86_400_000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/* ========================================================================== */
/* 群与成员（虚构）                                                             */
/* ========================================================================== */

interface DemoGroup {
  id: string;
  name: string;
  /** 消息量（用于「按最近活跃排序」与统计卡） */
  messages: number;
  /** 最近活跃距今的天数 */
  lastDays: number;
  /** 该群的核心兴趣（取自 36 个二级标签）—— 决定群的「圈子」，标签分配按此聚集 */
  coreTags: string[];
}

/** 22 个群，按最近活跃倒序（与正式版 `/api/filter-options/groups` 的排序口径一致）。 */
const GROUPS: DemoGroup[] = [
  { id: 'g01', name: '极客松24组-回声', messages: 1024, lastDays: 0, coreTags: ['算法竞赛', '大模型应用', '技术分享', '桌游'] },
  { id: 'g02', name: '东23栋楼栋通知群', messages: 1180, lastDays: 1, coreTags: ['夜宵搭子', '桌游'] },
  { id: 'g03', name: '2026级工科年级大群', messages: 1362, lastDays: 1, coreTags: ['算法竞赛', '自习结伴', '技术分享'] },
  { id: 'g04', name: '人工智能学院本科年级群', messages: 742, lastDays: 2, coreTags: ['大模型应用', '算法竞赛', '技术分享'] },
  { id: 'g05', name: '创客营｜首期动手做', messages: 96, lastDays: 2, coreTags: ['大模型应用', '独立游戏', '剪辑'] },
  { id: 'g06', name: '羽毛球固定局', messages: 418, lastDays: 3, coreTags: ['羽毛球', '乒乓球'] },
  { id: 'g07', name: '食堂测评小分队', messages: 356, lastDays: 3, coreTags: ['美食探店', '夜宵搭子'] },
  { id: 'g08', name: '考研自习搭子', messages: 288, lastDays: 4, coreTags: ['自习结伴', '写作', '书法'] },
  { id: 'g09', name: '实验室搬砖日常', messages: 512, lastDays: 5, coreTags: ['大模型应用', '技术分享', '算法竞赛'] },
  { id: 'g10', name: '桌游周末局', messages: 244, lastDays: 6, coreTags: ['桌游', '密室逃脱', '推理小说'] },
  { id: 'g11', name: '摄影约拍群', messages: 187, lastDays: 8, coreTags: ['摄影', '徒步'] },
  { id: 'g12', name: '跑步打卡互助', messages: 302, lastDays: 9, coreTags: ['跑步', '健身房'] },
  { id: 'g13', name: '实习信息互通', messages: 421, lastDays: 11, coreTags: ['技术分享', '剪辑', '写作'] },
  { id: 'g14', name: '校园跑腿互助', messages: 168, lastDays: 13, coreTags: ['拼车通勤', '宿舍串门'] },
  { id: 'g15', name: '宿舍楼二手交易', messages: 233, lastDays: 15, coreTags: ['二手置换', '宿舍串门'] },
  { id: 'g16', name: '期末复习资料分享', messages: 396, lastDays: 18, coreTags: ['自习结伴', '写作', '书法'] },
  { id: 'g17', name: '动漫同好交流', messages: 275, lastDays: 21, coreTags: ['动漫', '独立游戏', '手游《明日方舟》'] },
  { id: 'g18', name: '健身搭子招募', messages: 142, lastDays: 25, coreTags: ['健身房', '游泳'] },
  { id: 'g19', name: '英语角口语练习', messages: 118, lastDays: 29, coreTags: ['科幻电影', '写作'] },
  { id: 'g20', name: '音乐现场拼票', messages: 87, lastDays: 34, coreTags: ['音乐现场', '黑胶'] },
  { id: 'g21', name: '老同学闲聊群', messages: 164, lastDays: 41, coreTags: ['拼图', '夜宵搭子'] },
  { id: 'g22', name: '毕业旅行筹备', messages: 209, lastDays: 52, coreTags: ['骑行', '摄影', '徒步'] },
];

const groupName = (id: string): string => GROUPS.find((g) => g.id === id)?.name ?? id;

/** 48 位虚构成员（昵称取自常见中文昵称风格，与真实用户无关）。 */
const MEMBERS: { id: string; name: string; activity: number; groups: string[] }[] = [
  { id: 'p01', name: '陈屿', activity: 386, groups: ['g01', 'g03', 'g04', 'g09'] },
  { id: 'p02', name: '林知遥', activity: 342, groups: ['g01', 'g03', 'g06', 'g12'] },
  { id: 'p03', name: '苏禾', activity: 315, groups: ['g02', 'g03', 'g07'] },
  { id: 'p04', name: '周聿', activity: 298, groups: ['g01', 'g09', 'g13'] },
  { id: 'p05', name: '何砚', activity: 271, groups: ['g03', 'g11', 'g17'] },
  { id: 'p06', name: '沈以蓝', activity: 264, groups: ['g02', 'g06', 'g12', 'g18'] },
  { id: 'p07', name: '叶行舟', activity: 247, groups: ['g01', 'g10', 'g17'] },
  { id: 'p08', name: '许简', activity: 231, groups: ['g04', 'g09', 'g16'] },
  { id: 'p09', name: '罗一鸣', activity: 218, groups: ['g03', 'g05', 'g13'] },
  { id: 'p10', name: '唐栗', activity: 205, groups: ['g07', 'g11', 'g20'] },
  { id: 'p11', name: '钱屿森', activity: 197, groups: ['g02', 'g15', 'g22'] },
  { id: 'p12', name: '孟青禾', activity: 186, groups: ['g06', 'g07', 'g12'] },
  { id: 'p13', name: '顾南', activity: 178, groups: ['g01', 'g04', 'g16'] },
  { id: 'p14', name: '严晏', activity: 165, groups: ['g09', 'g10', 'g13'] },
  { id: 'p15', name: '崔屿白', activity: 158, groups: ['g03', 'g17', 'g20'] },
  { id: 'p16', name: '范知', activity: 149, groups: ['g02', 'g08', 'g16'] },
  { id: 'p17', name: '尹澈', activity: 141, groups: ['g11', 'g17', 'g19'] },
  { id: 'p18', name: '章闻笛', activity: 133, groups: ['g06', 'g18'] },
  { id: 'p19', name: '洪拾', activity: 126, groups: ['g12', 'g14'] },
  { id: 'p20', name: '邓叙', activity: 118, groups: ['g04', 'g13', 'g19'] },
  { id: 'p21', name: '白鸽', activity: 112, groups: ['g07', 'g10'] },
  { id: 'p22', name: '徐见山', activity: 104, groups: ['g01', 'g09'] },
  { id: 'p23', name: '袁野', activity: 98, groups: ['g14', 'g15'] },
  { id: 'p24', name: '傅时', activity: 92, groups: ['g03', 'g22'] },
  { id: 'p25', name: '石青', activity: 86, groups: ['g11', 'g20'] },
  { id: 'p26', name: '万泱', activity: 81, groups: ['g16', 'g19'] },
  { id: 'p27', name: '穆迟', activity: 76, groups: ['g06', 'g12'] },
  { id: 'p28', name: '骆一', activity: 71, groups: ['g13', 'g15'] },
  { id: 'p29', name: '高杉', activity: 66, groups: ['g10', 'g17'] },
  { id: 'p30', name: '谢知微', activity: 61, groups: ['g02', 'g22'] },
  { id: 'p31', name: '韩澈', activity: 57, groups: ['g05', 'g19'] },
  { id: 'p32', name: '曹青野', activity: 52, groups: ['g14', 'g21'] },
  { id: 'p33', name: '卫屿', activity: 48, groups: ['g08', 'g16'] },
  { id: 'p34', name: '梁亦', activity: 44, groups: ['g15', 'g21'] },
  { id: 'p35', name: '任乔', activity: 39, groups: ['g07', 'g20'] },
  { id: 'p36', name: '于野', activity: 35, groups: ['g18', 'g22'] },
  { id: 'p37', name: '邹行', activity: 31, groups: ['g21'] },
  { id: 'p38', name: '贺兰', activity: 27, groups: ['g17'] },
  { id: 'p39', name: '龚屿', activity: 23, groups: ['g14'] },
  { id: 'p40', name: '孙漪', activity: 19, groups: ['g19'] },
  // 长尾：发言极少 → 界面应显示「未知」而不是瞎猜
  { id: 'p41', name: '小满', activity: 9, groups: ['g15'] },
  { id: 'p42', name: '阿柚', activity: 7, groups: ['g21'] },
  { id: 'p43', name: '冬青', activity: 5, groups: ['g20'] },
  { id: 'p44', name: '林间', activity: 4, groups: ['g22'] },
  { id: 'p45', name: '木子', activity: 3, groups: ['g21'] },
  { id: 'p46', name: '小柯', activity: 2, groups: ['g02'] },
  { id: 'p47', name: '阿泽', activity: 2, groups: ['g03'] },
  { id: 'p48', name: '南风', activity: 1, groups: ['g01'] },
];

const ME = 'p01';
const memberName = (id: string): string => MEMBERS.find((m) => m.id === id)?.name ?? id;

/** 未知成员（发言不足）：界面按 REQ-081 标注「未知」，不做推测。 */
const UNKNOWN_IDS = new Set(['p41', 'p42', 'p43', 'p44', 'p45', 'p46', 'p47', 'p48']);

/* ========================================================================== */
/* 兴趣标签（虚构）                                                             */
/* ========================================================================== */

interface DemoTag {
  name: string;
  category: InterestCategory;
}

/**
 * 36 个二级标签 —— 比演示版原量翻倍。
 * 归类按使用者的裁定：`game` 只含**具体游戏作品**；`entertainment` 收影视 / 动漫 /
 * 智力爱好（算法竞赛、编程等）；`social` 是「和谁一起」类。
 */
const TAGS: DemoTag[] = [
  // 运动
  { name: '羽毛球', category: 'sports' },
  { name: '跑步', category: 'sports' },
  { name: '篮球', category: 'sports' },
  { name: '游泳', category: 'sports' },
  { name: '健身房', category: 'sports' },
  { name: '骑行', category: 'sports' },
  { name: '徒步', category: 'sports' },
  { name: '乒乓球', category: 'sports' },
  // 艺术
  { name: '手绘', category: 'art' },
  { name: '摄影', category: 'art' },
  { name: '吉他', category: 'art' },
  { name: '黑胶', category: 'art' },
  { name: '写作', category: 'art' },
  { name: '书法', category: 'art' },
  { name: '剪辑', category: 'art' },
  // 游戏（只放具体作品）
  { name: '独立游戏', category: 'game' },
  { name: '桌游', category: 'game' },
  { name: '端游《无畏契约》', category: 'game' },
  { name: '手游《明日方舟》', category: 'game' },
  { name: '端游《永劫无间》', category: 'game' },
  // 娱乐（含智力爱好）
  { name: '算法竞赛', category: 'entertainment' },
  { name: '大模型应用', category: 'entertainment' },
  { name: '动漫', category: 'entertainment' },
  { name: '科幻电影', category: 'entertainment' },
  { name: '美食探店', category: 'entertainment' },
  { name: '密室逃脱', category: 'entertainment' },
  { name: '推理小说', category: 'entertainment' },
  { name: '音乐现场', category: 'entertainment' },
  { name: '拼图', category: 'entertainment' },
  // 社交
  { name: '夜宵搭子', category: 'social' },
  { name: '组局张罗', category: 'social' },
  { name: '自习结伴', category: 'social' },
  { name: '技术分享', category: 'social' },
  { name: '拼车通勤', category: 'social' },
  { name: '二手置换', category: 'social' },
  { name: '宿舍串门', category: 'social' },
];

const tagIdOf = (name: string): string => `tag_${name}`;

/* ========================================================================== */
/* 梗（虚构，30 个）                                                            */
/* ========================================================================== */

interface DemoMeme {
  id: string;
  name: string;
  type: 'catchphrase' | 'inner' | 'sticker';
  groupId: string;
  interpretation: string;
  /** 月份 → 次数 */
  monthly: number[];
  /** 首现距今天数 */
  firstDays: number;
  /** 最近使用距今天数 */
  lastDays: number;
  /** 主要使用者与次数 */
  users: { id: string; count: number }[];
  highlights: { sender: string; text: string; days: number; kind: 'text' | 'image' | 'sticker' }[];
}

const MEMES: DemoMeme[] = [
  {
    id: 'm01', name: '几号机好了', type: 'catchphrase', groupId: 'g01',
    interpretation: '出自共享实验设备排队，后来变成催进度的通用说法，任何等待都能用。',
    monthly: [18, 22, 26, 31, 24, 19, 14], firstDays: 186, lastDays: 0,
    users: [{ id: 'p01', count: 34 }, { id: 'p04', count: 27 }, { id: 'p09', count: 19 }],
    highlights: [
      { sender: 'p01', text: '几号机好了？（第 3 次问）', days: 2, kind: 'text' },
      { sender: 'p04', text: '几号机好了，我的数据还在跑', days: 5, kind: 'text' },
      { sender: 'p09', text: '几号机好了.jpg', days: 9, kind: 'image' },
    ],
  },
  {
    id: 'm02', name: '二餐', type: 'inner', groupId: 'g01',
    interpretation: '第二食堂的简称，常与「今天去哪吃」绑定，逐渐成为午饭的代称。',
    monthly: [12, 16, 21, 25, 22, 18, 16], firstDays: 178, lastDays: 0,
    users: [{ id: 'p02', count: 22 }, { id: 'p13', count: 15 }, { id: 'p22', count: 11 }],
    highlights: [
      { sender: 'p02', text: '二餐走不走', days: 1, kind: 'text' },
      { sender: 'p13', text: '二餐今天有排骨', days: 4, kind: 'text' },
    ],
  },
  {
    id: 'm03', name: '盆', type: 'inner', groupId: 'g07',
    interpretation: '源自某次误把「盆」当作计量单位，之后形容分量多用「盆」计数。',
    monthly: [8, 11, 14, 19, 21, 17, 13], firstDays: 165, lastDays: 1,
    users: [{ id: 'p03', count: 19 }, { id: 'p10', count: 14 }, { id: 'p21', count: 9 }],
    highlights: [{ sender: 'p03', text: '这一盆够四个人吃', days: 3, kind: 'text' }],
  },
  {
    id: 'm04', name: '瑞幸', type: 'inner', groupId: 'g03',
    interpretation: '自习时段的固定动作，后来直接代指「去自习」。',
    monthly: [15, 19, 23, 28, 26, 20, 17], firstDays: 172, lastDays: 1,
    users: [{ id: 'p05', count: 24 }, { id: 'p16', count: 18 }, { id: 'p08', count: 13 }],
    highlights: [{ sender: 'p05', text: '瑞幸吗，我请', days: 2, kind: 'text' }],
  },
  {
    id: 'm05', name: '放哪个盆/桶里', type: 'catchphrase', groupId: 'g15',
    interpretation: '二手群里的分类梗，泛指「这事归谁管」。',
    monthly: [4, 7, 9, 14, 16, 12, 9], firstDays: 158, lastDays: 2,
    users: [{ id: 'p11', count: 16 }, { id: 'p23', count: 12 }],
    highlights: [{ sender: 'p11', text: '这个放哪个盆/桶里', days: 6, kind: 'text' }],
  },
  {
    id: 'm06', name: '加塞', type: 'catchphrase', groupId: 'g13',
    interpretation: '实习信息刷屏时的调侃，形容突然插播一条无关消息。',
    monthly: [5, 8, 12, 17, 19, 15, 11], firstDays: 150, lastDays: 3,
    users: [{ id: 'p04', count: 18 }, { id: 'p20', count: 13 }],
    highlights: [{ sender: 'p04', text: '容我加塞一条内推', days: 7, kind: 'text' }],
  },
  {
    id: 'm07', name: '对齐一下', type: 'catchphrase', groupId: 'g01',
    interpretation: '开会用语流入日常，用于任何需要同步信息的场合。',
    monthly: [9, 13, 16, 22, 25, 21, 18], firstDays: 168, lastDays: 0,
    users: [{ id: 'p01', count: 26 }, { id: 'p07', count: 17 }, { id: 'p14', count: 12 }],
    highlights: [{ sender: 'p01', text: '先对齐一下明天谁带电脑', days: 0, kind: 'text' }],
  },
  {
    id: 'm08', name: '来活了', type: 'catchphrase', groupId: 'g09',
    interpretation: '收到临时任务时的自嘲，后接一句「我先哭一会」。',
    monthly: [11, 14, 18, 24, 27, 23, 19], firstDays: 175, lastDays: 0,
    users: [{ id: 'p04', count: 28 }, { id: 'p08', count: 19 }, { id: 'p22', count: 14 }],
    highlights: [{ sender: 'p04', text: '来活了，今晚别等我', days: 1, kind: 'text' }],
  },
  {
    id: 'm09', name: '猫猫震惊', type: 'sticker', groupId: 'g01',
    interpretation: '一张震惊猫表情包，用于表达「这也行？」。',
    monthly: [13, 17, 21, 29, 33, 28, 24], firstDays: 182, lastDays: 0,
    users: [{ id: 'p01', count: 31 }, { id: 'p02', count: 24 }, { id: 'p07', count: 21 }],
    highlights: [{ sender: 'p01', text: '', days: 0, kind: 'image' }],
  },
  {
    id: 'm10', name: '虾仁猪心', type: 'catchphrase', groupId: 'g04',
    interpretation: '「杀人诛心」的谐音，用于被一句话精准打击时。',
    monthly: [7, 10, 13, 18, 20, 16, 13], firstDays: 160, lastDays: 2,
    users: [{ id: 'p08', count: 17 }, { id: 'p13', count: 13 }],
    highlights: [{ sender: 'p08', text: '真实，虾仁猪心', days: 4, kind: 'text' }],
  },
  {
    id: 'm11', name: '组长', type: 'inner', groupId: 'g01',
    interpretation: '小组负责人的称呼，后来变成任何「背锅位」的代称。',
    monthly: [6, 9, 12, 15, 17, 14, 11], firstDays: 155, lastDays: 1,
    users: [{ id: 'p07', count: 15 }, { id: 'p01', count: 12 }],
    highlights: [{ sender: 'p07', text: '这活归组长', days: 3, kind: 'text' }],
  },
  {
    id: 'm12', name: '裂开', type: 'catchphrase', groupId: 'g16',
    interpretation: '考试周高频词，形容精神状态的临界点。',
    monthly: [10, 12, 16, 26, 22, 18, 15], firstDays: 148, lastDays: 2,
    users: [{ id: 'p08', count: 19 }, { id: 'p16', count: 16 }, { id: 'p33', count: 11 }],
    highlights: [{ sender: 'p16', text: '复习到裂开', days: 5, kind: 'text' }],
  },
  {
    id: 'm13', name: '已阅', type: 'catchphrase', groupId: 'g03',
    interpretation: '群通知刷屏时的最短回复，等价于「知道了别 @ 我」。',
    monthly: [14, 18, 22, 27, 25, 20, 16], firstDays: 170, lastDays: 0,
    users: [{ id: 'p03', count: 23 }, { id: 'p05', count: 18 }, { id: 'p24', count: 12 }],
    highlights: [{ sender: 'p03', text: '已阅', days: 0, kind: 'text' }],
  },
  {
    id: 'm14', name: '收到', type: 'catchphrase', groupId: 'g02',
    interpretation: '与「已阅」并列的极简回复，通知类消息的默认回执。',
    monthly: [16, 20, 24, 29, 27, 22, 19], firstDays: 176, lastDays: 0,
    users: [{ id: 'p11', count: 25 }, { id: 'p30', count: 16 }, { id: 'p06', count: 14 }],
    highlights: [{ sender: 'p11', text: '收到', days: 0, kind: 'text' }],
  },
  {
    id: 'm15', name: '狗头保命', type: 'sticker', groupId: 'g17',
    interpretation: '说完可能挨打的话后补一张狗头，表示开玩笑。',
    monthly: [5, 8, 11, 14, 16, 13, 11], firstDays: 145, lastDays: 3,
    users: [{ id: 'p05', count: 14 }, { id: 'p15', count: 12 }, { id: 'p17', count: 9 }],
    highlights: [{ sender: 'p05', text: '', days: 8, kind: 'sticker' }],
  },
  {
    id: 'm16', name: '咕咕咕', type: 'catchphrase', groupId: 'g10',
    interpretation: '放鸽子的拟声，源自「咕咕」= 爽约。',
    monthly: [4, 6, 9, 12, 14, 11, 8], firstDays: 140, lastDays: 4,
    users: [{ id: 'p07', count: 13 }, { id: 'p29', count: 10 }],
    highlights: [{ sender: 'p07', text: '我可能要咕咕咕了', days: 9, kind: 'text' }],
  },
  {
    id: 'm17', name: '答辩 PPT', type: 'inner', groupId: 'g04',
    interpretation: '泛指任何临时赶工的交付物。',
    monthly: [3, 5, 8, 13, 15, 12, 10], firstDays: 136, lastDays: 2,
    users: [{ id: 'p08', count: 15 }, { id: 'p20', count: 11 }],
    highlights: [{ sender: 'p08', text: '答辩 PPT 还没开始', days: 6, kind: 'text' }],
  },
  {
    id: 'm18', name: '拉个会', type: 'catchphrase', groupId: 'g05',
    interpretation: '项目推进受阻时的万能动作。',
    monthly: [2, 4, 7, 11, 13, 10, 9], firstDays: 130, lastDays: 3,
    users: [{ id: 'p09', count: 13 }, { id: 'p31', count: 9 }],
    highlights: [{ sender: 'p09', text: '要不拉个会同步下', days: 7, kind: 'text' }],
  },
  {
    id: 'm19', name: '下次一定', type: 'catchphrase', groupId: 'g06',
    interpretation: '拒绝邀约的礼貌说法，等价于「不去」。',
    monthly: [3, 5, 7, 9, 11, 9, 7], firstDays: 128, lastDays: 5,
    users: [{ id: 'p02', count: 11 }, { id: 'p18', count: 8 }],
    highlights: [{ sender: 'p02', text: '下次一定（不去）', days: 12, kind: 'text' }],
  },
  {
    id: 'm20', name: '摸鱼猫', type: 'sticker', groupId: 'g09',
    interpretation: '一只瘫在键盘上的猫，用于表达「在忙但没完全忙」。',
    monthly: [9, 12, 15, 18, 20, 16, 13], firstDays: 162, lastDays: 1,
    users: [{ id: 'p14', count: 18 }, { id: 'p22', count: 14 }, { id: 'p04', count: 11 }],
    highlights: [{ sender: 'p14', text: '', days: 2, kind: 'image' }],
  },
  {
    id: 'm21', name: '对齐颗粒度', type: 'catchphrase', groupId: 'g13',
    interpretation: '黑话梗，用于调侃过度使用术语的场合。',
    monthly: [2, 3, 6, 9, 11, 9, 7], firstDays: 122, lastDays: 6,
    users: [{ id: 'p20', count: 11 }, { id: 'p09', count: 8 }],
    highlights: [{ sender: 'p20', text: '先对齐颗粒度（狗头）', days: 14, kind: 'text' }],
  },
  {
    id: 'm22', name: '狠狠拿下', type: 'catchphrase', groupId: 'g12',
    interpretation: '跑步打卡成功后的固定说法。',
    monthly: [6, 9, 11, 14, 16, 13, 11], firstDays: 132, lastDays: 2,
    users: [{ id: 'p06', count: 16 }, { id: 'p12', count: 12 }, { id: 'p27', count: 9 }],
    highlights: [{ sender: 'p06', text: '五公里狠狠拿下', days: 3, kind: 'text' }],
  },
  {
    id: 'm23', name: '拼一拼', type: 'catchphrase', groupId: 'g20',
    interpretation: '拼票 / 拼单的简称，也用于临时凑人。',
    monthly: [2, 3, 5, 7, 8, 7, 5], firstDays: 118, lastDays: 8,
    users: [{ id: 'p10', count: 9 }, { id: 'p25', count: 7 }, { id: 'p35', count: 4 }],
    highlights: [{ sender: 'p10', text: '有拼音乐节票的吗', days: 16, kind: 'text' }],
  },
  {
    id: 'm24', name: '这题我会', type: 'catchphrase', groupId: 'g16',
    interpretation: '抢答用语，后接一句其实并不会。',
    monthly: [4, 6, 8, 11, 12, 10, 8], firstDays: 124, lastDays: 4,
    users: [{ id: 'p26', count: 12 }, { id: 'p16', count: 10 }, { id: 'p33', count: 7 }],
    highlights: [{ sender: 'p26', text: '这题我会（并不会）', days: 11, kind: 'text' }],
  },
  {
    id: 'm25', name: '打个样', type: 'catchphrase', groupId: 'g11',
    interpretation: '约拍时的试拍，也指先做一版看看。',
    monthly: [2, 3, 4, 6, 7, 5, 4], firstDays: 112, lastDays: 9,
    users: [{ id: 'p10', count: 8 }, { id: 'p17', count: 6 }],
    highlights: [{ sender: 'p10', text: '先打个样看看光', days: 18, kind: 'text' }],
  },
  {
    id: 'm26', name: '换个性别', type: 'inner', groupId: 'g17',
    interpretation: '动漫群里对某角色设定的调侃，与真实性别无关。',
    monthly: [3, 4, 6, 8, 9, 7, 5], firstDays: 108, lastDays: 7,
    users: [{ id: 'p15', count: 9 }, { id: 'p38', count: 6 }],
    highlights: [{ sender: 'p15', text: '换个性别我就认', days: 20, kind: 'text' }],
  },
  {
    id: 'm27', name: '进厂了', type: 'catchphrase', groupId: 'g13',
    interpretation: '拿到实习 offer 的自嘲说法。',
    monthly: [2, 3, 4, 6, 7, 6, 4], firstDays: 104, lastDays: 10,
    users: [{ id: 'p28', count: 8 }, { id: 'p04', count: 6 }],
    highlights: [{ sender: 'p28', text: '我进厂了，先撤', days: 22, kind: 'text' }],
  },
  {
    id: 'm28', name: '求带', type: 'catchphrase', groupId: 'g10',
    interpretation: '桌游 / 游戏缺人时的通用召唤。',
    monthly: [3, 5, 6, 8, 7, 6, 4], firstDays: 96, lastDays: 12,
    users: [{ id: 'p29', count: 9 }, { id: 'p07', count: 7 }, { id: 'p21', count: 5 }],
    highlights: [{ sender: 'p29', text: '周末桌游求带', days: 25, kind: 'text' }],
  },
  {
    id: 'm29', name: '锁了', type: 'catchphrase', groupId: 'g06',
    interpretation: '场地 / 时间的「已定」，源自订场成功。',
    monthly: [2, 4, 5, 7, 8, 6, 4], firstDays: 92, lastDays: 14,
    users: [{ id: 'p18', count: 8 }, { id: 'p06', count: 6 }],
    highlights: [{ sender: 'p18', text: '场地锁了，周六下午', days: 28, kind: 'text' }],
  },
  {
    id: 'm30', name: '摆烂了', type: 'catchphrase', groupId: 'g08',
    interpretation: '考研压力下的自嘲，与「躺平」近义。',
    monthly: [2, 3, 4, 6, 6, 5, 3], firstDays: 86, lastDays: 17,
    users: [{ id: 'p33', count: 7 }, { id: 'p16', count: 5 }],
    highlights: [{ sender: 'p33', text: '今天彻底摆烂了', days: 33, kind: 'text' }],
  },
];

/* ========================================================================== */
/* 提取条目（虚构，40 条）                                                      */
/* ========================================================================== */

interface DemoExtract {
  id: string;
  groupId: string;
  type: ExtractItem['type'];
  subject: string;
  summary: string;
  ai: string;
  days: number;
  priority: Priority;
  todo: TodoState;
  deadlineDays?: number;
  people?: string[];
  time?: string;
  location?: string;
}

const EXTRACTS: DemoExtract[] = [
  { id: 'e01', groupId: 'g01', type: 'vote', subject: '回顾页方案', summary: '针对做一个全屏翻页式回顾页（类似年度报告）的提议征求大家意见', ai: '提出做全屏翻页回顾页，含 6 页与分享卡片；请在群内投票表态。', days: 0, priority: 'high', todo: 'pending', deadlineDays: 2, people: ['p01', 'p04', 'p09'] },
  { id: 'e02', groupId: 'g02', type: 'at_all', subject: '人员呼叫', summary: '要求李沛轩回复用电登记', ai: '楼栋长 @ 相关人员，要求在今晚前回复用电登记信息。', days: 0, priority: 'high', todo: 'pending', deadlineDays: 1, people: ['p11'] },
  { id: 'e03', groupId: 'g03', type: 'announcement', subject: 'UI 改造需求', summary: '前端改造需求第三批共 8 项，请自查', ai: '发布第三批前端改造需求 8 项，含移除冗余入口、统一搜索占位符等，要求在迭代内自查完成。', days: 0, priority: 'medium', todo: 'pending', deadlineDays: 5 },
  { id: 'e04', groupId: 'g04', type: 'deadline', subject: '课程作业提交', summary: '人工智能导论实验报告本周五 23:59 截止', ai: '实验报告截止时间为本周五 23:59，逾期不接受补交。', days: 1, priority: 'high', todo: 'pending', deadlineDays: 3 },
  { id: 'e05', groupId: 'g05', type: 'signup', subject: '创客营报名', summary: '首期创客营开放报名，限 30 人', ai: '创客营开放报名，限额 30 人，先到先得。', days: 1, priority: 'medium', todo: 'done' },
  { id: 'e06', groupId: 'g06', type: 'activity', subject: '羽毛球场地', summary: '周六下午 2-4 点场地已订，缺 2 人', ai: '周六 14:00-16:00 场地已订，目前 4 人，还缺 2 人。', days: 1, priority: 'medium', todo: 'pending', deadlineDays: 2, location: '东区体育馆 3 号场' },
  { id: 'e07', groupId: 'g07', type: 'activity', subject: '聚餐探店', summary: '周五晚新开的川菜馆，征集人数', ai: '拟周五晚去新开川菜馆，需统计人数以订位。', days: 2, priority: 'low', todo: 'pending', deadlineDays: 3 },
  { id: 'e08', groupId: 'g08', type: 'meeting', subject: '自习室占座', summary: '图书馆四楼明早 7 点集合占座', ai: '明早 7 点在图书馆四楼集合占座，需 2 人提前到。', days: 2, priority: 'medium', todo: 'pending', deadlineDays: 1, location: '图书馆四楼', time: '明日 07:00' },
  { id: 'e09', groupId: 'g09', type: 'relay', subject: '值日接龙', summary: '本周实验室值日接龙，尚缺 1 人', ai: '本周值日需要 5 人，接龙目前 4 人，缺 1 人。', days: 2, priority: 'low', todo: 'pending', deadlineDays: 2 },
  { id: 'e10', groupId: 'g10', type: 'signup', subject: '桌游局报名', summary: '周六桌游局报名 6 人已满', ai: '周六桌游局报名已满 6 人，候补可在群内接龙。', days: 3, priority: 'low', todo: 'done' },
  { id: 'e11', groupId: 'g11', type: 'activity', subject: '约拍计划', summary: '周日下午校园银杏约拍，招模特 2 名', ai: '周日 15:00 校园银杏道约拍，招模特 2 名，自备服装。', days: 3, priority: 'low', todo: 'pending', deadlineDays: 4 },
  { id: 'e12', groupId: 'g12', type: 'activity', subject: '跑步打卡', summary: '本周跑量打卡截至周日，未交的补上', ai: '本周跑量打卡周日截止，未提交的请补交截图。', days: 3, priority: 'medium', todo: 'pending', deadlineDays: 2 },
  { id: 'e13', groupId: 'g13', type: 'announcement', subject: '内推信息', summary: '某厂暑期实习内推开放，截止月底', ai: '暑期实习内推开放，简历投递截止本月底，需附项目经历。', days: 4, priority: 'high', todo: 'pending', deadlineDays: 9 },
  { id: 'e14', groupId: 'g14', type: 'other', subject: '代取快递', summary: '有人可代取西区快递，5 元一次', ai: '提供西区快递代取，5 元一次，需提前一小时说。', days: 4, priority: 'low', todo: 'ignored' },
  { id: 'e15', groupId: 'g15', type: 'other', subject: '二手出清', summary: '出显示器一台，可小刀', ai: '出一台 27 寸显示器，价格可议，仅限自提。', days: 5, priority: 'low', todo: 'pending' },
  { id: 'e16', groupId: 'g16', type: 'announcement', subject: '复习资料', summary: '期末复习资料已上传群文件，含往年题', ai: '复习资料与往年真题已上传群文件，请自行下载。', days: 5, priority: 'medium', todo: 'pending' },
  { id: 'e17', groupId: 'g17', type: 'activity', subject: '漫展拼车', summary: '下周末漫展拼车，还差 2 人', ai: '下周末漫展计划拼车前往，目前 2 人，还差 2 人分摊。', days: 6, priority: 'low', todo: 'pending', deadlineDays: 7 },
  { id: 'e18', groupId: 'g18', type: 'signup', subject: '健身打卡', summary: '健身打卡活动报名，坚持 21 天有奖', ai: '发起 21 天健身打卡活动，报名后可领纪念品。', days: 6, priority: 'low', todo: 'done' },
  { id: 'e19', groupId: 'g19', type: 'meeting', subject: '英语角', summary: '周三晚英语角主题：面试口语', ai: '周三 19:00 英语角，主题为面试口语，需提前准备自我介绍。', days: 7, priority: 'medium', todo: 'pending', location: '文科楼 302', deadlineDays: 2 },
  { id: 'e20', groupId: 'g20', type: 'payment', subject: '音乐节拼票', summary: '音乐节门票拼单，需先付定金', ai: '音乐节拼单购票，需先付定金锁位，余款入场前结清。', days: 7, priority: 'medium', todo: 'pending', deadlineDays: 6 },
  { id: 'e21', groupId: 'g21', type: 'activity', subject: '老同学聚会', summary: '国庆假期聚会，统计到场人数', ai: '拟国庆假期组织聚会，需统计到场人数以便订位。', days: 8, priority: 'low', todo: 'pending', deadlineDays: 12 },
  { id: 'e22', groupId: 'g22', type: 'announcement', subject: '行程确认', summary: '毕业旅行路线三选一，请投票', ai: '给出三条毕业旅行路线，请群内投票确定。', days: 8, priority: 'medium', todo: 'pending', deadlineDays: 10 },
  { id: 'e23', groupId: 'g01', type: 'meeting', subject: '站会时间', summary: '明早 9 点半站会，改到线上', ai: '站会改为明早 9:30 线上进行，链接见群公告。', days: 9, priority: 'high', todo: 'done' },
  { id: 'e24', groupId: 'g02', type: 'announcement', subject: '水电检修', summary: '周四上午停水检修，请提前储水', ai: '周四上午楼栋停水检修，请提前储水。', days: 9, priority: 'medium', todo: 'done' },
  { id: 'e25', groupId: 'g03', type: 'deadline', subject: '选课截止', summary: '退补选本周日 24:00 截止', ai: '退补选通道周日 24:00 关闭，逾期不再受理。', days: 10, priority: 'high', todo: 'done', deadlineDays: 4 },
  { id: 'e26', groupId: 'g04', type: 'vote', subject: '实验分组', summary: '实验分组方案投票，今晚截止', ai: '两种实验分组方案投票，今晚 22:00 截止。', days: 10, priority: 'medium', todo: 'done' },
  { id: 'e27', groupId: 'g05', type: 'relay', subject: '物料接龙', summary: '创客营物料认领接龙', ai: '创客营物料认领接龙，每人认领一项。', days: 11, priority: 'low', todo: 'done' },
  { id: 'e28', groupId: 'g06', type: 'activity', subject: '周中加场', summary: '周三晚临时加一场，缺 1 人', ai: '周三晚临时加一场，目前 3 人，缺 1 人。', days: 11, priority: 'low', todo: 'ignored' },
  { id: 'e29', groupId: 'g07', type: 'other', subject: '食堂测评', summary: '新窗口测评投票，选出最难吃的', ai: '发起新窗口测评投票，选出最不受欢迎的菜品。', days: 12, priority: 'low', todo: 'done' },
  { id: 'e30', groupId: 'g09', type: 'deadline', subject: '周报提交', summary: '周报周五 18:00 前提交', ai: '本周周报周五 18:00 前提交至共享文档。', days: 12, priority: 'high', todo: 'done', deadlineDays: 3 },
  { id: 'e31', groupId: 'g10', type: 'signup', subject: '剧本杀报名', summary: '周日剧本杀报名 5 人等 1', ai: '周日剧本杀已报 5 人，还差 1 人开局。', days: 13, priority: 'low', todo: 'done' },
  { id: 'e32', groupId: 'g12', type: 'activity', subject: '晨跑团', summary: '新增晨跑团，6 点半操场集合', ai: '组织晨跑团，每天 6:30 操场集合，自愿参加。', days: 14, priority: 'low', todo: 'ignored' },
  { id: 'e33', groupId: 'g13', type: 'announcement', subject: '简历门诊', summary: '学院提供简历门诊，需预约', ai: '学院提供一对一简历门诊，需提前预约时段。', days: 15, priority: 'medium', todo: 'done' },
  { id: 'e34', groupId: 'g16', type: 'meeting', subject: '答疑安排', summary: '考前答疑周五下午，教室另行通知', ai: '考前答疑定于周五下午，教室待定。', days: 16, priority: 'medium', todo: 'done' },
  { id: 'e35', groupId: 'g17', type: 'vote', subject: '观影选片', summary: '周五观影选片投票', ai: '周五集体观影，候选 4 部，群内投票选择。', days: 17, priority: 'low', todo: 'done' },
  { id: 'e36', groupId: 'g19', type: 'signup', subject: '口语搭档', summary: '口语搭档配对报名', ai: '口语搭档配对报名，两人一组，每周练两次。', days: 18, priority: 'low', todo: 'done' },
  { id: 'e37', groupId: 'g20', type: 'payment', subject: '场地尾款', summary: '排练场地尾款需本周结清', ai: '排练场地尾款需本周内结清，否则不予保留。', days: 19, priority: 'medium', todo: 'done', deadlineDays: 5 },
  { id: 'e38', groupId: 'g21', type: 'other', subject: '照片收集', summary: '收集老照片用于聚会回顾', ai: '收集往期照片用于聚会回顾，发群或私聊均可。', days: 20, priority: 'low', todo: 'done' },
  { id: 'e39', groupId: 'g22', type: 'deadline', subject: '民宿预订', summary: '民宿需提前两周预订，请尽快确认', ai: '毕业旅行民宿需提前两周预订，请尽快确认人数。', days: 21, priority: 'high', todo: 'done', deadlineDays: 8 },
  { id: 'e40', groupId: 'g03', type: 'announcement', subject: '校园卡升级', summary: '校园卡系统升级，周四暂停充值', ai: '校园卡系统周四升级，期间暂停充值，请注意余额。', days: 22, priority: 'low', todo: 'done' },
];

/* ========================================================================== */
/* 组装：与正式 api 同形                                                        */
/* ========================================================================== */

const GROUPS_VIEW: Group[] = GROUPS.map((g) => ({
  id: g.id,
  name: g.name,
  messageCount: g.messages,
  lastMessageAt: Date.parse(daysAgo(g.lastDays, 21, 0)),
}));

const LEGEND = [
  { type: 'catchphrase' as const, color: '#f59e0b', label: '口头禅' },
  { type: 'inner' as const, color: '#0ea5e9', label: '内部梗' },
  { type: 'sticker' as const, color: '#8b5cf6', label: '表情包' },
];

/**
 * 每个群的「标签池」= 该群核心兴趣 + 少量邻域兴趣。
 * 用途是让标签带上圈层结构 —— 同群的人共享标签的概率显著更高，
 * 从而让「共同兴趣 / 共同群 / 契合度」呈现出真实的长尾分布，而不是均匀噪声。
 */
const GROUP_TAG_POOL: Map<string, number[]> = (() => {
  const pools = new Map<string, number[]>();
  GROUPS.forEach((g, gi) => {
    const pool: number[] = [];
    g.coreTags.forEach((name) => {
      const ti = TAGS.findIndex((t) => t.name === name);
      if (ti >= 0) pool.push(ti);
    });
    // 邻域：每个群再挂 1 个非核心标签，让圈子之间有少量交集（真实社群也是这样）
    const r = rng(gi * 3571 + 211);
    const extra = Math.floor(r() * TAGS.length);
    if (!pool.includes(extra)) pool.push(extra);
    pools.set(g.id, pool);
  });
  return pools;
})();

function sourceRefOf(groupId: string, sender: string, text: string, days: number): SourceRef {
  return {
    messageId: `msg_${groupId}_${days}_${sender}`,
    groupId,
    groupName: groupName(groupId),
    senderName: memberName(sender),
    sentAt: daysAgo(days, 20, 30),
    excerpt: text.slice(0, 60) || '[图片]',
  };
}

/** 按筛选条件过滤群（演示版只实现群与时间，够用且不误导）。 */
function filterGroups(f: GlobalFilter | undefined): DemoGroup[] {
  if (f === undefined || f.groupIds.length === 0) return GROUPS;
  return GROUPS.filter((g) => f.groupIds.includes(g.id));
}

function cloudOf(f: GlobalFilter | undefined, layout: 'heat' | 'firstSeen'): MemeCloudResult {
  const allowed = new Set(filterGroups(f).map((g) => g.id));
  const memes = MEMES.filter((m) => allowed.has(m.groupId));
  const totalOf = (m: DemoMeme): number => m.monthly.reduce((a, b) => a + b, 0);
  const entries: MemeCloudEntry[] = memes.map((m) => ({
    memeId: m.id,
    name: m.name,
    frequency: totalOf(m),
    occurrences: totalOf(m),
    type: m.type,
    firstSeenAt: daysAgo(m.firstDays, 20, 0),
    lastUsedAt: daysAgo(m.lastDays, 21, 0),
    mine: m.users.some((u) => u.id === ME),
  }));
  // 「按热度」按频率降序；「按首次出现时间」按首现升序
  entries.sort((a, b) =>
    layout === 'heat' ? b.frequency - a.frequency : Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt),
  );
  return {
    entries,
    legend: LEGEND,
    sourceRefs: entries.slice(0, 6).map((e) => sourceRefOf(MEMES.find((m) => m.id === e.memeId)!.groupId, 'p01', e.name, 3)),
  };
}

function unitOf(memeId: string): MemeUnit | null {
  const m = MEMES.find((x) => x.id === memeId);
  if (m === undefined) return null;
    const total = m.monthly.reduce((a, b) => a + b, 0);
  const maxMonth = Math.max(...m.monthly, 0);
  const peakIndex = m.monthly.indexOf(maxMonth);
  const king = m.users[0]!;
  const users = m.users.map((u) => {
    const tag = u.id === ME ? '（我）' : '';
    return { memberId: u.id, name: memberName(u.id) + tag, count: u.count };
  });
  return {
    memeId: m.id,
    name: m.name,
    type: m.type,
    groupId: m.groupId,
    groupName: groupName(m.groupId),
    interpretation: m.interpretation,
    firstSeenAt: daysAgo(m.firstDays, 20, 0),
    firstSeenGroupName: groupName(m.groupId),
    lastUsedAt: daysAgo(m.lastDays, 21, 0),
    sinceLastUse: m.lastDays === 0 ? '今天' : `${m.lastDays} 天前`,
    occurrences: total,
    weekOverWeek: Number((((m.monthly[6] ?? 0) - (m.monthly[5] ?? 0)) / Math.max(m.monthly[5] ?? 1, 1)).toFixed(2)),
    heatState: m.lastDays <= 3 ? 'active' : m.lastDays <= 14 ? 'fading' : 'silent',
    monthly: MONTHS.map((month, i) => ({ month, count: m.monthly[i] ?? 0, incomplete: i === MONTHS.length - 1 })),
    lifecycle: {
      firstSeenAt: daysAgo(m.firstDays, 20, 0),
      peakAt: daysAgo(m.firstDays - Math.max(0, 30 * (peakIndex + 1)), 20, 0),
      silentAt: daysAgo(m.lastDays, 21, 0),
      activeDays: Math.max(1, m.firstDays - m.lastDays),
    },
    king: {
      members: [{ memberId: king.id, name: memberName(king.id), count: king.count, ratio: Number((king.count / Math.max(users.reduce((a, u) => a + u.count, 0), 1)).toFixed(3)) }],
      topUsers: users.slice(0, 3).map((u) => ({ memberId: u.memberId, name: u.name, count: u.count })),
    },
    highlights: m.highlights.map((h, i) => ({
      messageId: `hl_${m.id}_${i}`,
      senderName: memberName(h.sender),
      sentAt: daysAgo(h.days, 20, 15),
      kind: h.kind,
      ...(h.text === '' ? {} : { text: h.text }),
      ...(h.kind === 'text' ? {} : { mediaUrl: undefined }),
      groupId: m.groupId,
      groupName: groupName(m.groupId),
    })),
    variants: MEMES.filter((v) => v.id !== m.id && v.groupId === m.groupId).slice(0, 2).map((v) => ({ memeId: v.id, name: v.name })),
    correction: 'none',
    sourceRefs: [sourceRefOf(m.groupId, m.users[0]!.id, m.highlights[0]?.text ?? m.name, m.highlights[0]?.days ?? 3)],
    mine: m.users.some((u) => u.id === ME),
  };
}

/**
 * 标签按「圈子」聚集，而不是全库均匀撒点。
 * 真实社群里兴趣是有圈层的：同一个群的人天然共享一部分爱好，跨群的人重合少。
 * 均匀随机会让共同标签恒为 0 或 1，契合度只能落在两个值上 —— 那是数据不像真的，不是算法要的效果。
 */
function tagsOf(personId: string): InterestTag[] {
  const idx = MEMBERS.findIndex((m) => m.id === personId);
  if (idx < 0) return [];
  const r = rng(idx * 977 + 13);
  // 「我」的画像更完整（自己当然最了解自己）→ 标签略多，长尾成员则很少
  const count = UNKNOWN_IDS.has(personId) ? 0 : personId === ME ? 6 + Math.floor(r() * 2) : 3 + Math.floor(r() * 4);
  const chosen = new Set<number>();
  const home = MEMBERS[idx]!.groups;
  const primary = home[0]!;
  const primaryPool = GROUP_TAG_POOL.get(primary) ?? [];
  const nearPool = [...new Set([...primaryPool, ...home.slice(1).flatMap((g) => GROUP_TAG_POOL.get(g) ?? [])])];
  /* 五档逐步放宽，保证一定填满 count 个标签（否则 Set 去重后会死循环）：
     主群圈子 → 自己所有群的圈子 → 同类别标签 → 全库 → 确定性兜底 */
  const strategies: (() => number)[] = [
    () => primaryPool[Math.floor(r() * primaryPool.length)] ?? 0,
    () => nearPool[Math.floor(r() * nearPool.length)] ?? 0,
    () => {
      const pool = nearPool.length > 0 ? nearPool : primaryPool;
      const cat = TAGS[pool[Math.floor(r() * pool.length)] ?? 0]!.category;
      const sameCat = TAGS.map((x, i) => (x.category === cat ? i : -1)).filter((i) => i >= 0);
      return sameCat[Math.floor(r() * sameCat.length)]!;
    },
    () => Math.floor(r() * TAGS.length),
    () => (idx * 7 + chosen.size * 13) % TAGS.length,
  ];
  for (const pick of strategies) {
    let guard = 0;
    while (chosen.size < count && guard < 80) {
      chosen.add(pick());
      guard += 1;
    }
    if (chosen.size >= count) break;
  }
  return [...chosen].map((ti, i) => {
    const t = TAGS[ti]!;
    return {
      tagId: tagIdOf(t.name),
      name: t.name,
      category: t.category,
      confidence: Number((0.55 + r() * 0.42).toFixed(2)),
      origin: r() > 0.8 ? 'manual' : 'extracted',
      evidence: [sourceRefOf(MEMBERS[idx]!.groups[0]!, personId, `${t.name} 相关的一句群聊`, 4 + i)],
    };
  });
}

function profileOf(personId: string): PersonProfile | null {
  const m = MEMBERS.find((x) => x.id === personId);
  if (m === undefined) return null;
  const tags = tagsOf(personId);
  const categoryScores = Object.fromEntries(
    INTEREST_CATEGORIES.map((c) => [c, Number(tags.filter((t) => t.category === c).reduce((a, t) => a + t.confidence, 0).toFixed(2))]),
  ) as Record<InterestCategory, number>;
  const unknown = UNKNOWN_IDS.has(personId);
  return {
    personId,
    name: m.name,
    isMe: personId === ME,
    unknown,
    tags,
    categoryScores,
    personalCloud: tags.map((t) => ({ name: t.name, confidence: t.confidence, category: t.category })),
    personality: unknown
      ? []
      : [
          { traitId: 'pt1', trait: 'calm', score: 72, status: 'confirmed', origin: 'inferred' },
          { traitId: 'pt2', trait: 'humorous', score: 64, status: 'confirmed', origin: 'inferred' },
          { traitId: 'pt3', trait: 'rational', score: 58, status: 'confirmed', origin: 'manual' },
        ],
    activity: m.activity,
    replyMedianMinutes: unknown ? undefined : 6 + (m.activity % 17),
    groups: m.groups.map((g) => ({ groupId: g, groupName: groupName(g) })),
  };
}

/* ========================================================================== */
/* 导出：与正式 api 同形                                                        */
/* ========================================================================== */

export const apiMode = (): 'http' | 'mock' => 'mock';

export const api = {
  async updateStatus(): Promise<Envelope<UpdateStatus>> {
    return ok({
      hasData: true,
      updatedTo: daysAgo(0, 22, 15),
      meId: ME,
      sources: [
        { source: 'group_messages', status: 'success', lastSuccessAt: daysAgo(0, 22, 15) },
        { source: 'contacts', status: 'success', lastSuccessAt: daysAgo(0, 22, 15) },
      ],
    });
  },

  async triggerUpdate(): Promise<Envelope<UpdateResult>> {
    return ok({
      results: [
        { source: 'group_messages', status: 'success', imported: 418 },
        { source: 'contacts', status: 'success', imported: 96 },
      ],
      finishedAt: daysAgo(0, 22, 15),
    });
  },

  async groups(): Promise<Envelope<Group[]>> {
    return ok(GROUPS_VIEW);
  },

  async dataVolume(): Promise<Envelope<DataVolume>> {
    return ok({
      messages: GROUPS.reduce((a, g) => a + g.messages, 0),
      groups: GROUPS.length,
      people: MEMBERS.length,
      memes: MEMES.length,
      extracts: EXTRACTS.length,
    });
  },

  async dataFlowNotice(): Promise<Envelope<DataFlowNotice>> {
    return ok({
      statements: [
        '全部数据只保存在本机：原始消息、派生结果与配置都在应用数据目录，不上传任何服务器。',
        '模型调用会把消息样本发给你自己配置的模型端点，用于生成梗、提取条目与画像。',
        '本应用不提供任何对外分享 / 发送通道；生成物只在本机查看与下载。',
        '（当前为静态示范站：以上为正式版的数据去向说明，演示数据均为虚构。）',
      ],
      modelEndpoint: 'https://api.deepseek.com/v1',
    });
  },

  async analysisScope(): Promise<Envelope<AnalysisScopeView>> {
    return ok({ analysisGroupIds: GROUPS.slice(0, 3).map((g) => g.id), autoTriggerAfterIngest: true });
  },

  async setAnalysisGroups(groupIds: string[]): Promise<Envelope<AnalysisScopeView>> {
    return ok({ analysisGroupIds: [...groupIds], autoTriggerAfterIngest: true });
  },

  async analyze(groupIds: readonly string[]): Promise<Envelope<{ started: boolean; scope: string }>> {
    return ok({ started: true, scope: groupIds.length === 0 ? '全部群' : `${groupIds.length} 个群` });
  },

  async operations(): Promise<Envelope<OperationSnapshot[]>> {
    return ok([]);
  },

  async settings(): Promise<Envelope<Record<string, unknown>>> {
    return ok({
      model: { baseUrl: 'https://api.deepseek.com/v1', apiKeyConfigured: true, name: 'deepseek-chat', taskConcurrency: 4 },
      ingest: { autoTriggerAfterIngest: true, pageSize: 1000, analysisGroupIds: GROUPS.slice(0, 3).map((g) => g.id) },
      cli: { executable: '/usr/local/bin/wechat-cli', stateDir: '' },
      server: { port: 8787 },
      log: { level: 'info', retentionDays: 7 },
      timeouts: { cliCommandMs: 120000, modelCallMs: 90000, renderMs: 30000 },
      retry: { maxAttempts: 3 },
    });
  },

  async saveSettings(): Promise<Envelope<Record<string, unknown>>> {
    return this.settings();
  },

  async deletePrecheck(scope: DeleteScope): Promise<Envelope<DeletePrecheck>> {
    const single = scope.kind === 'group';
    return ok({
      scope,
      scopeLabel: single ? groupName(scope.groupId) : '全部数据',
      items: [
        { entity: 'DM-003', label: '原始消息记录', count: single ? 1024 : 8572 },
        { entity: 'DM-006', label: '梗及其派生结果', count: single ? 9 : 30 },
        { entity: 'DM-010', label: '提取条目', count: single ? 3 : 40 },
      ],
      total: single ? 1036 : 8642,
    });
  },

  async executeDelete(scope: DeleteScope, confirmed: boolean): Promise<Envelope<DeleteResult>> {
    if (!confirmed) return fail('CONFIRMATION_REQUIRED', '删除需要二次确认');
    void scope;
    return ok({
      items: [
        { entity: 'DM-003', label: '原始消息记录', count: 1036 },
        { entity: 'media', label: '媒体文件', count: 18 },
      ],
      undone: false,
    });
  },

  async memeCloud(f: GlobalFilter, layout: 'heat' | 'firstSeen'): Promise<Envelope<MemeCloudResult>> {
    return ok(cloudOf(f, layout));
  },

  async memeUnit(memeId: string): Promise<Envelope<MemeUnit>> {
    const u = unitOf(memeId);
    return u === null ? fail('NOT_FOUND', '梗不存在') : ok(u);
  },

  async memeLifecycle(f: GlobalFilter): Promise<Envelope<LifecycleView>> {
    const allowed = new Set(filterGroups(f).map((g) => g.id));
    const rows = MEMES.filter((m) => allowed.has(m.groupId)).map((m) => {
      const maxMonth = Math.max(...m.monthly, 1);
      const peakIndex = m.monthly.indexOf(maxMonth);
      return {
        memeId: m.id,
        name: m.name,
        type: m.type,
        firstSeenAt: daysAgo(m.firstDays, 20, 0),
        peakAt: daysAgo(Math.max(1, m.firstDays - 30 * (peakIndex + 1)), 20, 0),
        silentAt: daysAgo(m.lastDays, 21, 0),
        activeDays: Math.max(1, m.firstDays - m.lastDays),
        monthlyIntensity: MONTHS.map((month, i) => ({ month, intensity: Number(((m.monthly[i] ?? 0) / maxMonth).toFixed(3)), count: m.monthly[i] ?? 0 })),
      };
    });
    const monthlyLeaders = MONTHS.map((month, i) => {
      let best = MEMES[0]!;
      for (const m of MEMES) if ((m.monthly[i] ?? 0) > (best.monthly[i] ?? 0)) best = m;
      return { month, memeId: best.id, name: best.name, count: best.monthly[i] ?? 0 };
    });
    return ok({ rows, monthlyLeaders, legend: LEGEND });
  },

  async submitCorrection(memeId: string, mark: MemeUnit['correction']): Promise<Envelope<MemeUnit | null>> {
    const u = unitOf(memeId);
    return u === null ? fail('NOT_FOUND', '梗不存在') : ok({ ...u, correction: mark });
  },

  async myMemes(f: GlobalFilter): Promise<Envelope<MemeCloudResult>> {
    const full = cloudOf(f, 'heat');
    return ok({ ...full, entries: full.entries.filter((e) => e.mine === true) });
  },

  async memeKingBoard(f: GlobalFilter): Promise<Envelope<MemeKingBoard>> {
    const allowed = new Set(filterGroups(f).map((g) => g.id));
    const acc = new Map<string, { participations: number; memes: Set<string>; authored: string[] }>();
    const ensure = (id: string) => {
      const cur = acc.get(id) ?? { participations: 0, memes: new Set<string>(), authored: [] };
      acc.set(id, cur);
      return cur;
    };
    for (const m of MEMES.filter((x) => allowed.has(x.groupId))) {
      for (const u of m.users) {
        const cur = ensure(u.id);
        cur.participations += u.count;
        cur.memes.add(m.id);
      }
      ensure(m.users[0]!.id).authored.push(m.name);
    }
    const rows = [...acc.entries()].map(([id, v]) => ({ id, ...v }));
    const maxUse = Math.max(...rows.map((r) => r.participations), 1);
    const maxDistinct = Math.max(...rows.map((r) => r.memes.size), 1);
    const maxAuthored = Math.max(...rows.map((r) => r.authored.length), 1);
    const board: MemeKingRow[] = rows
      .map((r) => {
        const n = {
          participations: Math.round((r.participations / maxUse) * 100),
          distinctMemes: Math.round((r.memes.size / maxDistinct) * 100),
          authoredHits: Math.round((r.authored.length / maxAuthored) * 100),
        };
        return {
          memberId: r.id,
          name: memberName(r.id) + (r.id === ME ? '（我）' : ''),
          participations: r.participations,
          distinctMemes: r.memes.size,
          authoredHits: r.authored.length,
          authoredMemeNames: r.authored,
          normalized: n,
          score: Math.round(n.participations * 0.4 + n.distinctMemes * 0.2 + n.authoredHits * 0.4),
          isKing: false,
          rank: 0,
        };
      })
      .sort((a, b) => b.score - a.score || b.participations - a.participations);
    board.forEach((r, i) => {
      r.rank = i + 1;
    });
    if (board.length > 0) board[0]!.isKing = true;
    return ok({ rows: board, king: board[0], totalParticipations: rows.reduce((a, r) => a + r.participations, 0) });
  },

  async memeYearbook(f: GlobalFilter): Promise<Envelope<MemeYearbook>> {
    const allowed = new Set(filterGroups(f).map((g) => g.id));
    const list = MEMES.filter((m) => allowed.has(m.groupId))
      .map((m) => ({ m, total: m.monthly.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
    const top = list[0];
    const faded = [...list].sort((a, b) => b.m.lastDays - a.m.lastDays)[0];
    const topMemes = list.slice(0, 10).map((x) => ({ memeId: x.m.id, name: x.m.name, occurrences: x.total }));
    const birth = top?.m.highlights[0];
    return ok({
      groupName: f.groupIds.length === 1 ? groupName(f.groupIds[0]!) : f.groupIds.length === 0 ? '全部群聊' : `${f.groupIds.length} 个群`,
      range: { start: '2026-03-01', end: '2026-09-13' },
      totalMessages: GROUPS.reduce((a, g) => a + g.messages, 0),
      memeMessages: list.reduce((a, x) => a + x.total, 0),
      ...(top === undefined ? {} : { topMeme: { memeId: top.m.id, name: top.m.name, occurrences: top.total } }),
      ...(birth === undefined || top === undefined
        ? {}
        : {
            topMemeBirth: {
              memeName: top.m.name,
              senderName: memberName(birth.sender),
              text: birth.text === '' ? '[图片]' : birth.text,
              sentAt: daysAgo(birth.days, 20, 30),
              groupName: groupName(top.m.groupId),
            },
          }),
      ...(faded === undefined
        ? {}
        : {
            fadedMeme: {
              memeId: faded.m.id,
              name: faded.m.name,
              occurrences: faded.total,
              peakAt: daysAgo(Math.max(1, faded.m.firstDays - 90), 20, 0),
              peakLabel: MONTHS[3]!,
              silentAt: daysAgo(faded.m.lastDays, 21, 0),
              silentDays: faded.m.lastDays,
            },
          }),
      topMemes,
      enough: topMemes.length >= 3,
    });
  },

  async yearbookTitle(_groupKey: string, topMemes: string[]): Promise<Envelope<{ title: string; cached: boolean }>> {
    const candidates = ['年度梗最密的群', '人均三个热梗的群', '梗不过夜的群', '每天都在造词的群', `${topMemes[0] ?? '摸鱼'} 一统江湖的群`];
    return ok({ title: candidates[topMemes.join('').length % candidates.length]!, cached: false });
  },

  async extractItems(_f: GlobalFilter, page = 1, pageSize = 50): Promise<Envelope<Paged<ExtractItem>>> {
    const all = EXTRACTS.map(extractOf);
    const start = (page - 1) * pageSize;
    return ok({ items: all.slice(start, start + pageSize), page, pageSize, total: all.length });
  },

  async noticeGroups(_f: GlobalFilter, dimension: NoticeDimension): Promise<Envelope<{ key: string; items: ExtractItem[] }[]>> {
    const all = EXTRACTS.map(extractOf);
    const bucket = (key: string, pred: (e: DemoExtract) => boolean) => ({ key, items: all.filter((_, i) => pred(EXTRACTS[i]!)) });
    if (dimension === 'priority') {
      return ok([
        bucket('优先级高', (e) => e.priority === 'high'),
        bucket('优先级中', (e) => e.priority === 'medium'),
        bucket('优先级低', (e) => e.priority === 'low'),
      ]);
    }
    if (dimension === 'todo') {
      return ok([
        bucket('未处理', (e) => e.todo === 'pending'),
        bucket('完成', (e) => e.todo === 'done'),
        bucket('忽略', (e) => e.todo === 'ignored'),
      ]);
    }
    if (dimension === 'type') {
      const kinds: ExtractItem['type'][] = ['announcement', 'at_all', 'vote', 'signup', 'meeting', 'activity', 'deadline', 'payment', 'relay', 'other'];
      return ok(kinds.map((k) => bucket(k, (e) => e.type === k)));
    }
    // 按来源（群）
    return ok(GROUPS.slice(0, 8).map((g) => bucket(groupName(g.id), (e) => e.groupId === g.id)));
  },

  async updateExtract(id: string, patch: { subject?: string; priority?: Priority }): Promise<Envelope<ExtractItem>> {
    const src = EXTRACTS.find((e) => e.id === id);
    if (src === undefined) return fail('NOT_FOUND', '条目不存在');
    if (patch.subject !== undefined) src.subject = patch.subject;
    if (patch.priority !== undefined) src.priority = patch.priority;
    return ok(extractOf(src));
  },

  async markTodo(id: string, state: TodoState): Promise<Envelope<{ id: string; todoState: TodoState }>> {
    const src = EXTRACTS.find((e) => e.id === id);
    if (src !== undefined) src.todo = state;
    return ok({ id, todoState: state });
  },

  async dueTodos(): Promise<Envelope<DueTodoView[]>> {
    return ok(
      EXTRACTS.filter((e) => e.todo === 'pending' && e.deadlineDays !== undefined && e.deadlineDays <= 1).map((e) => ({
        id: e.id,
        subject: e.subject,
        groupName: groupName(e.groupId),
        deadline: daysAgo(-(e.deadlineDays ?? 0), 18, 0),
      })),
    );
  },

  async messageDetail(id: string): Promise<Envelope<MessageDetail>> {
    const e = EXTRACTS.find((x) => x.id === id);
    if (e === undefined) return fail('NOT_FOUND', '条目不存在');
    const item = extractOf(e);
    return ok({
      id,
      heading: { summaryLine: item.summaryLine, groupName: item.groupName, sentAt: item.sentAt },
      body: {
        aiSummary: item.aiSummary,
        messages: item.sourceRefs.map((r) => ({
          id: r.messageId,
          groupId: r.groupId,
          senderId: 'p01',
          senderName: r.senderName,
          sentAt: r.sentAt,
          kind: 'text' as const,
          text: r.excerpt,
        })),
      },
      interestHints: (e.people ?? ['p01']).map((p) => ({
        memberId: p,
        memberName: memberName(p),
        interests: tagsOf(p).map((t) => t.name).slice(0, 3),
        ...(UNKNOWN_IDS.has(p) ? { unknown: true } : {}),
      })),
    });
  },

  async messageContext(messageId: string): Promise<Envelope<MessageContext>> {
    return ok({
      targetId: messageId,
      groupName: groupName('g01'),
      messages: [3, 2, 1, 0].map((d, i) => ({
        id: `${messageId}_ctx${i}`,
        groupId: 'g01',
        senderId: `p0${i + 1}`,
        senderName: memberName(`p0${i + 1}`),
        sentAt: daysAgo(d, 20, 10 + i),
        kind: 'text' as const,
        text: ['几号机好了', '马上，还剩一组', '我先占个位', '等你'][i]!,
      })),
    });
  },

  async personProfile(personId: string): Promise<Envelope<PersonProfile>> {
    const p = profileOf(personId);
    return p === null ? fail('EMPTY_RESULT', '未找到该成员的人画像') : ok(p);
  },

  /**
   * API-021 兴趣 → 人。
   * 注意 `value` 的取值口径：按一级维度时后端收的是**维度编码**（`sports` 等，
   * 见正式版 `DIMENSION_REVERSE`），按二级标签时收标签名。这里两种都接受，
   * 免得组件传编码、演示数据按中文比对，结果恒为空。
   */
  async interestToPeople(entry: 'category' | 'tag', value: string, _f?: GlobalFilter): Promise<Envelope<InterestPeopleResult>> {
    const matched = MEMBERS.filter((m) => {
      if (UNKNOWN_IDS.has(m.id)) return false;
      const tags = tagsOf(m.id);
      return entry === 'category'
        ? tags.some((t) => t.category === value || INTEREST_CATEGORY_LABEL[t.category] === value)
        : tags.some((t) => t.name === value);
    });
    const entryLabel = entry === 'category' ? (INTEREST_CATEGORY_LABEL[value as InterestCategory] ?? value) : value;
    return ok({
      entry,
      entryLabel,
      people: matched.map((m) => ({
        personId: m.id,
        name: m.name,
        confidence: Number((0.6 + (m.activity % 35) / 100).toFixed(2)),
        replyMedianMinutes: 5 + (m.activity % 19),
        activity: m.activity,
        unknown: false,
        evidence: [sourceRefOf(m.groups[0]!, m.id, `${entryLabel} 相关的一句群聊`, 5)],
      })),
    });
  },

  async pairMatch(aId: string, bId: string): Promise<Envelope<PairMatch>> {
    const a = profileOf(aId);
    const b = profileOf(bId);
    if (a === null || b === null) return fail('NOT_FOUND', '成员不存在');
    const aTags = new Map(a.tags.map((t) => [t.tagId, t]));
    const shared = b.tags.filter((t) => aTags.has(t.tagId));
    const categoryDiff = Object.fromEntries(
      INTEREST_CATEGORIES.map((c) => {
        const av = a.categoryScores[c];
        const bv = b.categoryScores[c];
        return [c, { a: av, b: bv, diff: Number((av - bv).toFixed(2)) }];
      }),
    ) as PairMatch['categoryDiff'];
    const avg = shared.length === 0 ? 0 : shared.reduce((s, t) => s + t.confidence, 0) / shared.length;
    const total = Math.min(100, Math.round(shared.length * 12 + avg * 40 + 18));
    return ok({
      personA: { personId: a.personId, name: a.name },
      personB: { personId: b.personId, name: b.name },
      sharedInterests: shared.map((t) => ({ tagId: t.tagId, name: t.name, category: t.category })),
      compatibility: {
        total,
        factors: [
          { key: 'shared', label: '共同标签数', value: shared.length * 12 },
          { key: 'confidence', label: '置信度加权', value: Math.round(avg * 40) },
          { key: 'interaction', label: '实际互动', value: 12 },
          { key: 'activity', label: '活跃度', value: 6 },
        ],
      },
      categoryDiff,
    });
  },

  async myCompatibility(): Promise<Envelope<MyCompatibility>> {
    const me = profileOf(ME)!;
    const myTags = new Set(me.tags.map((t) => t.tagId));
    const meRec = MEMBERS.find((m) => m.id === ME)!;
    const perPerson = MEMBERS.filter((m) => m.id !== ME && !UNKNOWN_IDS.has(m.id))
      .map((m) => {
        const shared = tagsOf(m.id).filter((t) => myTags.has(t.tagId));
        // 三个因子叠加，避免「共同标签 0/1」这种二值输出：
        //   标签重合 48 分（每个 8 分，封顶）+ 共同群 28 分（每群 7 分，封顶）+ 活跃度相近 18 分
        const commonGroups = m.groups.filter((g) => meRec.groups.includes(g)).length;
        const tagScore = Math.min(48, shared.length * 8);
        const groupScore = Math.min(28, commonGroups * 7);
        const ratio = Math.min(m.activity, meRec.activity) / Math.max(m.activity, meRec.activity);
        const activityScore = Math.round(ratio * 18);
        return {
          personId: m.id,
          name: m.name,
          score: Math.min(100, tagScore + groupScore + activityScore),
          sharedCount: shared.length,
        };
      })
      .sort((a, b) => b.score - a.score);
    return ok({ perPerson, integration: Math.round(perPerson.reduce((a, p) => a + p.score, 0) / Math.max(perPerson.length, 1)) });
  },

  async gatheringSuggestion(interest: string, personIds: string[]): Promise<Envelope<GatheringSuggestion>> {
    const names = personIds.map(memberName);
    return ok({
      interest,
      candidates: personIds.map((id) => ({ personId: id, name: memberName(id) })),
      text: `可以约 ${names.join('、')} 一起${interest}。他们在这项兴趣上的置信度都不低，且都还在群里活跃；建议先在群里发个接龙，定下时间再约场地。`,
    });
  },

  async alignmentCandidates(): Promise<Envelope<IdentityAlignmentCandidate[]>> {
    return ok([
      {
        candidateId: 'c01',
        status: 'unconfirmed',
        source: 'contacts',
        members: [
          { memberId: 'p01', displayName: '陈屿', groupName: groupName('g01') },
          { memberId: 'p13', displayName: '顾南', groupName: groupName('g09') },
        ],
      },
      {
        candidateId: 'c02',
        status: 'unconfirmed',
        source: 'contacts',
        members: [
          { memberId: 'p06', displayName: '沈以蓝', groupName: groupName('g06') },
          { memberId: 'p12', displayName: '孟青禾', groupName: groupName('g12') },
        ],
      },
    ]);
  },

  async submitAlignment(candidateId: string, decision: 'confirmed' | 'rejected'): Promise<Envelope<{ candidateId: string; status: string }>> {
    return ok({ candidateId, status: decision === 'confirmed' ? '已确认' : '已否定' });
  },

  async personaPanel(personId: string): Promise<Envelope<PersonaPanel>> {
    const p = profileOf(personId);
    const confirmed = p?.personality ?? [];
    return ok({
      confirmed,
      candidates: [
        { traitId: 'pc1', trait: 'lively', score: 61, status: 'candidate', origin: 'inferred' },
        { traitId: 'pc2', trait: 'leadership', score: 55, status: 'candidate', origin: 'inferred' },
      ],
    } as PersonaPanel);
  },

  async updatePersona(personId: string, op: string, traitId: string, trait?: string): Promise<Envelope<PersonaPanel>> {
    const panel = (await this.personaPanel(personId)) as { ok: true; data: PersonaPanel };
    void op;
    void traitId;
    void trait;
    return panel;
  },

  async editInterestTag(personId: string): Promise<Envelope<PersonProfile>> {
    const p = profileOf(personId);
    return p === null ? fail('NOT_FOUND', '成员不存在') : ok(p);
  },

  async memberInterestHints(memberIds: string[]): Promise<Envelope<MemberInterestHint[]>> {
    return ok(
      memberIds.map((id) => ({
        memberId: id,
        memberName: memberName(id),
        interests: tagsOf(id).map((t) => t.name).slice(0, 3),
        ...(UNKNOWN_IDS.has(id) ? { unknown: true } : {}),
      })),
    );
  },

  async memberRoster(f?: GlobalFilter): Promise<Envelope<RelationGraph['nodes']>> {
    return ok(rosterNodes(f));
  },

  async relationGraph(f?: GlobalFilter): Promise<Envelope<RelationGraph>> {
    const nodes = rosterNodes(f);
    const known = nodes.filter((n) => !n.unknown);
    const links: RelationGraph['links'] = [];
    for (let i = 0; i < known.length; i += 1) {
      for (let j = i + 1; j < known.length; j += 1) {
        const a = known[i]!;
        const b = known[j]!;
        const at = new Set(tagsOf(a.personId).map((t) => t.name));
        const shared = tagsOf(b.personId).map((t) => t.name).filter((n) => at.has(n));
        if (shared.length > 0) links.push({ source: a.personId, target: b.personId, sharedCount: shared.length, sharedInterests: shared });
      }
    }
    return ok({ nodes, links });
  },

  async interestEventStreams(): Promise<Envelope<InterestEventStream[]>> {
    return ok(
      TAGS.slice(0, 8).map((t) => ({
        tagId: tagIdOf(t.name),
        name: t.name,
        category: t.category,
        firstSeenAt: daysAgo(150 - t.name.length, 20, 0),
        events: MONTHS.flatMap((_month, i) =>
          Array.from({ length: 1 + ((i * 3 + t.name.length) % 3) }, (_, k) => ({
            at: daysAgo(170 - i * 24 - k * 4, 20, 0),
            intensity: Number((0.5 + ((i + k) % 5) / 10).toFixed(2)),
            personName: memberName(MEMBERS[(i + k + t.name.length) % 30]!.id),
          })),
        ),
      })) as InterestEventStream[],
    );
  },

  async interestScoreCards(f?: GlobalFilter): Promise<Envelope<InterestScoreCard[]>> {
    const allowed = new Set(filterGroups(f).map((g) => g.id));
    const involved = MEMBERS.filter((m) => !UNKNOWN_IDS.has(m.id) && m.groups.some((g) => allowed.has(g)));
    const cards: InterestScoreCard[] = TAGS.map((t) => {
      const holders = involved.filter((m) => tagsOf(m.id).some((x) => x.name === t.name));
      return {
        tagId: tagIdOf(t.name),
        name: t.name,
        category: t.category,
        heat: Math.min(100, holders.length * 11 + 20),
        peopleCount: holders.length,
        perPerson: holders.slice(0, 6).map((m) => ({
          personId: m.id,
          name: m.name,
          confidence: tagsOf(m.id).find((x) => x.name === t.name)?.confidence ?? 0.6,
        })),
      };
    })
      .filter((c) => c.peopleCount > 0)
      .sort((a, b) => b.heat - a.heat);
    return ok(cards);
  },

  /* ---- 再创作生成（正式版后端尚未暴露 HTTP 入口，这里给出可演示的结果）---- */
  async generateStickers(): Promise<Envelope<unknown>> {
    return ok({
      variants: [1, 2, 3, 4].map((i) => ({ variantId: `v${i}`, tier: 'popular_sticker', caption: ['几号机好了', '来活了', '摸鱼中', '下次一定'][i - 1] })),
      credited: true,
    });
  },

  async generateTextVariants(): Promise<Envelope<unknown>> {
    return ok({
      variants: ['几号机好了？在线等', '几号机好了，我先去吃饭', '几号机好了（第 3 次）', '几号机好了，别让我再问', '几号机好了，蹲一个'].map((text, i) => ({ variantId: `t${i}`, text })),
      credited: true,
    });
  },

  async generateNewMemeCandidates(): Promise<Envelope<unknown>> {
    return ok([
      { candidateId: 'nc1', name: '再对一版', reason: '近两周出现 7 次，集中在评审前后', occurrences: 7 },
      { candidateId: 'nc2', name: '先跑通', reason: '近两周出现 5 次，多与调试场景共现', occurrences: 5 },
    ]);
  },

  async confirmCandidate(candidateId: string): Promise<Envelope<{ candidateId: string; memeId: string; status: 'confirmed' }>> {
    return ok({ candidateId, memeId: `m_${candidateId}`, status: 'confirmed' });
  },

  async generationHistory(): Promise<Envelope<GenerationHistoryItem[]>> {
    const history: GenerationHistoryItem[] = [
      {
        id: 'g1',
        kind: 'G1',
        memeId: 'm01',
        memeName: '几号机好了',
        tier: 'popular_sticker',
        template: '经典上白下黑',
        createdAt: daysAgo(1, 15, 0),
        outputs: [1, 2, 3, 4].map((i) => ({ url: `media/demo-sticker-${i}.png`, text: ['几号机好了', '来活了', '摸鱼中', '下次一定'][i - 1] })),
        creationMark: true,
      },
      {
        id: 'g2',
        kind: 'G2',
        memeId: 'm08',
        memeName: '来活了',
        createdAt: daysAgo(3, 11, 20),
        outputs: ['来活了，今晚别等我', '来活了，我先哭一会', '来活了，谁帮我看下', '来活了（第 N 次）', '来活了，已躺平'].map((text) => ({ text })),
        creationMark: true,
      },
    ];
    return ok(history);
  },

  async materialConsents(): Promise<Envelope<MaterialConsent[]>> {
    return ok([{ consentId: 'mc1', materialRef: 'media/demo-sticker-1.png', memberId: 'p03', memberName: memberName('p03'), status: 'confirmed' }] as MaterialConsent[]);
  },

  async confirmMaterial(consentId: string): Promise<Envelope<MaterialConsent>> {
    return ok({ consentId, materialRef: 'media/demo-sticker-1.png', memberId: 'p03', memberName: memberName('p03'), status: 'confirmed' } as MaterialConsent);
  },
};

/* ---- 局部组装函数（放在最后，便于上面阅读）---- */

function rosterNodes(f?: GlobalFilter): RelationGraph['nodes'] {
  const allowed = new Set(filterGroups(f).map((g) => g.id));
  const pool = f === undefined || f.groupIds.length === 0 ? MEMBERS : MEMBERS.filter((m) => m.groups.some((g) => allowed.has(g)));
  return pool.map((m) => ({
    personId: m.id,
    name: m.name + (m.id === ME ? '（我）' : ''),
    unknown: UNKNOWN_IDS.has(m.id),
    activity: m.activity,
    isMe: m.id === ME,
  }));
}

function extractOf(e: DemoExtract): ExtractItem {
  const deadline = e.deadlineDays === undefined ? undefined : daysAgo(-e.deadlineDays, 18, 0);
  const urgent = e.deadlineDays !== undefined && e.deadlineDays <= 1;
  return {
    id: e.id,
    type: e.type,
    elements: {
      ...(e.time === undefined ? {} : { time: e.time }),
      ...(e.location === undefined ? {} : { location: e.location }),
      ...(e.people === undefined ? {} : { people: e.people.map((p) => ({ memberId: p, name: memberName(p) })) }),
      subject: e.summary,
      ...(deadline === undefined ? {} : { deadline }),
    },
    subject: e.subject,
    groupId: e.groupId,
    groupName: groupName(e.groupId),
    sentAt: daysAgo(e.days, 20, 30),
    summaryLine: `${e.subject} · ${e.summary}`,
    aiSummary: e.ai,
    priority: e.priority,
    todoState: e.todo,
    remindState: e.todo === 'pending' && urgent ? 'remind' : 'no_remind',
    sourceRefs: [sourceRefOf(e.groupId, e.people?.[0] ?? 'p01', e.summary, e.days)],
  };
}

export type Api = typeof api;
