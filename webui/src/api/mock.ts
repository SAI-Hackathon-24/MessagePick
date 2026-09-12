/**
 * 开发期契约实现（mock）
 * =============================================================================
 * 严格按 `api-contract.md` 的出参与错误标识返回数据，供前端在后端
 * （MOD-001 ~ MOD-008）尚未实现期间自测与验收自查。
 *
 * · 不修改传入的筛选条件，筛选口径与契约一致（§1.3 全局筛选条件）。
 * · 空态与错误按契约返回：NO_DATA / EMPTY_RESULT / IDENTITY_NOT_READY 等。
 * · 交付物不依赖本文件（REQ-019：不做演示数据版本）——接真实后端时删除。
 */
import {
  interestHintsOf,
  ALIGNMENT_CANDIDATES,
  DATA_END,
  EXTRACTS,
  GENERATION_HISTORY,
  GROUPS,
  MATERIAL_CONSENTS,
  MEMBERS,
  MEMES,
  ME_PERSON_ID,
  TOTAL_CAPTURED_MESSAGES,
  TOTAL_CONTACTS,
  PERSON_IDS,
  PERSON_NAMES,
  PERSON_TAGS,
  PERSONA,
  TAGS,
  UPDATED_TO,
  activityCache,
  buildProfile,
  heatStateOf,
  activityBreakdownOf,
  knownPersonIds,
  lifecycleOf,
  memberById,
  monthlyOf,
  replyCache,
  sourceRefsOf,
  tagById,
  unknownPersonIds,
} from './fixtures';
import type {
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
  MaterialConsent,
  MaterialTier,
  MemeCloudEntry,
  MemeCloudResult,
  MemeContext,
  MemeUnit,
  MessageDetail,
  MyCompatibility,
  NewMemeCandidate,
  NoticeDimension,
  PairMatch,
  Paged,
  PersonProfile,
  PersonaPanel,
  PersonalityTrait,
  Priority,
  RelationGraph,
  StickerGeneration,
  TextVariantGeneration,
  TodoState,
  UpdateResult,
  UpdateStatus,
} from '@/types';

/* -------------------------------------------------------------------------- */
/* 筛选（§1.3）：群 · 时间范围 · 关键词 · 身份                                   */
/* -------------------------------------------------------------------------- */
const inRange = (iso: string, f: GlobalFilter) => {
  const { start, end } = f.timeRange;
  if (start && iso < start) return false;
  if (end && iso > end) return false;
  return true;
};
const inGroups = (groupId: string, f: GlobalFilter) => !f.groupIds.length || f.groupIds.includes(groupId);
const has = (hay: string | undefined, kw: string) => !kw || (hay ?? '').toLowerCase().includes(kw.toLowerCase());

/** 有效梗 = 未被改判「不是梗」也未合并（改判立即影响后续结果 —— REQ-035） */
const activeMemes = () => MEMES.filter((m) => m.correction !== 'not_meme' && m.correction !== 'merged');

/* -------------------------------------------------------------------------- */
/* MOD-001 数据接入与更新                                                       */
/* -------------------------------------------------------------------------- */
export const mockUpdateStatus = (): UpdateStatus => ({
  hasData: true,
  updatedTo: UPDATED_TO,
  sources: [
    { source: 'group_messages', status: 'success', lastSuccessAt: UPDATED_TO },
    { source: 'contacts', status: 'success', lastSuccessAt: UPDATED_TO },
  ],
});

export const mockTriggerUpdate = (target?: 'group_messages' | 'contacts'): UpdateResult => ({
  results: [
    ...(target === 'contacts' ? [] : [{ source: 'group_messages' as const, status: 'success' as const, imported: 3184 }]),
    { source: 'contacts' as const, status: 'success' as const, imported: 96 },
  ].filter((r) => !target || r.source === target),
  finishedAt: UPDATED_TO,
});

/* -------------------------------------------------------------------------- */
/* 群 / 成员                                                                   */
/* -------------------------------------------------------------------------- */
export const mockGroups = (): Group[] => GROUPS;

export const mockMembersOfGroup = (groupId: string) => MEMBERS.filter((m) => m.groupId === groupId);

