/**
 * 演示用 Mock 数据源（seed 固定 → 每次刷新数据一致，便于演示与评审）
 *
 * 真实接入时：把 `src/api/mock.ts` 里的函数换成 HTTP/MCP 调用即可，
 * 组件层完全不用改（见 src/api/index.ts 的说明）。
 */
import type { ChatMember, ChatMessageType, ChatSession, MemeCard, MemeCategory, NoticeCategory, NoticeItem, NoticePriority, NoticeStatus, OverviewStats, PersonalityProfile, ReverseSignal, MatchResult } from '@/types';

/* ---------------- 种子随机 ---------------- */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rng = makeRng(20260412);
const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
const pickN = <T,>(arr: T[], n: number) => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(rng() * copy.length), 1));
  return out;
};
const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

/** 演示数据的时间基准：2026-03-01 ~ 2026-06-09 */
export const RANGE_START = new Date('2026-03-01T00:00:00+08:00');
export const RANGE_END = new Date('2026-06-09T23:59:00+08:00');
const SPAN_DAYS = Math.round((RANGE_END.getTime() - RANGE_START.getTime()) / 86400000);

const dayOffsetToIso = (dayOffset: number, hour = 12, minute = 0) => {
  const d = new Date(RANGE_START.getTime());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const fmtMD = (dayOffset: number, hour = 12, minute = 0) => {
  const d = new Date(RANGE_START.getTime());
  d.setDate(d.getDate() + dayOffset);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};
const fmtYMD = (dayOffset: number) => {
  const d = new Date(RANGE_START.getTime());
  d.setDate(d.getDate() + dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------------- 群与成员 ---------------- */
export interface MockGroup {
  chat: string;
  username: string;
  memberCount: number;
  subject: string;
  avatar: string;
  weight: number;
  members: string[];
}

const NAME_POOL = [
  '陈禹哲', '蒋驰骋', '杨贺尧', '李沛轩', '刘行健', '杨睿哲', '陈诺', '苏晚意', '周牧之', '林知夏',
  '何嘉树', '赵一鸣', '孙沐白', '郑寒声', '许亦舟', '沈砚清', '唐颂', '白露', '顾青梧', '秦昭',
  '孟繁星', '裴云舟', '谢清野', '韩青', '崔听雨', '方与之', '段灼', '严既明', '罗子谦', '程星野',
];

export const GROUPS: MockGroup[] = [
  {
    chat: '24组·聊斋开发群',
    username: '38912345678@chatroom',
    memberCount: 12,
    subject: '黑客松开发',
    avatar: '聊',
    weight: 34,
    members: ['陈禹哲', '蒋驰骋', '杨贺尧', '李沛轩', '刘行健', '杨睿哲', '陈诺', '苏晚意', '周牧之', '林知夏', '何嘉树', '赵一鸣'],
  },
  {
    chat: '人工智能2401班群',
    username: '41298765432@chatroom',
    memberCount: 46,
    subject: '班级通知',
    avatar: '班',
    weight: 26,
    members: NAME_POOL.slice(6, 24),
  },
  {
    chat: '算法竞赛集训队',
    username: '52387112233@chatroom',
    memberCount: 28,
    subject: '训练与比赛',
    avatar: '赛',
    weight: 18,
    members: ['杨贺尧', '李沛轩', '刘行健', '秦昭', '孟繁星', '裴云舟', '谢清野', '韩青', '崔听雨', '方与之', '段灼', '严既明'],
  },
  {
    chat: '宿舍夜话(204)',
    username: '60123456789@chatroom',
    memberCount: 6,
    subject: '生活闲聊',
    avatar: '宿',
    weight: 14,
    members: ['陈禹哲', '蒋驰骋', '杨睿哲', '陈诺', '罗子谦', '程星野'],
  },
  {
    chat: '学生会宣传部',
    username: '63456712398@chatroom',
    memberCount: 33,
    subject: '工作协作',
    avatar: '宣',
    weight: 10,
    members: ['苏晚意', '周牧之', '林知夏', '顾青梧', '白露', '唐颂'],
  },
  {
    chat: '羽毛球约球群',
    username: '66778899001@chatroom',
    memberCount: 21,
    subject: '活动接龙',
    avatar: '羽',
    weight: 7,
    members: ['何嘉树', '赵一鸣', '孙沐白', '郑寒声', '许亦舟', '沈砚清', '方与之'],
  },
  {
    chat: '陈禹哲',
    username: 'wxid_chenyz_2026',
    memberCount: 2,
    subject: '单聊',
    avatar: '陈',
    weight: 5,
    members: ['陈禹哲', '我'],
  },
];

export const SESSIONS: ChatSession[] = GROUPS.map((g, i) => ({
  chat: g.chat,
  username: g.username,
  is_group: g.username.includes('@chatroom'),
  unread: g.username.includes('@chatroom') ? int(0, 86) : int(0, 3),
  last_message: pick([
    '那我把词云那块先搭出来，晚上发你看看',
    '接龙：明天下午三点，A栋301，带电脑',
    '这个梗必须做成表情包哈哈哈',
    '[图片]',
    '缴费截止到周五 18:00，别忘了我再提醒一次',
    '我投「深夜废话诗人」一票',
  ]),
  msg_type: pick(['文本', '文本', '文本', '图片', '表情']),
  sender: pick(g.members),
  timestamp: Math.floor((RANGE_END.getTime() - i * int(1800, 72000) * 1000) / 1000),
  time: fmtMD(SPAN_DAYS - i, int(8, 23), int(0, 59)),
  avatar: g.avatar,
  member_count: g.memberCount,
}));

export const MEMBERS_BY_GROUP: Record<string, ChatMember[]> = Object.fromEntries(
  GROUPS.map((g) => [
    g.chat,
    g.members.map((name, idx) => ({
      display_name: name,
      username: `wxid_${encodeURIComponent(name)}_${idx}`,
      remark: idx % 5 === 0 ? name : undefined,
      avatar: name.slice(0, 1),
      message_count: int(30, 1200),
      is_owner: idx === 0,
    })),
  ]),
);

/* ---------------- 梗库 ---------------- */
interface MemeSeed {
  term: string;
  meaning: string;
  category: MemeCategory;
  context: string;
  chats: string[];
  peak: number[]; // 峰值日（dayOffset）
  base: number; // 基础热度
}

const MEME_SEEDS: MemeSeed[] = [
  { term: '已阅', meaning: '群里通知刷屏时统一回复的极简话术，带一点敷衍的幽默感，实际含义是「看到了但不想展开」。', category: 'catchphrase', context: '有人发通知/长文之后', chats: ['24组·聊斋开发群', '人工智能2401班群'], peak: [18, 44, 76], base: 92 },
  { term: '收到', meaning: '标准回执，和「已阅」的区别在于「收到」更正式、更可能真的去执行。', category: 'catchphrase', context: '老师或组长布置任务后', chats: ['人工智能2401班群', '学生会宣传部'], peak: [12, 40, 71], base: 86 },
  { term: '摸鱼', meaning: '在应该干活的时间做无关的事，群里常用于自我举报或互相调侃。', category: 'catchphrase', context: '工作日白天集体消失又出现时', chats: ['24组·聊斋开发群', '宿舍夜话(204)'], peak: [22, 58, 83], base: 78 },
  { term: '摆烂', meaning: '放弃挣扎、接受现状的自我调侃，常与「一晚上没写一行代码」连用。', category: 'catchphrase', context: '进度落后或 Deadline 临近时', chats: ['24组·聊斋开发群', '算法竞赛集训队'], peak: [30, 66], base: 61 },
  { term: '内卷', meaning: '指责他人过度努力的群内常用武器，通常伴随凌晨提交记录截图出现。', category: 'catchphrase', context: '有人深夜提交代码或晒学习时长', chats: ['算法竞赛集训队', '人工智能2401班群'], peak: [26, 62, 80], base: 66 },
  { term: '答辩加油', meaning: '路演前的固定应援语，已经内化成 24 组的仪式性口号。', category: 'catchphrase', context: '每次排练或提交节点前', chats: ['24组·聊斋开发群'], peak: [35, 70, 88], base: 54 },
  { term: '来活了', meaning: '宣传部的开工暗号，出现即代表又有临时任务派下来。', category: 'slang', context: '老师在群里 @ 宣传部时', chats: ['学生会宣传部'], peak: [15, 47, 79], base: 48 },
  { term: '拉个会', meaning: '不说明议题就要开会，群内黑话，往往意味着要加班同步进度。', category: 'slang', context: '进度不同步或需要拍板时', chats: ['24组·聊斋开发群', '学生会宣传部'], peak: [20, 55], base: 44 },
  { term: '对齐一下', meaning: '把双方理解拉到同一水平线，实际常代指「我也不知道要说啥，先聊聊」。', category: 'slang', context: '需求模糊、接口没定时', chats: ['24组·聊斋开发群'], peak: [24, 60, 84], base: 52 },
  { term: '这个需求做不了', meaning: '技术组对离谱需求的统一回复，已经被做成表情包在群里流通。', category: 'slang', context: '产品提出临时新增功能', chats: ['24组·聊斋开发群'], peak: [28, 64], base: 40 },
  { term: '虾仁猪心', meaning: '「吓人诛心」的谐音梗，用于形容某人一针见血地戳中痛处。', category: 'slang', context: '有人晒出惨烈成绩或被精准吐槽', chats: ['宿舍夜话(204)', '人工智能2401班群'], peak: [16, 50, 77], base: 45 },
  { term: '咕咕咕', meaning: '放鸽子的拟声表达，鸽 = 失约，叠加三次表示鸽得非常彻底。', category: 'slang', context: '约好的活动被临时取消', chats: ['羽毛球约球群', '宿舍夜话(204)'], peak: [19, 53, 81], base: 42 },
  { term: '裂开', meaning: '情绪崩溃的夸张表达，多用于代码跑不通、比赛爆零等场景。', category: 'catchphrase', context: '遇到难以解释的 bug 或失败', chats: ['算法竞赛集训队', '24组·聊斋开发群'], peak: [25, 59, 85], base: 58 },
  { term: '猫猫震惊', meaning: '群内使用率最高的表情包，几乎可以回应任何消息，是万能情绪缓冲垫。', category: 'sticker', context: '任何需要表达惊讶又不想打字的时候', chats: ['宿舍夜话(204)', '24组·聊斋开发群', '人工智能2401班群'], peak: [14, 33, 51, 68, 86], base: 88 },
  { term: '狗头保命', meaning: '加在玩笑话后面的免责声明，表示「我在开玩笑别当真」。', category: 'sticker', context: '开队友玩笑或吐槽老师时', chats: ['人工智能2401班群', '算法竞赛集训队'], peak: [21, 49, 74], base: 57 },
  { term: '摸鱼猫', meaning: '一只趴在键盘上的猫，配文「今天也是努力的一天」，摸鱼文化的视觉符号。', category: 'sticker', context: '工作日白天互相打卡摸鱼', chats: ['24组·聊斋开发群', '学生会宣传部'], peak: [23, 56, 82], base: 50 },
  { term: '电子榨菜', meaning: '吃饭时必看的视频/剧集，群内互相安利的主要货币。', category: 'catchphrase', context: '饭点前后', chats: ['宿舍夜话(204)'], peak: [17, 45, 72], base: 47 },
  { term: '夜宵搭子', meaning: '晚上十点后一起点外卖的固定合伙人，204 宿舍的核心社交单位。', category: 'nickname', context: '宵夜时间', chats: ['宿舍夜话(204)'], peak: [29, 54, 78], base: 39 },
  { term: '组长', meaning: '对陈禹哲的专属称呼，通常伴随「这个怎么弄」出现。', category: 'nickname', context: '遇到技术问题需要拍板时', chats: ['24组·聊斋开发群'], peak: [13, 38, 65, 87], base: 63 },
  { term: '卷王', meaning: '对杨贺尧的调侃称呼，源于其连续三周占据刷题榜第一。', category: 'nickname', context: '有人晒刷题量时', chats: ['算法竞赛集训队', '人工智能2401班群'], peak: [27, 61], base: 43 },
  { term: '黑客松', meaning: '本次比赛的统称，从三月起成为群里最高频的共同话题。', category: 'event', context: '项目相关讨论开场', chats: ['24组·聊斋开发群', '人工智能2401班群'], peak: [10, 31, 52, 69, 88], base: 82 },
  { term: '路演', meaning: '决赛答辩环节，群里对它又期待又焦虑，相关讨论集中在五月之后。', category: 'event', context: '排练、PPT、答辩准备', chats: ['24组·聊斋开发群'], peak: [62, 74, 86], base: 55 },
  { term: '通宵', meaning: '集体熬夜攻坚的共同记忆，通常第二天群里会集体沉默。', category: 'event', context: '提交前一夜', chats: ['24组·聊斋开发群', '算法竞赛集训队'], peak: [36, 71, 89], base: 49 },
  { term: '奶茶拼单', meaning: '群内最高效的动员机制，接龙速度远超任何正式通知。', category: 'event', context: '下午茶时间', chats: ['24组·聊斋开发群', '宿舍夜话(204)', '学生会宣传部'], peak: [11, 34, 57, 80], base: 60 },
  { term: '校赛爆零', meaning: '指校内赛一道题都没做出来，已成为集训队自嘲的固定梗。', category: 'event', context: '比赛后复盘', chats: ['算法竞赛集训队'], peak: [41, 67], base: 36 },
  { term: '羽毛球局', meaning: '每周固定约球活动，因频繁凑不齐人而衍生出「咕咕咕」的连招。', category: 'event', context: '周三、周六下午', chats: ['羽毛球约球群'], peak: [12, 39, 60, 82], base: 45 },
  { term: '答辩PPT', meaning: '路演材料，群内出现过 17 个版本，是「对齐一下」的主要触发源。', category: 'event', context: '准备答辩材料', chats: ['24组·聊斋开发群'], peak: [63, 75, 87], base: 41 },
  { term: '装死', meaning: '被 @ 之后长时间不回复的状态描述，带轻微谴责意味。', category: 'catchphrase', context: '有人被点名但没出现', chats: ['24组·聊斋开发群', '学生会宣传部'], peak: [16, 43, 73], base: 38 },
  { term: '6', meaning: '单字回复，可以表达赞叹、无语、敷衍等一切情绪，是群内语义密度最高的一个字。', category: 'catchphrase', context: '任何场景', chats: ['24组·聊斋开发群', '人工智能2401班群', '宿舍夜话(204)'], peak: [9, 24, 37, 55, 70, 84], base: 95 },
  { term: '好的呢', meaning: '阴阳怪气的接受，表示「我不同意但我不说」。', category: 'catchphrase', context: '被迫接受不合理的安排时', chats: ['学生会宣传部', '人工智能2401班群'], peak: [22, 48, 76], base: 41 },
];

function buildTrend(seed: MemeSeed) {
  const points: { date: string; count: number }[] = [];
  for (let d = 0; d < SPAN_DAYS; d += 3) {
    let count = 0;
    for (const p of seed.peak) {
      const dist = Math.abs(p - d);
      if (dist < 12) count += Math.round((seed.base / 12) * (1 - dist / 12) * (0.7 + rng() * 0.6));
    }
    count += Math.round(rng() * 1.6);
    if (count > 0) points.push({ date: fmtYMD(d).slice(5), count });
  }
  return points;
}

export const MEMES: MemeCard[] = MEME_SEEDS.map((seed, idx) => {
  const trend = buildTrend(seed);
  const count = trend.reduce((s, p) => s + p.count, 0);
  const peakDay = seed.peak[seed.peak.length - 1];
  const firstDay = Math.max(0, Math.min(...seed.peak) - int(4, 12));
  const lastDay = Math.min(SPAN_DAYS, peakDay + int(3, 20));
  const bucketSize = 7;
  const timeline = [];
  for (let start = Math.floor(firstDay / bucketSize) * bucketSize; start <= lastDay; start += bucketSize) {
    const inBucket = trend.filter((p) => {
      const day = dayIndexOf(p.date);
      return day >= start && day < start + bucketSize;
    });
    const bucketCount = inBucket.reduce((s, p) => s + p.count, 0);
    timeline.push({
      bucket: `${fmtYMD(start).slice(5)} 起`,
      count: bucketCount,
      first_used_at: dayOffsetToIso(start, int(9, 22)),
      last_used_at: dayOffsetToIso(Math.min(start + bucketSize - 1, SPAN_DAYS), int(9, 22)),
      intensity: bucketCount / Math.max(1, seed.base),
    });
  }
  const maxBucket = Math.max(...timeline.map((t) => t.count), 1);
  timeline.forEach((t) => (t.intensity = Math.min(1, t.count / maxBucket)));
  const contributors = pickN(NAME_POOL, int(3, 5)).map((name) => ({ name, count: int(3, Math.max(4, Math.round(count / 4))) }));
  contributors.sort((a, b) => b.count - a.count);
  const samples = Array.from({ length: int(3, 5) }, () => {
    const day = int(firstDay, lastDay);
    return {
      sender: pick(NAME_POOL),
      text: pick([
        `${seed.term}${pick(['', '哈哈哈哈哈', '，笑死', ' 真的服了', '（狗头）'])}`,
        `又是${seed.term}的一天`,
        `@${pick(NAME_POOL)} ${seed.term}`,
        `我说怎么这么眼熟，原来是${seed.term}`,
      ]),
      time: fmtMD(day, int(8, 23), int(0, 59)),
      chat: pick(seed.chats),
      message_id: `msg_${idx}_${day}`,
    };
  });
  return {
    id: `meme_${idx + 1}`,
    term: seed.term,
    count,
    meaning: seed.meaning,
    category: seed.category,
    chats: seed.chats,
    first_seen: dayOffsetToIso(firstDay, int(9, 23)),
    last_seen: dayOffsetToIso(lastDay, int(9, 23)),
    lifespan_days: lastDay - firstDay,
    trend,
    timeline,
    top_contributors: contributors,
    samples,
    context: seed.context,
    confidence: Math.min(0.98, 0.62 + rng() * 0.36),
    related_ids: [],
  };
});

// 简单关联：同群 + 同类别 → 互为相关梗
MEMES.forEach((m) => {
  m.related_ids = MEMES.filter((o) => o.id !== m.id && o.category === m.category && o.chats.some((c) => m.chats.includes(c)))
    .slice(0, 4)
    .map((o) => o.id);
});

function dayIndexOf(mmdd: string) {
  const [m, d] = mmdd.split('-').map(Number);
  const startM = RANGE_START.getMonth() + 1;
  const startD = RANGE_START.getDate();
  const months = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let days = 0;
  let cm = startM;
  let cd = startD;
  while (cm !== m || cd !== d) {
    cd += 1;
    days += 1;
    if (cd > months[cm - 1]) {
      cd = 1;
      cm = cm + 1;
    }
    if (cm > 12) cm = 1;
  }
  return days;
}

/* ---------------- 通知库 ---------------- */
interface NoticeSeed {
  headline: string;
  summary: string;
  chat: string;
  category: NoticeCategory;
  priority: NoticePriority;
  status: NoticeStatus;
  day: number;
  hour: number;
  minute: number;
  entities: NoticeItem['entities'];
  tags: string[];
  sourceCount: number;
}

const NOTICE_SEEDS: NoticeSeed[] = [
  {
    headline: '周四 18:00 前往行政楼 A301 缴纳参赛材料费 50 元',
    summary: '班群发布缴费通知，需在周四 18:00 前到行政楼 A301 现场缴纳 50 元材料费，可代缴但需提前登记；逾期需联系辅导员补办。',
    chat: '人工智能2401班群',
    category: 'payment',
    priority: 'urgent',
    status: 'todo',
    day: 6,
    hour: 9,
    minute: 12,
    entities: { subject: '参赛材料费缴纳', deadline: dayOffsetToIso(6, 18), location: '行政楼 A301', people: ['辅导员 李老师'], amount: '50 元', deadline_text: '周四 18:00' },
    tags: ['缴费', '截止'],
    sourceCount: 5,
  },
  {
    headline: '周五 20:00 前提交黑客松中期材料到组长邮箱',
    summary: '24 组内部通知：中期材料（PRD 摘要 + 架构图 + 分工表）需在周五 20:00 前发到组长邮箱，命名格式「24组-中期材料-组名」。',
    chat: '24组·聊斋开发群',
    category: 'deadline',
    priority: 'high',
    status: 'doing',
    day: 9,
    hour: 22,
    minute: 40,
    entities: { subject: '中期材料提交', deadline: dayOffsetToIso(9, 20), people: ['陈禹哲'], format: '24组-中期材料-回声' },
    tags: ['材料', 'DDL', '黑客松'],
    sourceCount: 8,
  },
  {
    headline: '周六 15:00 A 栋 301 进行第二次路演排练',
    summary: '确定第二次路演排练时间地点：本周六 15:00 于 A 栋 301，需带电脑与最新 PPT，预计两小时，重点打磨前 3 分钟开场。',
    chat: '24组·聊斋开发群',
    category: 'meeting',
    priority: 'high',
    status: 'todo',
    day: 14,
    hour: 13,
    minute: 5,
    entities: { subject: '第二次路演排练', event_time: dayOffsetToIso(14, 15), location: 'A 栋 301', people: ['蒋驰骋', '陈禹哲'], duration: '约 2 小时' },
    tags: ['排练', '路演'],
    sourceCount: 11,
  },
  {
    headline: '@所有人 群公告更新：作品需在 6 月 10 日 12:00 前完成仓库提交',
    summary: '官方群公告：所有参赛作品须于 6 月 10 日 12:00 前完成 GitHub 仓库提交并附上可运行 Demo 说明，逾期视为放弃评奖。',
    chat: '人工智能2401班群',
    category: 'announcement',
    priority: 'urgent',
    status: 'todo',
    day: 20,
    hour: 10,
    minute: 0,
    entities: { subject: '作品仓库提交', deadline: dayOffsetToIso(20, 12), people: ['赛事组委会'], channel: 'GitHub 仓库' },
    tags: ['公告', '提交', 'DDL'],
    sourceCount: 3,
  },
  {
    headline: '周日羽毛球局接龙已开，14:00 前回复人数',
    summary: '羽毛球群开启本周日 16:00-18:00 场地接龙，需在周日 14:00 前报人数以便定场，当前 7 人报名，差 1 人成局。',
    chat: '羽毛球约球群',
    category: 'rollcall',
    priority: 'normal',
    status: 'doing',
    day: 24,
    hour: 11,
    minute: 30,
    entities: { subject: '周末羽毛球接龙', event_time: dayOffsetToIso(24, 16), location: '西区体育馆 3 号场', deadline: dayOffsetToIso(24, 14), current: '7 人' },
    tags: ['接龙', '运动'],
    sourceCount: 9,
  },
  {
    headline: '宣传部海报初稿需在周三中午前交，A/B 两版择一',
    summary: '宣传部工作安排：黑客松宣传海报初稿周三 12:00 前提交 A/B 两版，主视觉以「聊斋」墨色 + 微信绿为主，需附 300 字设计说明。',
    chat: '学生会宣传部',
    category: 'deadline',
    priority: 'high',
    status: 'doing',
    day: 28,
    hour: 16,
    minute: 45,
    entities: { subject: '海报初稿提交', deadline: dayOffsetToIso(28, 12), people: ['苏晚意', '周牧之'], deliverable: 'A/B 两版 + 300 字说明' },
    tags: ['海报', '设计', 'DDL'],
    sourceCount: 6,
  },
  {
    headline: '集训队周五晚 19:00 进行图论专题训练赛',
    summary: '算法集训队安排：周五 19:00-22:00 图论专题训练赛，线上举行，需提前 10 分钟进入评测系统，赛后当晚提交题解。',
    chat: '算法竞赛集训队',
    category: 'activity',
    priority: 'normal',
    status: 'todo',
    day: 32,
    hour: 18,
    minute: 20,
    entities: { subject: '图论专题训练赛', event_time: dayOffsetToIso(32, 19), location: '线上评测系统', people: ['秦昭'], duration: '3 小时' },
    tags: ['训练赛', '算法'],
    sourceCount: 7,
  },
  {
    headline: '关于「AI 应用赛」报名信息收集，需在周四前填表',
    summary: '班级通知：AI 应用赛报名信息收集表已发到群文件，需在周四 23:59 前填写姓名、学号、组别，未填写视为不参赛。',
    chat: '人工智能2401班群',
    category: 'signup',
    priority: 'high',
    status: 'done',
    day: 36,
    hour: 14,
    minute: 10,
    entities: { subject: 'AI 应用赛报名', deadline: dayOffsetToIso(36, 23, 59), people: ['班长 何嘉树'], channel: '群文件在线表格' },
    tags: ['报名', '填表'],
    sourceCount: 4,
  },
  {
    headline: '晚上奶茶拼单截止 21:30，满 8 杯免配送',
    summary: '群内奶茶拼单，21:30 截止，当前 6 杯，满 8 杯免配送费；口味统一走小程序，收件地址为 3 号楼大厅。',
    chat: '宿舍夜话(204)',
    category: 'rollcall',
    priority: 'low',
    status: 'done',
    day: 40,
    hour: 20,
    minute: 5,
    entities: { subject: '奶茶拼单', deadline: dayOffsetToIso(40, 21, 30), location: '3 号楼大厅', threshold: '满 8 杯免配送' },
    tags: ['拼单', '夜宵'],
    sourceCount: 12,
  },
  {
    headline: '投票：团建地点三选一，周五 18:00 截止',
    summary: '团建地点投票开启，候选为「青龙山徒步 / 密室逃脱 / 露营烧烤」，每人一票，周五 18:00 截止，票高者执行。',
    chat: '24组·聊斋开发群',
    category: 'vote',
    priority: 'normal',
    status: 'todo',
    day: 45,
    hour: 17,
    minute: 25,
    entities: { subject: '团建地点投票', deadline: dayOffsetToIso(45, 18), options: ['青龙山徒步', '密室逃脱', '露营烧烤'], people: ['蒋驰骋'] },
    tags: ['投票', '团建'],
    sourceCount: 15,
  },
  {
    headline: '群技术分享：周六晚分享「向量检索在群聊分析里的用法」',
    summary: '技术分享通知：周六 20:00 在腾讯会议分享向量检索在群聊分析中的应用，包含 embedding 选型、召回策略与成本控制，时长 40 分钟 + 提问。',
    chat: '24组·聊斋开发群',
    category: 'activity',
    priority: 'normal',
    status: 'todo',
    day: 50,
    hour: 12,
    minute: 0,
    entities: { subject: '技术分享：向量检索', event_time: dayOffsetToIso(50, 20), location: '腾讯会议 391-228-771', people: ['李沛轩'], duration: '40 分钟 + Q&A' },
    tags: ['分享', '技术'],
    sourceCount: 5,
  },
  {
    headline: '图书馆研讨间预约需在周一 9:00 抢，逾期无位',
    summary: '图书馆研讨间需在周一 9:00 开放预约时抢，项目组计划预约 4 楼 407（可容纳 8 人，带投影），错过需等下周三放号。',
    chat: '24组·聊斋开发群',
    category: 'announcement',
    priority: 'normal',
    status: 'expired',
    day: 55,
    hour: 21,
    minute: 15,
    entities: { subject: '图书馆研讨间预约', event_time: dayOffsetToIso(55, 9), location: '图书馆 4 楼 407', people: ['杨睿哲'] },
    tags: ['预约', '场地'],
    sourceCount: 3,
  },
  {
    headline: '期末项目验收改到 6 月 18 日下午，需准备 10 分钟演示',
    summary: '课程通知更新：期末项目验收时间调整为 6 月 18 日 14:00，形式为 10 分钟演示 + 5 分钟提问，需提前一天提交 PPT 与代码仓库链接。',
    chat: '人工智能2401班群',
    category: 'deadline',
    priority: 'urgent',
    status: 'todo',
    day: 62,
    hour: 15,
    minute: 40,
    entities: { subject: '期末项目验收', event_time: dayOffsetToIso(62, 14), deadline: dayOffsetToIso(61, 23, 59), people: ['任课老师 王教授'], form: '10 分钟演示 + 5 分钟提问' },
    tags: ['验收', '期末', 'DDL'],
    sourceCount: 6,
  },
  {
    headline: '讲座报名：大模型应用落地实践，周三 19:00 报告厅',
    summary: '学院讲座通知：周三 19:00 在学术报告厅举办「大模型应用落地实践」，需提前在系统报名，计入创新学分。',
    chat: '人工智能2401班群',
    category: 'signup',
    priority: 'normal',
    status: 'done',
    day: 66,
    hour: 10,
    minute: 30,
    entities: { subject: '大模型讲座报名', event_time: dayOffsetToIso(66, 19), location: '学术报告厅', benefit: '计入创新学分' },
    tags: ['讲座', '报名'],
    sourceCount: 4,
  },
  {
    headline: '路演顺序抽签结果：24 组第 7 个上场，预计 16:20',
    summary: '组委会公布路演顺序，24 组抽到第 7 位，预计 16:20 上场，需提前 30 分钟到候场区签到并提交最终版 PPT。',
    chat: '24组·聊斋开发群',
    category: 'announcement',
    priority: 'urgent',
    status: 'todo',
    day: 74,
    hour: 19,
    minute: 0,
    entities: { subject: '路演顺序抽签', event_time: dayOffsetToIso(74, 16, 20), location: '候场区', people: ['陈禹哲', '蒋驰骋'], order: '第 7 位' },
    tags: ['路演', '答辩'],
    sourceCount: 9,
  },
  {
    headline: '周一班会：奖学金评定材料需在下周三前备齐',
    summary: '班会通知：奖学金评定需准备成绩单、获奖证明、志愿服务时长证明，下周三 17:00 前交至班长处，逾期顺延至下学期。',
    chat: '人工智能2401班群',
    category: 'deadline',
    priority: 'high',
    status: 'todo',
    day: 80,
    hour: 11,
    minute: 20,
    entities: { subject: '奖学金材料', deadline: dayOffsetToIso(80, 17), people: ['班长 何嘉树'], materials: ['成绩单', '获奖证明', '志愿时长证明'] },
    tags: ['奖学金', '材料'],
    sourceCount: 7,
  },
  {
    headline: '204 宿舍卫生检查定在周四晚 21:00',
    summary: '宿管通知：周四 21:00 卫生检查，重点查地面与阳台，需清空桌面杂物，评分计入文明宿舍评比。',
    chat: '宿舍夜话(204)',
    category: 'announcement',
    priority: 'low',
    status: 'todo',
    day: 84,
    hour: 22,
    minute: 30,
    entities: { subject: '卫生检查', event_time: dayOffsetToIso(84, 21), location: '204 宿舍', people: ['宿管阿姨'] },
    tags: ['宿舍', '检查'],
    sourceCount: 5,
  },
  {
    headline: '摄影展作品征集，6 月 20 日截止，每人限 3 张',
    summary: '校园摄影展征集作品，主题「夏至」，6 月 20 日截止，每人限投 3 张，需附 50 字以内说明，入选作品将在图书馆展出。',
    chat: '学生会宣传部',
    category: 'activity',
    priority: 'low',
    status: 'todo',
    day: 88,
    hour: 14,
    minute: 50,
    entities: { subject: '摄影展征集', deadline: dayOffsetToIso(88, 23, 59), theme: '夏至', quota: '每人 3 张' },
    tags: ['摄影', '征集'],
    sourceCount: 4,
  },
];

export const NOTICES: NoticeItem[] = NOTICE_SEEDS.map((seed, idx) => {
  // 来源消息的发送者必须取自该群自己的成员，否则会出现「A 群的通知里冒出 B 群的人」
  const groupMembers = MEMBERS_BY_GROUP[seed.chat]?.map((m) => m.display_name) ?? [];
  const senders = groupMembers.length ? groupMembers : NAME_POOL;
  const sources = Array.from({ length: seed.sourceCount }, (_, i) => {
    const minute = (seed.hour * 60 + seed.minute - (seed.sourceCount - i) * int(2, 40) + 1440) % 1440;
    const day = seed.day - (i === 0 ? 0 : int(0, 2));
    return {
      id: `src_${idx}_${i}`,
      chat: seed.chat,
      sender: pick(senders),
      time: fmtMD(day, Math.floor(minute / 60), minute % 60),
      timestamp: Math.floor(new Date(dayOffsetToIso(day, Math.floor(minute / 60), minute % 60)).getTime() / 1000),
      text: pick([
        seed.summary.slice(0, 40) + '……具体看群文件',
        `${seed.headline}，大家注意一下`,
        '我再确认一遍，是上面这个时间对吧',
        '收到请回复 1，我好统计人数',
        '@所有人 ' + seed.headline,
        '补充一句：可以代交，但要提前跟我说',
      ]),
      type: (i === 1 ? 'image' : 'text') as ChatMessageType,
      message_id: `msg_${idx}_${i}`,
    };
  });
  sources.sort((a, b) => a.timestamp - b.timestamp);
  return {
    id: `notice_${idx + 1}`,
    headline: seed.headline,
    summary: seed.summary,
    chat: seed.chat,
    chat_username: GROUPS.find((g) => g.chat === seed.chat)?.username ?? '',
    category: seed.category,
    priority: seed.priority,
    status: seed.status,
    timestamp: Math.floor(new Date(dayOffsetToIso(seed.day, seed.hour, seed.minute)).getTime() / 1000),
    time: fmtMD(seed.day, seed.hour, seed.minute),
    date: fmtYMD(seed.day),
    sources,
    entities: seed.entities,
    tags: seed.tags,
    remind_at: seed.priority === 'urgent' ? dayOffsetToIso(Math.max(0, seed.day - 1), 9) : undefined,
    reminded: false,
    confidence: Math.min(0.98, 0.7 + rng() * 0.28),
  };
});

/* ---------------- 画像与匹配（功能三占位数据） ---------------- */
const PERSONA_TAGS = ['群内定海神针', '深夜废话诗人', '梗图军火商', '冷场终结者', '人形公告板', '插科打诨担当', '潜水观察员', '气氛组组长', '理性劝架人', 'ddl 特种兵'];

export const PROFILES: PersonalityProfile[] = GROUPS[0].members.map((name, i) => {
  const msgCount = int(180, 2400);
  return {
    id: `profile_${i + 1}`,
    name,
    username: `wxid_${encodeURIComponent(name)}_${i}`,
    avatar: name.slice(0, 1),
    persona_tags: pickN(PERSONA_TAGS, 2),
    one_liner: pick([
      '开口就是总结，群里的信息都在他脑子里排过序。',
      '白天几乎不发言，凌晨两点准时上线输出金句。',
      '表情包储量惊人，任何话题都能找到对应图。',
      '话不多，但每次发言都在关键节点上。',
      '擅长把跑偏的话题拉回正轨，群里的事实主持人。',
    ]),
    dimensions: [
      { key: 'talk', label: '表达欲', score: int(30, 98), comment: '单位时间发言密度' },
      { key: 'humor', label: '幽默感', score: int(30, 98), comment: '被回复/被引用的比例' },
      { key: 'warmth', label: '情绪温度', score: int(30, 98), comment: '正向情绪词占比' },
      { key: 'logic', label: '逻辑性', score: int(30, 98), comment: '结构化表达比例' },
      { key: 'topic', label: '话题引领', score: int(30, 98), comment: '发起新话题次数' },
      { key: 'night', label: '夜猫指数', score: int(30, 98), comment: '22:00 后发言占比' },
    ],
    style_keywords: pickN(['短句连发', '爱用括号补充', '中英夹杂', '爱发表情收尾', '喜欢引用别人', '长段落输出', '问句多', '爱用省略号'], 3),
    catchphrases: pickN(MEMES.map((m) => m.term), 4),
    stats: {
      message_count: msgCount,
      avg_reply_minutes: int(1, 90),
      active_hours: pick(['09:00-11:00', '14:00-16:00', '20:00-22:00', '22:00-24:00']),
      initiator_ratio: Number((rng() * 0.5 + 0.1).toFixed(2)),
      emoji_ratio: Number((rng() * 0.4 + 0.05).toFixed(2)),
    },
    confidence: Number((0.7 + rng() * 0.28).toFixed(2)),
  };
});

export const MATCHES: MatchResult[] = Array.from({ length: 6 }, (_, i) => {
  const [a, b] = pickN(PROFILES, 2);
  return {
    id: `match_${i + 1}`,
    a: { name: a.name, username: a.username },
    b: { name: b.name, username: b.username },
    score: int(58, 97),
    reasons: pickN(
      [
        '都在 23 点之后活跃，属于同一批夜猫',
        '常用梗高度重叠，评论区互相接得住',
        '都偏好短句 + 表情收尾的表达节奏',
        '话题偏好都集中在技术与比赛',
        '对同一条通知的反应时间都在 3 分钟内',
        '都爱用括号做补充说明，语言习惯近似',
      ],
      3,
    ),
    icebreakers: pickN(
      ['可以从最近那个表情包聊起', '一起组队打下一场训练赛', '约一次线下奶茶，聊路演 PPT', '把「已阅」梗做成联名表情包'],
      2,
    ),
    shared_topics: pickN(['黑客松', '算法训练', '表情包', '夜宵', '路演准备', '摸鱼文学'], 3),
  };
});

export const REVERSE_SIGNALS: ReverseSignal[] = [
  { id: 'rev_1', name: '许亦舟', username: 'wxid_xuyz', kind: 'low_response', label: '回复间隔偏长', detail: '被 @ 后平均 6.2 小时才回应，重要通知容易在他这里断链。', severity: 0.72, suggestion: '重要事项建议单聊或电话二次触达。' },
  { id: 'rev_2', name: '白露', username: 'wxid_bailu', kind: 'topic_mismatch', label: '话题重合度低', detail: '与你的高频话题重合度仅 12%，共同话题集中在少量活动通知上。', severity: 0.55, suggestion: '可从共同活动切入，避免直接聊技术细节。' },
  { id: 'rev_3', name: '段灼', username: 'wxid_duanzhuo', kind: 'style_clash', label: '表达风格冲突', detail: '你偏好短句，他偏好长段落，连续对话时容易产生「没看完」的误解。', severity: 0.48, suggestion: '重要结论建议用条目拆分后再发。' },
  { id: 'rev_4', name: '崔听雨', username: 'wxid_cty', kind: 'cold_thread', label: '话题易冷场', detail: '近 30 天有 7 次由他发起的话题在 3 条内停止，缺乏接梗者。', severity: 0.61, suggestion: '可以在他发起话题后主动接一句，提升群内活跃度。' },
  { id: 'rev_5', name: '严既明', username: 'wxid_yjm', kind: 'other', label: '数据量不足', detail: '该成员近 90 天发言 12 条，画像置信度低，仅供参考。', severity: 0.3, suggestion: '扩大分析时间范围或选择更活跃的群。' },
];

/* ---------------- 总览统计 ---------------- */
export const OVERVIEW: OverviewStats = (() => {
  const hourly: Record<string, number> = {};
  for (let h = 0; h < 24; h++) hourly[h] = Math.round(20 + 260 * Math.exp(-Math.pow(h - 21, 2) / 26) + 120 * Math.exp(-Math.pow(h - 11, 2) / 18) + rng() * 20);
  return {
    total_messages: 486213,
    group_count: GROUPS.filter((g) => g.username.includes('@chatroom')).length,
    member_count: GROUPS.reduce((s, g) => s + g.memberCount, 0),
    meme_count: MEMES.length,
    notice_count: NOTICES.length,
    todo_count: NOTICES.filter((n) => n.status === 'todo' || n.status === 'doing').length,
    next_deadline: (() => {
      const next = NOTICES.filter((n) => n.entities.deadline && n.status !== 'done').sort((a, b) => String(a.entities.deadline).localeCompare(String(b.entities.deadline)))[0];
      return next ? { notice_id: next.id, headline: next.headline, deadline: String(next.entities.deadline), chat: next.chat } : undefined;
    })(),
    hourly,
    type_breakdown: { 文本: 341820, 图片: 61340, 表情: 49220, 链接文件: 21430, 语音: 8220, 视频: 3280, 系统: 903 },
    top_senders: PROFILES.map((p) => ({ name: p.name, count: p.stats.message_count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    range: { start: RANGE_START.toISOString(), end: RANGE_END.toISOString() },
  };
})();

export const MOCK_META = { generated_at: new Date().toISOString(), span_days: SPAN_DAYS };