/* -------------------------------------------------------------------------- */
/* MOD-002 删除（API-005 / API-006）                                           */
/* -------------------------------------------------------------------------- */
export const mockDeletePrecheck = (scope: DeleteScope): DeletePrecheck => {
  const isAll = scope.kind === 'all';
  const groupName = isAll ? '全部数据' : (GROUPS.find((g) => g.id === scope.groupId)?.name ?? scope.groupId);
  const factor = isAll ? 1 : 1 / Math.max(1, GROUPS.length);
  const count = (n: number) => (isAll ? n : Math.max(1, Math.round(n * factor)));
  const items = [
    { entity: 'DM-002', label: '群', count: isAll ? GROUPS.length : 1 },
    { entity: 'DM-003', label: '原始消息记录', count: count(TOTAL_CAPTURED_MESSAGES) },
    { entity: 'DM-004', label: '群成员身份', count: count(MEMBERS.length) },
    { entity: 'DM-005', label: '通讯录 / 好友列表记录', count: count(TOTAL_CONTACTS) },
    { entity: 'DM-006', label: '梗及其派生结果', count: count(MEMES.length) },
    { entity: 'DM-010', label: '提取条目', count: count(EXTRACTS.length) },
    { entity: 'DM-013', label: '兴趣标签', count: count(TAGS.length) },
    { entity: 'DM-016', label: '性格标签', count: count(PERSON_IDS.length * 3) },
    { entity: 'DM-020', label: '生成历史', count: count(GENERATION_HISTORY.length) },
    { entity: 'DM-022', label: '素材合规确认', count: count(MATERIAL_CONSENTS.length) },
  ];
  return { scope, scopeLabel: groupName, items, total: items.reduce((s, i) => s + i.count, 0) };
};

export const mockExecuteDelete = (scope: DeleteScope, confirmed: boolean): DeleteResult => {
  if (!confirmed) throw new Error('CONFIRMATION_REQUIRED');
  const pre = mockDeletePrecheck(scope);
  return { items: pre.items, undone: false };
};

/* -------------------------------------------------------------------------- */
/* MOD-005 模块一：梗分析                                                       */
/* -------------------------------------------------------------------------- */
export const mockMemeCloud = (f: GlobalFilter, layout: 'heat' | 'firstSeen', scale: 'cumulative' | 'window'): MemeCloudResult => {
  const entries: MemeCloudEntry[] = activeMemes()
    .filter((m) => inGroups(m.groupId, f))
    .filter((m) => has(m.name, f.keyword) || has(m.interpretation, f.keyword))
    .map((m) => {
      const relevant = m.occurrences.filter((o) => inRange(o.at, f));
      const mine = m.occurrences.some((o) => memberById(o.memberId)?.personId === f.meId);
      const lastUsedAt = m.occurrences[m.occurrences.length - 1]?.at ?? DATA_END.toISOString();
      const unit = mockMemeUnit(m.id);
      const monthly = unit?.monthly ?? [];
      const maxMonthly = Math.max(...monthly.map((b) => b.count), 1);
      return {
        memeId: m.id,
        name: m.name,
        frequency: scale === 'cumulative' ? m.occurrences.length : relevant.length,
        occurrences: m.occurrences.length,
        type: m.type,
        firstSeenAt: unit?.firstSeenAt ?? m.occurrences[0]?.at ?? DATA_END.toISOString(),
        lastUsedAt,
        mine,
        // 卡片需要的字段与梗单元同源，避免「点进去才有内容」
        interpretation: unit?.interpretation,
        heatState: unit?.heatState,
        activeDays: unit?.lifecycle.activeDays,
        weekOverWeek: unit?.weekOverWeek,
        monthly,
        king: unit?.king,
        highlights: unit?.highlights,
        intensity: monthly.map((b) => ({ month: b.month, intensity: b.count / maxMonthly, count: b.count })),
      };
    })
    .filter((e) => e.frequency > 0);
  if (layout === 'firstSeen') entries.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  else entries.sort((a, b) => b.frequency - a.frequency);
  return {
    entries,
    legend: [
      { type: 'catchphrase', color: '#07C160', label: '口头禅' },
      { type: 'inner', color: '#0ea5e9', label: '内部梗' },
      { type: 'sticker', color: '#f59e0b', label: '表情包梗' },
    ],
    sourceRefs: sourceRefsOf(entries.slice(0, 5).flatMap((e) => MEMES.find((m) => m.id === e.memeId)?.occurrences.slice(0, 1).map((o) => o.messageId) ?? [])),
  };
};

export const mockMemeUnit = (memeId: string): MemeUnit | null => {
  const m = MEMES.find((x) => x.id === memeId);
  if (!m) return null;
  const group = GROUPS.find((g) => g.id === m.groupId)!;
  const byMember = new Map<string, number>();
  m.occurrences.forEach((o) => byMember.set(o.memberId, (byMember.get(o.memberId) ?? 0) + 1));
  const sorted = [...byMember.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0]?.[1] ?? 1;
  const total = m.occurrences.length;
  const kings = sorted
    .filter(([, c]) => c === maxCount)
    .map(([id, c]) => ({ memberId: id, name: memberById(id)?.displayName ?? id, count: c, ratio: Number((c / total).toFixed(3)) }));
  const lastUsedAt = m.occurrences[m.occurrences.length - 1]?.at ?? DATA_END.toISOString();
  const sinceDays = Math.round((DATA_END.getTime() - Date.parse(lastUsedAt)) / 86400000);
  const lifecycle = lifecycleOf(m);
  return {
    memeId: m.id,
    name: m.name,
    type: m.type,
    groupId: group.id,
    groupName: group.name,
    interpretation: m.interpretation,
    firstSeenAt: lifecycle.firstSeenAt,
    firstSeenGroupName: group.name,
    lastUsedAt,
    sinceLastUse: sinceDays === 0 ? '今天' : `${sinceDays} 天前`,
    occurrences: total,
    weekOverWeek: Number((rngLike(m.id) * 0.8 - 0.25).toFixed(2)),
    heatState: heatStateOf(lastUsedAt),
    monthly: monthlyOf(m),
    lifecycle,
    king: {
      members: kings,
      topUsers: sorted.slice(0, 5).map(([id, c]) => ({ memberId: id, name: memberById(id)?.displayName ?? id, count: c })),
    },
    highlights: m.occurrences
      .slice(-6)
      .reverse()
      .slice(0, 6)
      .map((o) => {
        const member = memberById(o.memberId);
        const kind = rngLike(o.messageId) < 0.75 ? 'text' : rngLike(o.messageId + 'k') < 0.6 ? 'image' : 'sticker';
        return {
          messageId: o.messageId,
          senderName: member?.displayName ?? '未知',
          sentAt: o.at,
          kind,
          text: kind === 'text' ? `${m.name}${['', '哈哈哈哈哈', '，笑死', '（狗头）'][Math.floor(rngLike(o.messageId + 'x') * 4)]}` : undefined,
          mediaUrl: kind === 'text' ? undefined : `/api/media/${group.id}/${o.messageId}`,
          groupId: group.id,
          groupName: group.name,
        };
      }),
    variants: m.variantIds.map((id) => ({ memeId: id, name: MEMES.find((x) => x.id === id)?.name ?? id })),
    correction: m.correction,
    sourceRefs: sourceRefsOf(m.occurrences.slice(-8).map((o) => o.messageId)),
    mine: m.occurrences.some((o) => memberById(o.memberId)?.personId === ME_PERSON_ID),
  };
};

/** 稳定的伪随机（同一 id 每次一致，避免界面抖动） */
function rngLike(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = ((h ^ key.charCodeAt(i)) * 16777619) >>> 0;
  return (h % 1000) / 1000;
}

export const mockLifecycleView = (f: GlobalFilter, months: string[]) => {
  const memes = activeMemes().filter((m) => inGroups(m.groupId, f));
  const rows = memes.map((m) => {
    const monthly = monthlyOf(m).filter((b) => !months.length || months.includes(b.month));
    const max = Math.max(...monthly.map((b) => b.count), 1);
    const lc = lifecycleOf(m);
    return {
      memeId: m.id,
      name: m.name,
      type: m.type,
      firstSeenAt: lc.firstSeenAt,
      peakAt: lc.peakAt,
      silentAt: lc.silentAt,
      activeDays: lc.activeDays,
      monthlyIntensity: monthly.map((b) => ({ month: b.month, intensity: b.count / max, count: b.count })),
    };
  });
  const monthSet = [...new Set(rows.flatMap((r) => r.monthlyIntensity.map((x) => x.month)))].sort();
  const monthlyLeaders = monthSet.map((month) => {
    const best = rows
      .map((r) => ({ r, cell: r.monthlyIntensity.find((x) => x.month === month) }))
      .filter((x) => x.cell)
      .sort((a, b) => (b.cell?.count ?? 0) - (a.cell?.count ?? 0))[0];
    return { month, memeId: best?.r.memeId ?? '', name: best?.r.name ?? '', count: best?.cell?.count ?? 0 };
  });
  return {
    rows: rows.sort((a, b) => b.activeDays - a.activeDays),
    monthlyLeaders,
    legend: [
      { type: 'catchphrase' as const, color: '#07C160', label: '口头禅' },
      { type: 'inner' as const, color: '#0ea5e9', label: '内部梗' },
      { type: 'sticker' as const, color: '#f59e0b', label: '表情包梗' },
    ],
  };
};

export const mockSubmitCorrection = (memeId: string, mark: MemeUnit['correction'], mergeTargetId?: string) => {
  const m = MEMES.find((x) => x.id === memeId);
  if (!m) throw new Error('NOT_FOUND');
  if (mark === 'merged') {
    if (!mergeTargetId || !MEMES.some((x) => x.id === mergeTargetId)) throw new Error('NOT_FOUND');
    if (MEMES.find((x) => x.id === mergeTargetId)?.groupId !== m.groupId) throw new Error('INVALID_INPUT');
    m.mergedTo = mergeTargetId;
  }
  m.correction = mark;
  return mockMemeUnit(memeId);
};

/* -------------------------------------------------------------------------- */
/* MOD-005 G1~G3（由 MOD-004 转交梗上下文）                                      */
/* -------------------------------------------------------------------------- */
export const mockGenerateStickers = (ctx: MemeContext, tier: MaterialTier, template: string, caption: string): StickerGeneration => {
  // 素材档位与模板参与排版（tier 决定底色，template 决定版式），产出带「创作」标注
  const variants = [caption, `${caption}（已读不回版）`, `${caption}！`, `关于${caption}这件事`];
  return {
    images: variants.map((c, i) => ({ url: stickerPlaceholder(ctx.name, c, i, tier, template), caption: c })),
    creationMark: true,
  };
};

export const mockGenerateTextVariants = (ctx: MemeContext): TextVariantGeneration => ({
  variants: [
    `${ctx.name}，这次真的`,
    `不是我说，${ctx.name}`,
    `${ctx.name} ×2`,
    `所以${ctx.name}到底行不行`,
    `${ctx.name}（认真脸）`,
  ],
  creationMark: true,
});

export const mockGenerateNewMemeCandidates = (f: GlobalFilter): NewMemeCandidate[] => {
  const msgs = EXTRACTS.flatMap((e) => e.sourceRefs).filter((r) => inGroups(r.groupId, f)).slice(0, 20);
  return [
    {
      candidateId: 'cand1',
      name: '薛定谔的进度',
      meaningGuess: '指群里汇报进度时既完成又未完成的状态：说了在做，但没人见过产物。',
      sources: msgs.slice(0, 3),
      examples: ['进度？薛定谔的进度', '我这周是薛定谔的进度'],
      status: 'candidate',
    },
    {
      candidateId: 'cand2',
      name: '再改最后一版',
      meaningGuess: '第 N 次修改稿件的开场白，语义上等价于「还有第 N+1 版」。',
      sources: msgs.slice(3, 6),
      examples: ['再改最后一版就交', '这句话我听过三次了'],
      status: 'candidate',
    },
  ];
};

export const mockConfirmCandidate = (candidateId: string) => ({ candidateId, memeId: `meme_new_${candidateId}`, status: 'confirmed' as const });

export const mockGenerationHistory = (f: GlobalFilter): GenerationHistoryItem[] =>
  GENERATION_HISTORY.filter((h) => !f.keyword || has(h.memeName, f.keyword)).map((h) => ({ ...h }));

/* -------------------------------------------------------------------------- */
/* MOD-008 素材合规确认（DM-022）                                               */
/* -------------------------------------------------------------------------- */
export const mockMaterialConsents = (): MaterialConsent[] => MATERIAL_CONSENTS.map((c) => ({ ...c }));

export const mockConfirmMaterial = (consentId: string) => {
  const c = MATERIAL_CONSENTS.find((x) => x.consentId === consentId);
  if (!c) throw new Error('NOT_FOUND');
  c.status = 'confirmed';
  c.confirmedAt = UPDATED_TO;
  return { ...c };
};

/* -------------------------------------------------------------------------- */
/* MOD-006 模块二：信息提取                                                     */
/* -------------------------------------------------------------------------- */
export const mockExtractItems = (f: GlobalFilter, page = 1, pageSize = 50): Paged<ExtractItem> => {
  const all = EXTRACTS.filter((e) => inGroups(e.groupId, f))
    .filter((e) => inRange(e.sentAt, f))
    .filter((e) => has(e.aiSummary, f.keyword) || has(e.summaryLine, f.keyword) || has(e.subject, f.keyword))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return { items: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: all.length };
};

export const mockNoticeGroups = (f: GlobalFilter, dimension: NoticeDimension) => {
  const items = mockExtractItems(f, 1, 500).items;
  const keyOf = (it: ExtractItem): string => {
    switch (dimension) {
      case 'source':
        return it.groupName;
      case 'type':
        return it.type;
      case 'priority':
        return it.priority;
      case 'todo':
        return it.todoState;
    }
  };
  const map = new Map<string, ExtractItem[]>();
  items.forEach((it) => {
    const k = keyOf(it);
    map.set(k, [...(map.get(k) ?? []), it]);
  });
  return [...map.entries()].map(([key, list]) => ({ key, items: list }));
};

export const mockUpdateExtract = (id: string, patch: { subject?: string; priority?: Priority }) => {
  const it = EXTRACTS.find((x) => x.id === id);
  if (!it) throw new Error('NOT_FOUND');
  if (patch.subject !== undefined) it.subject = patch.subject;
  if (patch.priority !== undefined) it.priority = patch.priority;
  return { ...it };
};

export const mockMarkTodo = (id: string, state: TodoState) => {
  const it = EXTRACTS.find((x) => x.id === id);
  if (!it) throw new Error('NOT_FOUND');
  it.todoState = state;
  it.remindState = 'no_remind';
  return { id, todoState: state };
};

/** 到期待办（API-018）：距到期 ≤1 天且未完成；仅在使用应用期间检查（REQ-046） */
export const mockDueTodos = (nowIso: string) =>
  EXTRACTS.filter((e) => e.todoState === 'pending' && e.elements.deadline)
    .filter((e) => {
      const diff = Date.parse(e.elements.deadline!) - Date.parse(nowIso);
      return diff > 0 && diff <= 86400000;
    })
    .map((e) => ({ id: e.id, subject: e.subject, groupName: e.groupName, deadline: e.elements.deadline! }));

export const mockMessageDetail = (id: string): MessageDetail | null => {
  const it = EXTRACTS.find((x) => x.id === id);
  if (!it) return null;
  const memberIds = [...new Set(it.sourceRefs.map((r) => MEMBERS.find((m) => m.displayName === r.senderName && m.groupId === r.groupId)?.id).filter((x): x is string => !!x))];
  return {
    id: it.id,
    heading: { summaryLine: it.summaryLine, groupName: it.groupName, sentAt: it.sentAt },
    body: {
      aiSummary: it.aiSummary,
      messages: it.sourceRefs.map((r) => ({
        id: r.messageId,
        groupId: r.groupId,
        senderId: MEMBERS.find((m) => m.displayName === r.senderName && m.groupId === r.groupId)?.id ?? '',
        senderName: r.senderName,
        sentAt: r.sentAt,
        kind: 'text' as const,
        text: r.excerpt,
      })),
    },
    interestHints: interestHintsOf(memberIds),
  };
};

/* -------------------------------------------------------------------------- */
/* MOD-007 模块三：社交画像                                                     */
/* -------------------------------------------------------------------------- */
/** 一级固定五类的中文名（REQ-017：不引入英文术语） */
const CATEGORY_CN: Record<string, string> = { sports: '运动', art: '艺术', game: '游戏', entertainment: '娱乐', social: '社交' };

/** 活跃度综合分：实现放在 fixtures（与原始指标同源），这里只做再导出 */
export const buildActivityBreakdown = activityBreakdownOf;

export const mockProfile = (personId: string): PersonProfile | null => (PERSON_NAMES[personId] ? buildProfile(personId) : null);

export const mockPersonaPanel = (personId: string): PersonaPanel => ({
  personId,
  personName: PERSON_NAMES[personId] ?? personId,
  candidates: (PERSONA[personId] ?? []).filter((p) => p.status === 'candidate'),
  confirmed: (PERSONA[personId] ?? []).filter((p) => p.status === 'confirmed'),
});

export const mockConfirmPersona = (personId: string, traitId: string, op: 'confirm' | 'add' | 'delete' | 'edit', trait?: PersonalityTrait) => {
  const list = PERSONA[personId] ?? (PERSONA[personId] = []);
  if (op === 'confirm') {
    const t = list.find((x) => x.traitId === traitId);
    if (!t) throw new Error('NOT_FOUND');
    t.status = 'confirmed';
  } else if (op === 'delete') {
    const i = list.findIndex((x) => x.traitId === traitId);
    if (i < 0) throw new Error('NOT_FOUND');
    list.splice(i, 1);
  } else if (op === 'add') {
    if (!trait) throw new Error('INVALID_INPUT');
    list.push({ traitId: `${personId}_pt_manual_${list.length}`, trait, score: 60, status: 'confirmed', origin: 'manual' });
  } else {
    const t = list.find((x) => x.traitId === traitId);
    if (!t || !trait) throw new Error('INVALID_INPUT');
    t.trait = trait;
    t.origin = 'manual';
  }
  return mockPersonaPanel(personId);
};

/** 人工增删改兴趣标签（API-028，REQ-056）：立即影响后续结果 */
export const mockEditInterestTag = (
  personId: string,
  op: 'add' | 'delete' | 'edit',
  payload: { tagId?: string; name?: string; category?: InterestCategory },
) => {
  const list = PERSON_TAGS[personId] ?? (PERSON_TAGS[personId] = []);
  if (op === 'delete') {
    const i = list.indexOf(payload.tagId ?? '');
    if (i < 0) throw new Error('NOT_FOUND');
    list.splice(i, 1);
  } else if (op === 'add') {
    if (!payload.name || !payload.category) throw new Error('INVALID_INPUT');
    let tag = TAGS.find((t) => t.name === payload.name);
    if (!tag) {
      tag = { tagId: `t_manual_${TAGS.length + 1}`, name: payload.name, category: payload.category, confidence: 0.8, evidence: [], origin: 'manual' };
      TAGS.push(tag);
    }
    if (!list.includes(tag.tagId)) list.push(tag.tagId);
  } else {
    // edit：改标签名 / 一级维度（一级维度固定五类，不在闭集内即拒 —— REQ-052）
    if (payload.category && !['sports', 'art', 'game', 'entertainment', 'social'].includes(payload.category)) throw new Error('INVALID_INPUT');
    const tag = tagById(payload.tagId ?? '');
    if (!tag) throw new Error('NOT_FOUND');
    if (payload.name) tag.name = payload.name;
    if (payload.category) tag.category = payload.category;
    tag.origin = 'manual';
  }
  return mockProfile(personId)!;
};

/** 兴趣 → 人（API-021）：按一级维度或按二级标签两个入口（REQ-064） */
export const mockInterestToPeople = (entry: 'category' | 'tag', value: string, f: GlobalFilter): InterestPeopleResult => {
  const people: InterestPeopleResult['people'] = [];
  knownPersonIds().forEach((pid) => {
    const tags = (PERSON_TAGS[pid] ?? []).map((id) => tagById(id)).filter((t): t is InterestTag => !!t);
    const hit = entry === 'category' ? tags.filter((t) => t.category === value) : tags.filter((t) => t.name === value);
    if (!hit.length) return;
    if (f.keyword && !has(PERSON_NAMES[pid], f.keyword) && !hit.some((t) => has(t.name, f.keyword))) return;
    people.push({
      personId: pid,
      name: PERSON_NAMES[pid],
      confidence: Number(hit.reduce((s, t) => s + t.confidence, 0).toFixed(2)),
      replyMedianMinutes: replyCache[pid],
      activity: activityCache[pid] ?? 0,
      activityScore: buildActivityBreakdown(pid),
      unknown: false,
      evidence: hit.flatMap((t) => t.evidence.slice(0, 2)),
    });
  });
  // 未知成员仍列出并注记（REQ-081）
  unknownPersonIds().forEach((pid) => {
    if (entry === 'category' && value !== 'social') return;
    people.push({ personId: pid, name: PERSON_NAMES[pid], confidence: 0, replyMedianMinutes: replyCache[pid], activity: activityCache[pid] ?? 0, activityScore: buildActivityBreakdown(pid), unknown: true, evidence: [] });
  });
  return {
    entry,
    entryLabel: entry === 'category' ? ({ sports: '运动', art: '艺术', game: '游戏', entertainment: '娱乐', social: '社交' } as Record<string, string>)[value] ?? value : value,
    people: people.sort((a, b) => b.confidence - a.confidence || b.activity - a.activity),
  };
};

/** 两人配对（API-022）：共同爱好 + 契合度 + 逐维度差值（REQ-058、REQ-059） */
export const mockPairMatch = (aId: string, bId: string): PairMatch | null => {
  if (!PERSON_NAMES[aId] || !PERSON_NAMES[bId] || aId === bId) return null;
  const pa = buildProfile(aId);
  const pb = buildProfile(bId);
  const shared = pa.tags.filter((t) => pb.tags.some((x) => x.tagId === t.tagId));
  const sharedCountScore = Math.min(40, shared.length * 8);
  const weightScore = Math.min(30, Math.round(shared.reduce((s, t) => s + t.confidence, 0) * 8));
  const interactScore = Math.min(20, Math.round(((activityCache[aId] ?? 0) + (activityCache[bId] ?? 0)) / 260));
  const activityScore = Math.min(10, Math.round(((activityCache[aId] ?? 0) + (activityCache[bId] ?? 0)) / 520));
  const categoryDiff = {} as PairMatch['categoryDiff'];
  (['sports', 'art', 'game', 'entertainment', 'social'] as InterestCategory[]).forEach((c) => {
    const a = Number(pa.categoryScores[c].toFixed(2));
    const b = Number(pb.categoryScores[c].toFixed(2));
    categoryDiff[c] = { a, b, diff: Number((a - b).toFixed(2)) };
  });
  return {
    personA: { personId: aId, name: pa.name },
    personB: { personId: bId, name: pb.name },
    sharedInterests: shared.map((t) => ({ tagId: t.tagId, name: t.name, category: t.category })),
    compatibility: {
      total: sharedCountScore + weightScore + interactScore + activityScore,
      factors: [
        { key: 'shared', label: '共同标签数', value: sharedCountScore },
        { key: 'weight', label: '置信度加权', value: weightScore },
        { key: 'interact', label: '实际互动', value: interactScore },
        { key: 'activity', label: '活跃度（只计一次）', value: activityScore },
      ],
    },
    categoryDiff,
  };
};

/** 我的社交契合度（API-023）：逐人列表 + 整体融入度（REQ-079） */
export const mockMyCompatibility = (): MyCompatibility => {
  const perPerson = knownPersonIds()
    .filter((p) => p !== ME_PERSON_ID)
    .map((p) => {
      const match = mockPairMatch(ME_PERSON_ID, p);
      return {
        personId: p,
        name: PERSON_NAMES[p],
        score: match?.compatibility.total ?? 0,
        sharedCount: match?.sharedInterests.length ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);
  const integration = Math.round(perPerson.reduce((s, x) => s + x.score, 0) / Math.max(1, perPerson.length));
  return { perPerson, integration };
};

/** 组局建议（API-024）：仅文字建议，不含待办、不含可直接发送的文案（REQ-063） */

export const mockGatheringSuggestion = (interest: string, personIds: string[]): GatheringSuggestion => {
  // 检索入口可能是二级标签，也可能是一级维度（此时需换成中文名再写进建议文本）
  const label = CATEGORY_CN[interest] ?? interest;
  const names = personIds.map((p) => PERSON_NAMES[p] ?? p);
  return {
    interest: label,
    candidates: personIds.map((p) => ({ personId: p, name: PERSON_NAMES[p] ?? p })),
    text: `可以约 ${names.join('、')} 一起${label}。他们在这项兴趣上的置信度都不低，且都还在群里活跃，发起前建议先问一句时间。`,
  };
};

/** 身份对齐（API-025 / API-026） */
export const mockAlignmentCandidates = (): IdentityAlignmentCandidate[] => ALIGNMENT_CANDIDATES.map((c) => ({ ...c })) as IdentityAlignmentCandidate[];

export const mockSubmitAlignment = (candidateId: string, decision: 'confirmed' | 'rejected') => {
  const c = ALIGNMENT_CANDIDATES.find((x) => x.candidateId === candidateId);
  if (!c) throw new Error('NOT_FOUND');
  c.status = decision;
  if (decision === 'confirmed') c.confirmedAt = UPDATED_TO;
  return { candidateId, status: decision };
};

/** 人-人关系图谱（REQ-069）：未知成员列入但零连线（REQ-081） */
export const mockRelationGraph = (): RelationGraph => {
  /**
   * ⚠️ 节点必须以**唯一的人员表**为准，未知只是一个标记。
   * 曾经写成「已知人员 + 未知名单」两段拼接：两个名单一旦重叠就会产生重复节点，
   * ECharts 的 graph 会因 `duplicate name or id` 直接抛异常、画布空白。
   */
  const unknownSet = new Set(unknownPersonIds());
  const nodes = [...new Set(knownPersonIds())].map((p) => ({
    personId: p,
    name: PERSON_NAMES[p],
    unknown: unknownSet.has(p),
    activity: activityCache[p] ?? 0,
    isMe: p === ME_PERSON_ID,
  }));
  const links: RelationGraph['links'] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.unknown || b.unknown) continue; // 零连线
      const shared = (PERSON_TAGS[a.personId] ?? []).filter((t) => (PERSON_TAGS[b.personId] ?? []).includes(t));
      if (shared.length >= 2) {
        links.push({
          source: a.personId,
          target: b.personId,
          sharedCount: shared.length,
          sharedInterests: shared.map((t) => tagById(t)?.name ?? t),
        });
      }
    }
  }
  return { nodes, links };
};

/** 兴趣时间轴 / 事件流（REQ-067）：仅可视化，不参与权重（REQ-087） */
export const mockInterestEventStreams = (limit = 8): InterestEventStream[] =>
  TAGS.slice(0, limit).map((t) => ({
    tagId: t.tagId,
    name: t.name,
    category: t.category,
    firstSeenAt: t.evidence[0]?.sentAt ?? DATA_END.toISOString(),
    events: t.evidence.map((e) => ({ at: e.sentAt, intensity: t.confidence, personName: e.senderName })),
  }));

/** 评分卡（REQ-068、REQ-078） */
export const mockInterestScoreCards = (limit = 12): InterestScoreCard[] =>
  TAGS.slice(0, limit).map((t) => {
    const owners = knownPersonIds().filter((p) => (PERSON_TAGS[p] ?? []).includes(t.tagId));
    return {
      tagId: t.tagId,
      name: t.name,
      category: t.category,
      heat: Number(((owners.reduce((s, p) => s + (activityCache[p] ?? 0), 0) / Math.max(1, owners.length)) / 10).toFixed(1)),
      peopleCount: owners.length,
      perPerson: owners.map((p) => ({ personId: p, name: PERSON_NAMES[p], confidence: t.confidence })),
    };
  });

/* -------------------------------------------------------------------------- */
/* 数据去向说明（REQ-012 / AC-030）                                             */
/* -------------------------------------------------------------------------- */
export const mockDataFlowNotice = (): DataFlowNotice => ({
  modelEndpoint: '（未配置，可在设置页填写）',
  statements: [
    '原始聊天记录只保存在本机应用数据目录，不会上传到任何服务器。',
    '仅「识别 / 抽取 / 聚类 / 生成 / 推断」五类模型任务所需的消息内容，会发送到你在设置页配置的大模型服务。',
    '应用不提供任何对外分享 / 发送通道：分析结果不外露给群成员，也不会替你发消息。',
    '按群删除或全量清空时，原始记录、派生结果、生成历史与媒体缓存会被一并删除，不可恢复。',
  ],
});

/** 供 UI 展示「数据量」用 */
export const mockDataVolume = () => ({ messages: 3184, groups: GROUPS.length, people: PERSON_IDS.length, memes: MEMES.length, extracts: EXTRACTS.length });

/* -------------------------------------------------------------------------- */
/* G1 占位渲染（HLD 决策 5：本地模板化渲染，离线、确定性排版）                      */
/* 真实实现由 MOD-008 在 worker 中完成；此处仅用于前端联调展示。                    */
/* -------------------------------------------------------------------------- */
const TIER_PALETTE: Record<MaterialTier, [string, string]> = {
  group_image: ['#0b0f17', '#07C160'],
  popular_sticker: ['#1c2230', '#f59e0b'],
  pure_template: ['#052e1c', '#45bd87'],
};

function stickerPlaceholder(memeName: string, caption: string, index: number, tier: MaterialTier, template: string): string {
  const [bg, fg] = TIER_PALETTE[tier];
  const size = index === 1 ? 92 : 76;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${fg}" stop-opacity="0.35"/>
  </linearGradient></defs>
  <rect width="360" height="360" rx="32" fill="url(#g)"/>
  <text x="180" y="150" font-size="${memeName.length > 3 ? 52 : size}" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(memeName)}</text>
  <text x="180" y="212" font-size="22" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="${fg}" text-anchor="middle">${esc(caption.slice(0, 14))}</text>
  <text x="180" y="300" font-size="14" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#ffffff" fill-opacity="0.6" text-anchor="middle">${esc(template)}</text>
  <text x="180" y="326" font-size="13" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#ffffff" fill-opacity="0.85" text-anchor="middle">创作 · 聊斋 MessagePick</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const esc = (v: string) => v.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** API-029 成员兴趣提示：仅含已确认数据（REQ-070、REQ-075）；无数据时不显示提示 */
export const mockInterestHints = (memberIds: string[]) => interestHintsOf(memberIds);
